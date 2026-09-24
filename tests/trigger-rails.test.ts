/**
 * A managed watch works on EITHER payment rail, with only that rail's credential.
 *
 * Since 0.13.0 the API key is the default rail, and n8n only shows, and only
 * lets the node read, the credential of the chosen rail. `urlBase()` kept
 * reading the wallet credential whatever the rail, so on the default rail every
 * FREE call of a managed watch failed: reading it back (re-activation,
 * polling), stopping it (a changed target list, deactivation) and fetching the
 * key that verifies webhook signatures. The paid call went through, so a user
 * could pay for a watch whose events never arrived. n8n's review of 0.14.0
 * found it on 23 Sep 2026; the tests did not, because their stub answered any
 * credential name with the wallet (see helpers/identifiants.ts).
 *
 * Every case runs with ONE credential configured and checks that the free calls
 * reach the server of the credential that pays: the paid call and the reads of
 * a watch must never target two different servers.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IHookFunctions, IPollFunctions, IWebhookFunctions } from 'n8n-workflow';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';
import { SirenicTrigger } from '../nodes/SirenicTrigger/SirenicTrigger.node';
import { messageSigne, type CleDeSignature } from '../nodes/SirenicTrigger/signature';
import { lecteurIdentifiants, type Identifiants } from './helpers/identifiants';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const CLE_API = 'srn_live_jamais_valide_de_test';
const URL_WEBHOOK = 'https://n8n.example.test/webhook/6f2a/webhook';
const CIBLES = '552032534,542065479';
const CLES_CIBLES = ['entreprise:542065479', 'entreprise:552032534'];

const trigger = new SirenicTrigger();
const hooks = trigger.webhookMethods.default;

afterEach(() => vi.unstubAllGlobals());

/** One paid request, as `fetch` received it. */
interface AppelPaye {
	url: string;
	entetes: Record<string, string>;
}

interface Rail {
	rail: 'apiKey' | 'x402';
	/** The only credential configured on the node. */
	identifiants: Identifiants;
	/** Server of that credential: every call of the watch must go there. */
	base: string;
	/** Answers the paid call the way the API does on this rail. */
	reseauPayant: (corps: Record<string, unknown>) => AppelPaye[];
	/** Proves the paid call really went through this rail. */
	verifierPaiement: (appels: AppelPaye[]) => void;
}

/** A signable x402 v2 quote, as the API sends it in the PAYMENT-REQUIRED header. */
function quote(amount: string, ressource: string) {
	return Buffer.from(
		JSON.stringify({
			x402Version: 2,
			resource: ressource,
			accepts: [
				{
					scheme: 'exact',
					network: NETWORK,
					asset: USDC,
					payTo: PAY_TO,
					amount,
					maxTimeoutSeconds: 120,
					extra: { name: 'USD Coin', version: '2' },
				},
			],
		}),
	).toString('base64');
}

function json(corps: unknown, statut = 200, entetes: Record<string, string> = {}) {
	return new Response(JSON.stringify(corps), {
		status: statut,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

/** Stubs `fetch` and records every paid request with its headers. */
function reseau(repondre: (appels: AppelPaye[], url: string) => Response): AppelPaye[] {
	const appels: AppelPaye[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			appels.push({ url: String(url), entetes: { ...(init?.headers as Record<string, string>) } });
			return repondre(appels, String(url));
		}),
	);
	return appels;
}

// Two different servers, so that a read sent to the server of the wrong
// credential cannot pass unnoticed.
const RAILS: Rail[] = [
	{
		rail: 'apiKey',
		identifiants: {
			sirenicApiKeyApi: {
				apiKey: CLE_API,
				baseUrl: 'https://cle.example.test/',
				maxSpendPerExecution: 5,
			},
		},
		base: 'https://cle.example.test',
		reseauPayant: (corps) =>
			reseau(() => json(corps, 200, { 'x-credits-charged': '0.1' })),
		verifierPaiement: (appels) => {
			expect(appels).toHaveLength(1);
			expect(appels[0]!.entetes['X-Api-Key']).toBe(CLE_API);
		},
	},
	{
		rail: 'x402',
		identifiants: {
			sirenicApi: {
				privateKey: KEY,
				baseUrl: 'https://wallet.example.test',
				payTo: PAY_TO,
				maxAmountPerCall: 2,
				maxAmountPerExecution: 10,
			},
		},
		base: 'https://wallet.example.test',
		reseauPayant: (corps) =>
			reseau((appels, url) =>
				appels.length === 1
					? json({}, 402, { 'payment-required': quote('100000', url) })
					: json(corps),
			),
		verifierPaiement: (appels) => {
			expect(appels).toHaveLength(2);
			expect(appels[1]!.entetes['PAYMENT-SIGNATURE']).toBeTruthy();
		},
	},
];

/** What the free read route answers for a live watch on the two SIRENs. */
function watchVivante(expireLe: string, evenements: unknown[] = []) {
	return {
		surveillance_id: 'sw_vivante',
		statut: 'active',
		expire_le: expireLe,
		cibles: [
			{ type: 'entreprise', siren: '552032534', nom: null },
			{ type: 'entreprise', siren: '542065479', nom: null },
		],
		evenements,
	};
}

const EVENEMENT = {
	cible: { type: 'entreprise', siren: '552032534', nom: null },
	type: 'changement_etat_administratif',
	detail: { avant: 'actif', apres: 'cesse' },
	survenu_le: '2026-09-24T04:07:11.482Z',
};

const PAIRE = generateKeyPairSync('ed25519');
const CLE_SIGNATURE: CleDeSignature = {
	kid: 'kid-test-t171',
	alg: 'Ed25519',
	public_key: PAIRE.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
};

interface Options {
	params?: Record<string, unknown>;
	statique?: Record<string, unknown>;
	/** Expiry of the watch the read route returns; two months away by default. */
	expireLe?: string;
	/** Events of the watch the read route returns. */
	evenements?: unknown[];
	/** The body of the incoming webhook request, signed with the test key pair. */
	livraison?: Buffer;
}

/**
 * One context with what the hooks, the poll and the webhook read. The free
 * route answers ONLY on the server given here, with the watch, its stop and
 * the signing key; anything else fails like an unreachable host.
 */
function contexte(identifiants: Identifiants, base: string, o: Options = {}) {
	const params: Record<string, unknown> = {
		watchSource: 'managed',
		targets: CIBLES,
		duree: 30,
		mode: 'webhook',
		autoRenew: true,
		stopOnDeactivate: false,
		verifySignature: true,
		ignoreDegraded: false,
		...o.params,
	};
	const statique: Record<string, unknown> = { ...o.statique };
	const watch = watchVivante(
		o.expireLe ?? new Date(Date.now() + 60 * 864e5).toISOString(),
		o.evenements,
	);
	const httpRequest = vi.fn(async (requete: { url: string }) => {
		const url = String(requete.url);
		if (url === `${base}/v1/surveillance/sw_vivante`) return watch;
		if (url.startsWith(`${base}/v1/surveillance/`) && url.endsWith('/arreter')) return {};
		if (url === `${base}/.well-known/sirenic-signing-key`) return CLE_SIGNATURE;
		throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${url}`), { code: 'ENOTFOUND' });
	});

	const horodatage = new Date().toISOString();
	const corps = o.livraison ?? Buffer.from('{}');
	const entetes: Record<string, string> = {
		'x-sirenic-key-id': CLE_SIGNATURE.kid,
		'x-sirenic-timestamp': horodatage,
		'x-sirenic-signature': sign(
			null,
			messageSigne(CLE_SIGNATURE.kid, horodatage, corps),
			PAIRE.privateKey,
		).toString('base64'),
	};
	const refus: Array<{ statut: number; corps: unknown }> = [];

	const ctx = {
		getNodeParameter: (nom: string, defaut?: unknown) => (nom in params ? params[nom] : defaut),
		getWorkflowStaticData: () => statique,
		getNode: () => ({
			name: 'Sirenic Trigger',
			type: 'n8n-nodes-sirenic.sirenicTrigger',
			typeVersion: 1,
			position: [0, 0],
			parameters: params,
		}),
		getMode: () => 'trigger',
		getActivationMode: () => 'activate',
		getNodeWebhookUrl: () => URL_WEBHOOK,
		getCredentials: lecteurIdentifiants(
			trigger.description,
			params as Parameters<typeof lecteurIdentifiants>[1],
			identifiants,
		),
		getRequestObject: () => ({
			rawBody: corps,
			body: JSON.parse(corps.toString('utf8')),
			readRawBody: async () => {},
			header: (nom: string) => entetes[nom.toLowerCase()],
		}),
		getResponseObject: () => ({
			status: (statut: number) => ({
				json: (c: unknown) => {
					refus.push({ statut, corps: c });
				},
			}),
		}),
		helpers: { httpRequest },
	};
	const urls = () => httpRequest.mock.calls.map(([requete]) => String(requete.url));
	return { ctx, statique, urls, refus };
}

describe.each(RAILS)('a managed watch on the $rail rail, with only its credential', (r) => {
	it('re-activation reads the stored watch from that server and re-uses it', async () => {
		const { ctx, urls } = contexte(r.identifiants, r.base, {
			params: { authentication: r.rail },
			statique: { jeton: 'sw_vivante', cibles: CLES_CIBLES },
		});

		await expect(hooks.checkExists.call(ctx as unknown as IHookFunctions)).resolves.toBe(true);
		expect(urls()).toEqual([`${r.base}/v1/surveillance/sw_vivante`]);
	});

	it('a changed target list stops the old watch, then pays for the new one, on that server', async () => {
		const appels = r.reseauPayant({
			surveillance_id: 'sw_neuve',
			expire_le: '2026-10-24T08:00:00.000Z',
		});
		const { ctx, statique, urls } = contexte(r.identifiants, r.base, {
			params: { authentication: r.rail },
			statique: { jeton: 'sw_ancienne', cibles: ['entreprise:552032534'] },
		});

		await expect(hooks.create.call(ctx as unknown as IHookFunctions)).resolves.toBe(true);
		// A failed stop is only logged, so the stop itself is what is asserted: an
		// old watch left running keeps pushing events for targets nobody asked about.
		expect(urls()).toEqual([`${r.base}/v1/surveillance/sw_ancienne/arreter`]);
		expect(appels.map((a) => a.url.split('?')[0])).toEqual(
			appels.map(() => `${r.base}/v1/surveillance/creer`),
		);
		r.verifierPaiement(appels);
		expect(statique.jeton).toBe('sw_neuve');
	});

	it('deactivation with Stop the Watch stops it on that server and forgets it', async () => {
		const { ctx, statique, urls } = contexte(r.identifiants, r.base, {
			params: { authentication: r.rail, stopOnDeactivate: true },
			statique: { jeton: 'sw_vivante', cibles: CLES_CIBLES },
		});

		await expect(hooks.delete.call(ctx as unknown as IHookFunctions)).resolves.toBe(true);
		expect(urls()).toEqual([`${r.base}/v1/surveillance/sw_vivante/arreter`]);
		expect(Object.keys(statique)).toEqual([]);
	});

	it('polling reads the watch from that server and renews it there before expiry', async () => {
		const appels = r.reseauPayant({
			surveillance_id: 'sw_vivante',
			expire_le: '2027-01-01T00:00:00.000Z',
		});
		const { ctx, statique, urls } = contexte(r.identifiants, r.base, {
			params: { authentication: r.rail, mode: 'poll' },
			statique: { jeton: 'sw_vivante', cibles: CLES_CIBLES },
			// Two days left: inside the seven-day renewal margin.
			expireLe: new Date(Date.now() + 2 * 864e5).toISOString(),
			evenements: [EVENEMENT],
		});

		const sortie = await trigger.poll.call(ctx as unknown as IPollFunctions);
		expect(urls()).toEqual([`${r.base}/v1/surveillance/sw_vivante`]);
		expect(appels.map((a) => a.url)).toEqual(
			appels.map(
				() => `${r.base}/v1/surveillance/sw_vivante/renouveler?cibles=552032534%2C542065479&duree=30`,
			),
		);
		r.verifierPaiement(appels);
		expect(statique.expireLe).toBe('2027-01-01T00:00:00.000Z');
		expect(sortie?.[0]?.map((item) => item.json.type)).toEqual(['changement_etat_administratif']);
	});

	it('a signed delivery is checked against the key published by that server', async () => {
		const livraison = Buffer.from(
			JSON.stringify({ surveillance_id: 'sw_vivante', evenements: [EVENEMENT] }),
			'utf8',
		);
		const { ctx, urls, refus } = contexte(r.identifiants, r.base, {
			params: { authentication: r.rail },
			statique: { jeton: 'sw_vivante', cibles: CLES_CIBLES },
			livraison,
		});

		const sortie = await trigger.webhook.call(ctx as unknown as IWebhookFunctions);
		expect(urls()).toEqual([`${r.base}/.well-known/sirenic-signing-key`]);
		expect(refus).toEqual([]);
		expect(sortie.workflowData?.[0]?.map((item) => item.json.type)).toEqual([
			'changement_etat_administratif',
		]);
	});
});

describe('a watch created elsewhere', () => {
	// Reading a watch and receiving its events are authorised by its token: no
	// credential is configured here, and none may be read.
	const base = 'https://staging.example.test';
	const params = { watchSource: 'existing', watchToken: 'sw_vivante', baseUrl: `${base}/` };

	it('is polled from the API Base URL parameter, with no credential at all', async () => {
		const { ctx, urls } = contexte({}, base, {
			params: { ...params, mode: 'poll' },
			evenements: [EVENEMENT],
		});

		const sortie = await trigger.poll.call(ctx as unknown as IPollFunctions);
		expect(urls()).toEqual([`${base}/v1/surveillance/sw_vivante`]);
		expect(sortie?.[0]).toHaveLength(1);
	});

	it('verifies a delivery with the key of that same server, with no credential at all', async () => {
		const livraison = Buffer.from(
			JSON.stringify({ surveillance_id: 'sw_vivante', evenements: [EVENEMENT] }),
			'utf8',
		);
		const { ctx, urls, refus } = contexte({}, base, { params, livraison });

		const sortie = await trigger.webhook.call(ctx as unknown as IWebhookFunctions);
		expect(urls()).toEqual([`${base}/.well-known/sirenic-signing-key`]);
		expect(refus).toEqual([]);
		expect(sortie.workflowData?.[0]).toHaveLength(1);
	});
});
