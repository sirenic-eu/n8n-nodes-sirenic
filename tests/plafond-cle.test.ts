/**
 * The API-key ceiling refuses the call that would cross it, BEFORE the key is
 * sent.
 *
 * From 0.13.0 to 0.16.0, Max Spend Per Execution counted what the API reported
 * it charged (`x-credits-charged`) and refused the NEXT call: the call that
 * crossed the ceiling was sent and charged. A ceiling of 5 let a call charged
 * 10.5 through, and a ceiling of 1 with calls of 0.4 ended at 1.2. The trigger
 * never applied it: it built a new caller, starting at zero, for each paid call.
 *
 * Since 0.17.0, with a ceiling above 0, each paid call first asks the API for
 * its quote WITHOUT the key (the free 402 that Dry Run reads, through the same
 * `quotedPriceUsd`), and is refused when the credits already charged in the
 * execution plus that quote would exceed the ceiling. Equality passes, as on the
 * wallet rail.
 *
 * The simulated API answers as api.sirenic.eu does on a paid route: without a
 * key it quotes (402 and PAYMENT-REQUIRED), with a key it serves and reports
 * what it debited. What it records is the proof: a call refused by the ceiling
 * never reaches it with the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, IHookFunctions, INodeParameters, IPollFunctions } from 'n8n-workflow';
import { SirenicKeyCaller } from '../nodes/Sirenic/cle-api';
import { Sirenic } from '../nodes/Sirenic/Sirenic.node';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';
import { SirenicTrigger } from '../nodes/SirenicTrigger/SirenicTrigger.node';
import { lecteurIdentifiants, type Identifiants } from './helpers/identifiants';

/**
 * Counts the API-key callers the node and the trigger build. The class is the
 * real one: the count is the only thing added.
 */
const compteur = vi.hoisted(() => ({ appelants: 0 }));
vi.mock('../nodes/Sirenic/cle-api', async (importOriginal) => {
	const vrai = await importOriginal<{ SirenicKeyCaller: typeof SirenicKeyCaller }>();
	class AppelantCompte extends vrai.SirenicKeyCaller {
		constructor(...args: ConstructorParameters<typeof SirenicKeyCaller>) {
			super(...args);
			compteur.appelants++;
		}
	}
	return { ...vrai, SirenicKeyCaller: AppelantCompte };
});

const CLE = 'srn_live_jamais_valide_de_test';
const BASE = 'https://api.example.test';
const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

beforeEach(() => {
	compteur.appelants = 0;
});
afterEach(() => vi.unstubAllGlobals());

function json(corps: unknown, status: number, entetes: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(corps), {
		status,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

function b64(valeur: unknown): string {
	return Buffer.from(JSON.stringify(valeur)).toString('base64');
}

function option(asset: string, amount: string, name: string) {
	return {
		scheme: 'exact',
		network: NETWORK,
		asset,
		payTo: PAY_TO,
		amount,
		maxTimeoutSeconds: 120,
		extra: { name, version: '2' },
	};
}

/**
 * The PAYMENT-REQUIRED header of a route quoted `usd`, shaped as the API sends
 * it. Its EURC option comes first, one atomic unit dearer, so a reader that
 * took the wrong option would decide differently at the edge of the ceiling.
 */
function devis(usd: number): string {
	const atomique = Math.round(usd * 1_000_000);
	return b64({
		x402Version: 2,
		resource: { url: `${BASE}/v1/route` },
		accepts: [option(EURC, String(atomique + 1), 'EURC'), option(USDC, String(atomique), 'USD Coin')],
	});
}

/** One request as the simulated API received it. */
interface Requete {
	chemin: string;
	cle: string | null;
	autorisation: string | null;
}

/** What a paid route answers on the simulated API. */
interface Tarif {
	/** The quote: a dollar price, or the PAYMENT-REQUIRED header as sent (null: none). */
	devis: number | { entete: string | null };
	/** `x-credits-charged` of a call with the key (null: no header). The quoted price when absent. */
	debit?: string | null;
	/** Body of a call with the key. */
	corps?: Record<string, unknown>;
}

/**
 * Stubs `fetch` with the API as the API-key rail meets it. A path absent from
 * `tarifs` is off the price grid: free, the same answer with or without a key.
 */
function apiSimulee(tarifs: Record<string, Tarif>) {
	const requetes: Requete[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			const adresse = new URL(String(url));
			const chemin = adresse.pathname + adresse.search;
			const entetes = new Headers(init?.headers);
			const cle = entetes.get('X-Api-Key');
			requetes.push({ chemin, cle, autorisation: entetes.get('Authorization') });
			const tarif = tarifs[chemin];
			if (!tarif) return json({ suggestions: [] }, 200);
			if (cle === null) {
				const entete = typeof tarif.devis === 'number' ? devis(tarif.devis) : tarif.devis.entete;
				return json({ error: 'payment_required' }, 402, entete === null ? {} : { 'payment-required': entete });
			}
			const debit =
				tarif.debit !== undefined ? tarif.debit : typeof tarif.devis === 'number' ? String(tarif.devis) : '0';
			return json(tarif.corps ?? { ok: true }, 200, debit === null ? {} : { 'x-credits-charged': debit });
		}),
	);
	return {
		requetes,
		/** Paths that reached the API WITH the key: the calls that can be charged. */
		avecCle: () => requetes.filter((r) => r.cle !== null).map((r) => r.chemin),
		/** Paths whose quote was asked for, without the key. */
		sansCle: () => requetes.filter((r) => r.cle === null).map((r) => r.chemin),
	};
}

function appelant(plafond: number) {
	return new SirenicKeyCaller({ apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: plafond });
}

/** Calls each path in turn: what each call paid, or `refused: <message>`. */
async function jouer(a: SirenicKeyCaller, chemins: string[]): Promise<Array<number | string>> {
	const issues: Array<number | string> = [];
	for (const chemin of chemins) {
		try {
			issues.push((await a.call(chemin, 30_000, false)).paid);
		} catch (erreur) {
			issues.push(`refused: ${(erreur as Error).message}`);
		}
	}
	return issues;
}

/** One quoted route per path, each quoted (and charged) the price given. */
function tarifs(prix: Record<string, number>): Record<string, Tarif> {
	return Object.fromEntries(Object.entries(prix).map(([chemin, usd]) => [chemin, { devis: usd }]));
}

describe('API-key rail: the ceiling is checked against the quote, before the key is sent', () => {
	it('ceiling 5 (the default), a call quoted 10.5: refused before the key is sent, nothing charged', async () => {
		// The case of the review of 0.16.0: the call was sent and charged 10.5.
		const api = apiSimulee(tarifs({ '/v1/kyb/batch?sirens=418009726': 10.5 }));
		const a = appelant(5);

		const [issue] = await jouer(a, ['/v1/kyb/batch?sirens=418009726']);

		expect(issue).toMatch(/^refused: Spending ceiling/);
		expect(api.avecCle()).toEqual([]);
		expect(api.sansCle()).toEqual(['/v1/kyb/batch?sirens=418009726']);
		expect(a.totalPaid).toBe(0);
	});

	it('T1, ceiling 1, calls quoted and charged 0.5: the second passes at equality, the third is refused before it is sent', async () => {
		const api = apiSimulee(tarifs({ '/v1/kyb/1': 0.5, '/v1/kyb/2': 0.5, '/v1/kyb/3': 0.5 }));
		const a = appelant(1);

		const issues = await jouer(a, ['/v1/kyb/1', '/v1/kyb/2', '/v1/kyb/3']);

		expect(issues.slice(0, 2)).toEqual([0.5, 0.5]);
		expect(issues[2]).toMatch(/^refused: Spending ceiling/);
		expect(a.totalPaid).toBe(1);
		// Three quotes asked for without the key, two calls sent with it.
		expect(api.sansCle()).toEqual(['/v1/kyb/1', '/v1/kyb/2', '/v1/kyb/3']);
		expect(api.avecCle()).toEqual(['/v1/kyb/1', '/v1/kyb/2']);
	});

	it('T2, ceiling 1, calls of 0.45: the third would reach 1.35, so it is refused before it is sent', async () => {
		const api = apiSimulee(tarifs({ '/v1/kyb/1': 0.45, '/v1/kyb/2': 0.45, '/v1/kyb/3': 0.45 }));
		const a = appelant(1);

		const issues = await jouer(a, ['/v1/kyb/1', '/v1/kyb/2', '/v1/kyb/3']);

		expect(issues.slice(0, 2)).toEqual([0.45, 0.45]);
		expect(issues[2]).toMatch(/^refused: Spending ceiling/);
		expect(a.totalPaid).toBe(0.9);
		expect(api.avecCle()).toEqual(['/v1/kyb/1', '/v1/kyb/2']);
	});

	it('T3, ceiling 1, calls of 0.45, 0.45, 0.1 and 0.1: the third passes at exactly 1, the fourth (1.1) is refused before it is sent', async () => {
		const api = apiSimulee(tarifs({ '/v1/a': 0.45, '/v1/b': 0.45, '/v1/c': 0.1, '/v1/d': 0.1 }));
		const a = appelant(1);

		const issues = await jouer(a, ['/v1/a', '/v1/b', '/v1/c', '/v1/d']);

		expect(issues.slice(0, 3)).toEqual([0.45, 0.45, 0.1]);
		expect(issues[3]).toMatch(/^refused: Spending ceiling/);
		expect(a.totalPaid).toBe(1);
		expect(api.avecCle()).toEqual(['/v1/a', '/v1/b', '/v1/c']);
	});

	it('a total of exactly the ceiling passes whatever its decimals: 0.1, 0.2 and 0.7 under a ceiling of 1', async () => {
		// Added as floats, 0.1 + 0.2 + 0.7 is 1.0000000000000002: a comparison in
		// floats would refuse the third call, which the ceiling allows.
		const api = apiSimulee(tarifs({ '/v1/a': 0.1, '/v1/b': 0.2, '/v1/c': 0.7, '/v1/d': 0.002 }));
		const a = appelant(1);

		const issues = await jouer(a, ['/v1/a', '/v1/b', '/v1/c', '/v1/d']);

		expect(issues.slice(0, 3)).toEqual([0.1, 0.2, 0.7]);
		expect(a.totalPaid).toBe(1);
		// Not one thousandth more.
		expect(issues[3]).toMatch(/^refused: Spending ceiling/);
		expect(api.avecCle()).toEqual(['/v1/a', '/v1/b', '/v1/c']);
	});

	it('a quote counts in whole thousandths of a credit, rounded up as the API debits it', async () => {
		// The API debits whole thousandths, rounded up: a route quoted 0.0012 costs
		// 0.002 credit. A ceiling typed with more decimals than the field shows (an
		// expression can do that) must not let it through.
		const api = apiSimulee({ '/v1/a': { devis: 0.0012, debit: '0.002' } });
		const a = appelant(0.0015);

		const [issue] = await jouer(a, ['/v1/a']);

		expect(issue).toMatch(/^refused: Spending ceiling/);
		expect(api.avecCle()).toEqual([]);
	});

	it.each(['-0.5', '-Infinity', 'abc', 'Infinity', 'NaN', '', null])(
		'x-credits-charged %j counts 0, and the ceiling still holds',
		async (entete) => {
			// Ceiling 1, every call quoted 0.5. The second reports a debit that is not
			// a positive number: it counts 0, so the third call fits exactly and the
			// fourth is refused. A negative debit counted as such would lower the
			// total and let the fourth through.
			const api = apiSimulee({
				'/v1/a': { devis: 0.5 },
				'/v1/b': { devis: 0.5, debit: entete },
				'/v1/c': { devis: 0.5 },
				'/v1/d': { devis: 0.5 },
			});
			const a = appelant(1);

			const issues = await jouer(a, ['/v1/a', '/v1/b', '/v1/c', '/v1/d']);

			expect(issues.slice(0, 3)).toEqual([0.5, 0, 0.5]);
			expect(issues[3]).toMatch(/^refused: Spending ceiling/);
			expect(a.totalPaid).toBe(1);
			expect(api.avecCle()).toEqual(['/v1/a', '/v1/b', '/v1/c']);
		},
	);

	it('the refusal counts credits: the quote, the total it would reach and the ceiling, never USD', async () => {
		apiSimulee(tarifs({ '/v1/a': 0.4, '/v1/b': 0.8 }));
		const a = appelant(1);

		const [, refus] = await jouer(a, ['/v1/a', '/v1/b']);

		expect(refus).toBe(
			'refused: Spending ceiling: this call is quoted 0.8 credits and would bring the execution total to 1.2 credits, above the "Max Spend Per Execution" ceiling of 1 credits (1 credit = 1 euro). Nothing was charged: the key was not sent. Raise the ceiling on the Sirenic API Key credential, or send fewer items.',
		);
		expect(String(refus)).not.toMatch(/usd|dollar|\$/i);
	});

	it('the quote is asked for with neither the key nor an Authorization header, then the call goes out with the key', async () => {
		const api = apiSimulee(tarifs({ '/v1/entreprise/418009726': 0.005 }));

		await appelant(5).call('/v1/entreprise/418009726', 30_000, false);

		expect(api.requetes).toEqual([
			{ chemin: '/v1/entreprise/418009726', cle: null, autorisation: null },
			{ chemin: '/v1/entreprise/418009726', cle: CLE, autorisation: null },
		]);
	});

	it.each([
		{ cas: 'no PAYMENT-REQUIRED header', entete: null, raison: 'no_quote_header' },
		{ cas: 'a header that is not base64 JSON', entete: 'eyJ4NDAy', raison: 'unreadable_quote' },
		{ cas: 'x402 version 1', entete: b64({ x402Version: 1, accepts: [] }), raison: 'unsupported_x402_version' },
		{
			cas: 'no USDC option on Base',
			entete: b64({ x402Version: 2, accepts: [option(EURC, '500000', 'EURC')] }),
			raison: 'no_usdc_on_base_option',
		},
		{
			cas: 'an amount that is not a whole number of atomic units',
			entete: b64({ x402Version: 2, accepts: [option(USDC, '0.50', 'USD Coin')] }),
			raison: 'unreadable_quote',
		},
	])('a ceiling above 0 and $cas: refused with its reason, and the key is never sent', async ({ entete, raison }) => {
		const api = apiSimulee({ '/v1/rapport/418009726': { devis: { entete }, debit: '0.5' } });
		const a = appelant(5);

		const [issue] = await jouer(a, ['/v1/rapport/418009726']);

		expect(issue).toMatch(/^refused: The quote for this call could not be read/);
		expect(issue).toContain(`(${raison})`);
		expect(api.avecCle()).toEqual([]);
		expect(a.totalPaid).toBe(0);
	});

	it('a ceiling of 0 asks for no quote: every call goes straight out with the key', async () => {
		const api = apiSimulee(tarifs({ '/v1/intelligence/1': 9, '/v1/intelligence/2': 9 }));
		const a = appelant(0);

		const issues = await jouer(a, ['/v1/intelligence/1', '/v1/intelligence/2']);

		expect(issues).toEqual([9, 9]);
		expect(a.totalPaid).toBe(18);
		expect(api.sansCle()).toEqual([]);
		expect(api.avecCle()).toEqual(['/v1/intelligence/1', '/v1/intelligence/2']);
	});

	it('a free route answers the quote request with its data: that is the result, in one request, and the key is never sent', async () => {
		const api = apiSimulee({});

		const r = await appelant(5).call('/v1/reperer?texte=sirenic', 30_000, false);

		expect(r.status).toBe(200);
		expect(r.body).toEqual({ suggestions: [] });
		expect(r.paid).toBe(0);
		expect(api.requetes).toEqual([{ chemin: '/v1/reperer?texte=sirenic', cle: null, autorisation: null }]);
	});

	it('an error on the quote request is the answer, as on the wallet rail: nothing goes out with the key', async () => {
		const avecCle: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL, init?: RequestInit) => {
				if (new Headers(init?.headers).get('X-Api-Key')) {
					avecCle.push(String(url));
					return json({ ok: true }, 200, { 'x-credits-charged': '0.5' });
				}
				return new Response('Too many requests', { status: 429, headers: { 'content-type': 'text/plain' } });
			}),
		);
		const a = appelant(5);

		const r = await a.call('/v1/rapport/418009726', 30_000, false);

		expect(r.status).toBe(429);
		expect((r.body as { message?: string }).message).toBe('Too many requests');
		expect(r.paid).toBe(0);
		expect(avecCle).toEqual([]);
		expect(a.totalPaid).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The whole node                                                             */
/* -------------------------------------------------------------------------- */

/** A minimal IExecuteFunctions: `items` company profiles, only the API-key credential. */
function contexteNoeud(plafond: number, items: number, continuer: boolean) {
	const node = new Sirenic();
	const params: Record<string, unknown> = {
		authentication: 'apiKey',
		resource: 'frenchCompany',
		operation: 'getProfile',
		siren: '418009726',
		options: {},
	};
	const identifiants: Identifiants = {
		sirenicApiKeyApi: { apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: plafond },
	};
	return {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter: (nom: string, _item: number, defaut?: unknown) => (nom in params ? params[nom] : defaut),
		getNode: () => ({
			name: 'Sirenic',
			type: 'n8n-nodes-sirenic.sirenic',
			typeVersion: 1,
			position: [0, 0],
			parameters: params,
		}),
		getCredentials: lecteurIdentifiants(node.description, params as INodeParameters, identifiants),
		continueOnFail: () => continuer,
		helpers: {},
	} as unknown as IExecuteFunctions;
}

describe('the Sirenic node, API-key rail with only its credential', () => {
	const PROFIL = '/v1/entreprise/418009726';

	it('three items quoted 0.45 under a ceiling of 1: two are paid, the third (1.35) fails before the key is sent', async () => {
		const api = apiSimulee(tarifs({ [PROFIL]: 0.45 }));

		await expect(new Sirenic().execute.call(contexteNoeud(1, 3, false))).rejects.toThrow(
			/Spending ceiling: this call is quoted 0\.45 credits and would bring the execution total to 1\.35 credits/,
		);
		expect(api.avecCle()).toEqual([PROFIL, PROFIL]);
		expect(api.sansCle()).toEqual([PROFIL, PROFIL, PROFIL]);
		// One caller for the whole execution: that is what makes the ceiling bind across items.
		expect(compteur.appelants).toBe(1);
	});

	it('with Continue On Fail, the refused item is an error item without _sirenic, and nothing more is charged', async () => {
		const api = apiSimulee(tarifs({ [PROFIL]: 0.45 }));

		const [sortie = []] = await new Sirenic().execute.call(contexteNoeud(1, 3, true));

		const json = sortie.map((item) => item.json as Record<string, unknown>);
		expect(json.slice(0, 2).map((j) => (j._sirenic as Record<string, unknown>).execution_total_usd)).toEqual([
			0.45, 0.9,
		]);
		expect(json[2]!.error).toMatch(/^Spending ceiling/);
		expect(json[2]!._sirenic).toBeUndefined();
		expect(api.avecCle()).toEqual([PROFIL, PROFIL]);
	});
});

/* -------------------------------------------------------------------------- */
/* The trigger                                                                */
/* -------------------------------------------------------------------------- */

const trigger = new SirenicTrigger();
const hooks = trigger.webhookMethods.default;
const CIBLES = '418009726,712024140';

interface OptionsDeclencheur {
	duree?: number;
	plafond?: number;
	/** Expiry of the watch the free read route returns. */
	expireLe?: string;
	statique?: Record<string, unknown>;
}

/** A trigger context in polling delivery, with only the API-key credential. */
function contexteDeclencheur(o: OptionsDeclencheur = {}) {
	const params: Record<string, unknown> = {
		authentication: 'apiKey',
		watchSource: 'managed',
		targets: CIBLES,
		duree: o.duree ?? 30,
		mode: 'poll',
		autoRenew: true,
		stopOnDeactivate: false,
		ignoreDegraded: false,
	};
	const statique: Record<string, unknown> = { ...o.statique };
	const watch = {
		surveillance_id: 'sw_vivante',
		statut: 'active',
		expire_le: o.expireLe ?? new Date(Date.now() + 60 * 864e5).toISOString(),
		cibles: [
			{ type: 'entreprise', siren: '418009726', nom: null },
			{ type: 'entreprise', siren: '712024140', nom: null },
		],
		evenements: [],
	};
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
		getNodeWebhookUrl: () => 'https://n8n.example.test/webhook/6f2a/webhook',
		getCredentials: lecteurIdentifiants(trigger.description, params as INodeParameters, {
			sirenicApiKeyApi: { apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: o.plafond ?? 5 },
		}),
		// The free read route of the watch; nothing else is reachable.
		helpers: {
			httpRequest: vi.fn(async (requete: { url: string }) => {
				if (requete.url === `${BASE}/v1/surveillance/sw_vivante`) return watch;
				throw new Error(`getaddrinfo ENOTFOUND ${requete.url}`);
			}),
		},
	};
	return { ctx, statique };
}

const CREER = (duree: number) => `/v1/surveillance/creer?cibles=418009726%2C712024140&duree=${duree}`;
const RENOUVELER = '/v1/surveillance/sw_vivante/renouveler?cibles=418009726%2C712024140&duree=30';
const NOUVELLE = { surveillance_id: 'sw_neuve', expire_le: '2027-10-04T08:00:00.000Z' };

describe('the Sirenic Trigger, API-key rail with only its credential', () => {
	it('activation: a watch quoted 50 (100 targets for a year) under the default ceiling of 5 is refused before the key is sent', async () => {
		const api = apiSimulee({ [CREER(365)]: { devis: 50, corps: NOUVELLE } });
		const { ctx, statique } = contexteDeclencheur({ duree: 365 });

		await expect(hooks.create.call(ctx as unknown as IHookFunctions)).rejects.toThrow(
			/^Creating the watch failed: Spending ceiling: this call is quoted 50 credits/,
		);
		expect(api.avecCle()).toEqual([]);
		expect(api.sansCle()).toEqual([CREER(365)]);
		expect(statique.jeton).toBeUndefined();
	});

	it('renewal: a renewal quoted above the ceiling is refused before the key is sent', async () => {
		const api = apiSimulee({ [RENOUVELER]: { devis: 13.5, corps: { expire_le: '2027-01-01T00:00:00.000Z' } } });
		const { ctx, statique } = contexteDeclencheur({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:418009726', 'entreprise:712024140'] },
			// Two days left: inside the seven-day renewal margin.
			expireLe: new Date(Date.now() + 2 * 864e5).toISOString(),
		});

		await expect(trigger.poll.call(ctx as unknown as IPollFunctions)).rejects.toThrow(
			/^Renewing the watch failed: Spending ceiling: this call is quoted 13\.5 credits/,
		);
		expect(api.avecCle()).toEqual([]);
		expect(statique.expireLe).not.toBe('2027-01-01T00:00:00.000Z');
	});

	it('one caller per execution: an activation builds one, a poll that renews builds one, a poll with nothing to pay builds none', async () => {
		const api = apiSimulee({
			[CREER(30)]: { devis: 0.1, corps: NOUVELLE },
			[RENOUVELER]: { devis: 0.1, corps: { expire_le: '2027-01-01T00:00:00.000Z' } },
		});

		await hooks.create.call(contexteDeclencheur().ctx as unknown as IHookFunctions);
		expect(compteur.appelants).toBe(1);

		compteur.appelants = 0;
		const renouvelle = contexteDeclencheur({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:418009726', 'entreprise:712024140'] },
			expireLe: new Date(Date.now() + 2 * 864e5).toISOString(),
		});
		await trigger.poll.call(renouvelle.ctx as unknown as IPollFunctions);
		expect(compteur.appelants).toBe(1);
		expect(renouvelle.statique.expireLe).toBe('2027-01-01T00:00:00.000Z');

		compteur.appelants = 0;
		const rien = contexteDeclencheur({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:418009726', 'entreprise:712024140'] },
		});
		await trigger.poll.call(rien.ctx as unknown as IPollFunctions);
		expect(compteur.appelants).toBe(0);

		expect(api.avecCle()).toEqual([CREER(30), RENOUVELER]);
	});
});
