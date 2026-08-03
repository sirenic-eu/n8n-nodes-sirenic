/**
 * Verification of Sirenic's detached Ed25519 signatures — `node:crypto` only,
 * no dependency (this package ships none).
 *
 * The recipe is published at `/.well-known/sirenic-signing-key` and is the same
 * for surveillance webhooks and for every paid API response:
 *
 *   message   = utf8("sirenic-v1:" + kid + ":" + timestamp + ":" + sha256_b64(body))
 *   sha256_b64 = base64 of the sha256 of the RAW body bytes
 *   signature = base64, 64 bytes, in the X-Sirenic-Signature header
 *
 * Two consequences drive the code below: the digest covers the bytes as they
 * arrived — a re-serialised JSON would produce a different hash — and the key id
 * travels in a header, so a rotated key is detected rather than guessed.
 */
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** SPKI/DER prefix of an Ed25519 public key: 12 bytes, then the 32 raw bytes. */
const PREFIXE_SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** What `/.well-known/sirenic-signing-key` returns, reduced to what we use. */
export interface CleDeSignature {
	kid: string;
	alg: string;
	public_key: string;
}

/**
 * Builds a key object from what the well-known route serves: SPKI DER in
 * base64. A raw 32-byte key is accepted too, so a future format change on that
 * route degrades into a clear error rather than a silent verification failure.
 */
export function clePublique(base64: string): KeyObject {
	const octets = Buffer.from(base64.trim(), 'base64');
	if (octets.length === 32) {
		return createPublicKey({
			key: Buffer.concat([PREFIXE_SPKI_ED25519, octets]),
			format: 'der',
			type: 'spki',
		});
	}
	const cle = createPublicKey({ key: octets, format: 'der', type: 'spki' });
	if (cle.asymmetricKeyType !== 'ed25519') {
		throw new Error(
			`Expected an Ed25519 public key, got ${String(cle.asymmetricKeyType)}. Check ${'/.well-known/sirenic-signing-key'}.`,
		);
	}
	return cle;
}

/** The exact string Sirenic signed, rebuilt from the headers and the raw body. */
export function messageSigne(kid: string, horodatage: string, corps: Buffer): Buffer {
	const condensat = createHash('sha256').update(corps).digest('base64');
	return Buffer.from(`sirenic-v1:${kid}:${horodatage}:${condensat}`, 'utf8');
}

export interface ResultatVerification {
	valide: boolean;
	/** Why it was refused — safe to log, never contains the signature itself. */
	raison?: string;
}

/**
 * Verifies one delivery. Refusals are named so a user can tell a misconfigured
 * node from a replay attempt.
 *
 * `toleranceMs` guards against replays. Mind Sirenic's retry policy: the
 * signature and the timestamp are computed ONCE before three attempts spread
 * over ~33 s, and an undelivered batch comes back the next day with a FRESH
 * timestamp. A few minutes of tolerance is right; seconds would drop legitimate
 * retries.
 */
export function verifierLivraison(
	corps: Buffer,
	entetes: { kid?: string; horodatage?: string; signature?: string },
	cle: CleDeSignature,
	maintenantMs: number,
	toleranceMs: number,
): ResultatVerification {
	const { kid, horodatage, signature } = entetes;
	if (!kid || !horodatage || !signature) {
		return { valide: false, raison: 'missing signature headers' };
	}
	if (!egaliteConstante(kid, cle.kid)) {
		// A rotated key is the likely cause: the caller should refetch the
		// well-known document rather than assume an attack.
		return { valide: false, raison: `unknown key id ${kid}` };
	}
	const emisMs = Date.parse(horodatage);
	if (Number.isNaN(emisMs)) {
		return { valide: false, raison: 'unparsable timestamp' };
	}
	if (Math.abs(maintenantMs - emisMs) > toleranceMs) {
		return { valide: false, raison: 'timestamp outside the accepted window' };
	}
	const octetsSignature = Buffer.from(signature.trim(), 'base64');
	if (octetsSignature.length !== 64) {
		return { valide: false, raison: 'signature is not 64 bytes' };
	}
	// `null` as algorithm is required for Ed25519: PureEdDSA hashes internally,
	// and naming a digest here throws.
	const ok = verify(null, messageSigne(kid, horodatage, corps), clePublique(cle.public_key), octetsSignature);
	return ok ? { valide: true } : { valide: false, raison: 'signature does not match' };
}

/** Length-safe constant-time comparison. */
function egaliteConstante(a: string, b: string): boolean {
	const ba = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	if (ba.length !== bb.length) return false;
	return timingSafeEqual(ba, bb);
}

/**
 * Stable identity of an event, used to drop duplicates.
 *
 * The API exposes no event id and no sequence number, while a batch can arrive
 * up to three times with identical bytes (and again the next day if every
 * attempt failed). `survenu_le` is set once at detection and never updated, so
 * hashing the tuple below is stable across redeliveries.
 */
export function cleEvenement(surveillanceId: string, evenement: unknown): string {
	const e = (evenement ?? {}) as Record<string, unknown>;
	const cible = (e.cible ?? {}) as Record<string, unknown>;
	const parts = [
		surveillanceId,
		String(cible.type ?? ''),
		String(cible.siren ?? ''),
		String(cible.nom ?? ''),
		String(e.type ?? ''),
		String(e.survenu_le ?? ''),
		JSON.stringify(e.detail ?? null),
	];
	return createHash('sha256').update(parts.join('|')).digest('base64').slice(0, 32);
}
