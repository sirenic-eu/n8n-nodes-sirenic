/**
 * The trigger's whole security rests on one function: a forged batch must be
 * refused, and a genuine one accepted even after Sirenic retried it. So the
 * tests sign real payloads with a real Ed25519 key pair and check both sides.
 *
 * The recipe under test is the one published at /.well-known/sirenic-signing-key:
 *   utf8("sirenic-v1:" + kid + ":" + timestamp + ":" + base64(sha256(raw body)))
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	cleEvenement,
	clePublique,
	messageSigne,
	verifierLivraison,
	type CleDeSignature,
} from '../nodes/SirenicTrigger/signature';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const SPKI_B64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const KID = 'd06c6006c5d560e9';
const CLE: CleDeSignature = { kid: KID, alg: 'Ed25519', public_key: SPKI_B64 };

/** Signs a body exactly as the API does. */
function signer(corps: Buffer, horodatage: string, kid = KID) {
	return sign(null, messageSigne(kid, horodatage, corps), privateKey).toString('base64');
}

const LOT = Buffer.from(
	JSON.stringify({
		surveillance_id: 'sw_3f2b1c8e-7d40-4a91-9c02-b6e5f1a83d77',
		evenements: [
			{
				cible: { type: 'entreprise', siren: '552032534', nom: null },
				type: 'changement_etat_administratif',
				detail: { avant: 'actif', apres: 'cesse' },
				survenu_le: '2026-08-03T04:07:11.482Z',
			},
		],
		verification: 'signature Ed25519 détachée dans les en-têtes',
	}),
	'utf8',
);

const MAINTENANT = Date.parse('2026-08-03T04:07:20.000Z');
const TOLERANCE = 5 * 60 * 1000;

describe('public key parsing', () => {
	it('accepts the SPKI DER base64 the well-known route serves', () => {
		expect(clePublique(SPKI_B64).asymmetricKeyType).toBe('ed25519');
	});

	it('accepts a raw 32-byte key too, so a format change stays survivable', () => {
		const brute = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
		expect(brute.length).toBe(32);
		expect(clePublique(brute.toString('base64')).asymmetricKeyType).toBe('ed25519');
	});

	it('refuses anything that is not an Ed25519 key', () => {
		const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
		const b64 = rsa.export({ format: 'der', type: 'spki' }).toString('base64');
		expect(() => clePublique(b64)).toThrow(/Ed25519/);
	});
});

describe('delivery verification', () => {
	const horodatage = '2026-08-03T04:07:13.902Z';

	it('accepts a genuine batch', () => {
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage, signature: signer(LOT, horodatage) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(true);
	});

	it('accepts a retry: same bytes, same signature, seconds later', () => {
		// Sirenic computes the signature ONCE for three attempts spread over ~33 s.
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage, signature: signer(LOT, horodatage) },
			CLE,
			MAINTENANT + 33_000,
			TOLERANCE,
		);
		expect(r.valide).toBe(true);
	});

	it('refuses a body altered by one byte', () => {
		const trafique = Buffer.from(LOT.toString('utf8').replace('552032534', '552032535'), 'utf8');
		const r = verifierLivraison(
			trafique,
			{ kid: KID, horodatage, signature: signer(LOT, horodatage) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(false);
		expect(r.raison).toMatch(/does not match/);
	});

	it('refuses a signature moved to another timestamp (replay)', () => {
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage: '2026-08-03T04:07:19.000Z', signature: signer(LOT, horodatage) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(false);
	});

	it('refuses a batch older than the window', () => {
		const vieux = '2026-08-03T03:00:00.000Z';
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage: vieux, signature: signer(LOT, vieux) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(false);
		expect(r.raison).toMatch(/window/);
	});

	it('names a key rotation instead of calling it a forgery', () => {
		const autre = 'ffffffffffffffff';
		const r = verifierLivraison(
			LOT,
			{ kid: autre, horodatage, signature: signer(LOT, horodatage, autre) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(false);
		// The node keys its refetch on this wording.
		expect(r.raison).toMatch(/^unknown key id/);
	});

	it('refuses an unsigned batch and says which header is missing', () => {
		expect(verifierLivraison(LOT, {}, CLE, MAINTENANT, TOLERANCE).raison).toMatch(/missing/);
	});

	it('refuses a signature of the wrong length without throwing', () => {
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage, signature: Buffer.alloc(32).toString('base64') },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(false);
		expect(r.raison).toMatch(/64 bytes/);
	});

	it('refuses an unparsable timestamp', () => {
		const r = verifierLivraison(
			LOT,
			{ kid: KID, horodatage: 'yesterday', signature: signer(LOT, 'yesterday') },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.raison).toMatch(/timestamp/);
	});

	it('verifies a body with non-ASCII bytes (the API sends accented French)', () => {
		const accents = Buffer.from(
			JSON.stringify({ verification: 'signature détachée — accents, œ, €' }),
			'utf8',
		);
		const r = verifierLivraison(
			accents,
			{ kid: KID, horodatage, signature: signer(accents, horodatage) },
			CLE,
			MAINTENANT,
			TOLERANCE,
		);
		expect(r.valide).toBe(true);
	});

	it('matches the digest the API computes', () => {
		// Guards the message format itself, not just the round trip.
		const attendu = `sirenic-v1:${KID}:2026-08-03T04:07:13.902Z:${createHash('sha256').update(LOT).digest('base64')}`;
		expect(messageSigne(KID, '2026-08-03T04:07:13.902Z', LOT).toString('utf8')).toBe(attendu);
	});
});

describe('event deduplication', () => {
	const evenement = {
		cible: { type: 'entreprise', siren: '552032534', nom: null },
		type: 'annonce_bodacc',
		detail: { famille: 'procedure_collective', date: '2026-08-01', id: 'A202600123456' },
		survenu_le: '2026-08-03T04:07:11.482Z',
	};

	it('gives the same key to a redelivered event', () => {
		// The API exposes no event id, and an undelivered batch returns the next
		// day: the key must come out of the content, and survunu_le is stable.
		expect(cleEvenement('sw_a', evenement)).toBe(cleEvenement('sw_a', { ...evenement }));
	});

	it('separates two events that differ only by their detail', () => {
		const autre = { ...evenement, detail: { ...evenement.detail, id: 'A202600999999' } };
		expect(cleEvenement('sw_a', evenement)).not.toBe(cleEvenement('sw_a', autre));
	});

	it('separates the same change on two different companies', () => {
		const autre = { ...evenement, cible: { type: 'entreprise', siren: '542065479', nom: null } };
		expect(cleEvenement('sw_a', evenement)).not.toBe(cleEvenement('sw_a', autre));
	});

	it('separates two watches', () => {
		expect(cleEvenement('sw_a', evenement)).not.toBe(cleEvenement('sw_b', evenement));
	});

	it('separates a company target from a director target with the same name field', () => {
		const dirigeant = { ...evenement, cible: { type: 'dirigeant', siren: null, nom: '552032534' } };
		expect(cleEvenement('sw_a', evenement)).not.toBe(cleEvenement('sw_a', dirigeant));
	});

	it('does not throw on a malformed event', () => {
		expect(() => cleEvenement('sw_a', undefined)).not.toThrow();
		expect(() => cleEvenement('sw_a', { cible: null })).not.toThrow();
	});
});
