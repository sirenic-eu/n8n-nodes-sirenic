/**
 * Every item says in which unit it reports what it cost.
 *
 * On the API-key rail the API debits credits, 1 credit = 1 euro: the same NUMBER
 * as the dollar price of the route, one price rule for both rails. Up to 0.15.0
 * the node reported those credits under `_sirenic.paid_usd` and
 * `_sirenic.execution_total_usd` with nothing to say so, and the credential
 * labelled its ceiling "Max Spend Per Execution (USD)": a user who read 0.50
 * "usd" spent 0.50 euro, and a ceiling of "5 USD" was a ceiling of 5 credits.
 * Same number, wrong unit.
 *
 * Nothing is renamed, since workflows may read `paid_usd`: `_sirenic.unit` names
 * the unit of both amounts, `usd` on the wallet rail and `credits_eur` on the
 * API-key rail, and the API-key credential labels its ceiling in credits. The
 * internal name of that ceiling, `maxSpendPerExecution`, does not change, so no
 * saved credential breaks.
 *
 * The cases drive the whole node (`execute`) with ONLY the credential of the
 * chosen rail configured, the way n8n resolves it (helpers/identifiants.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INodeParameters } from 'n8n-workflow';
import { SirenicApiKeyApi } from '../credentials/SirenicApiKeyApi.credentials';
import { Sirenic } from '../nodes/Sirenic/Sirenic.node';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';
import { lecteurIdentifiants, type Identifiants } from './helpers/identifiants';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const CLE_API = 'srn_live_jamais_valide_de_test';
const BASE = 'https://api.example.test';

afterEach(() => vi.unstubAllGlobals());

/** The quote of a route priced $0.50, as the API sends it in PAYMENT-REQUIRED. */
const DEVIS = Buffer.from(
	JSON.stringify({
		x402Version: 2,
		resource: { url: `${BASE}/v1/entreprise/552032534` },
		accepts: [
			{
				scheme: 'exact',
				network: NETWORK,
				asset: USDC,
				payTo: PAY_TO,
				amount: '500000',
				maxTimeoutSeconds: 120,
				extra: { name: 'USD Coin', version: '2' },
			},
		],
	}),
).toString('base64');

function json(corps: unknown, status: number, entetes: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(corps), {
		status,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

/**
 * The API as each rail meets it on a route priced $0.50: with no key and no
 * signature it quotes (402); with a key it serves and reports what it debited,
 * in credits; with a signature it serves. Returns the requests it received.
 */
function apiPayante(debitCredits = '0.5'): string[] {
	const appels: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			appels.push(String(url));
			const entetes = new Headers(init?.headers);
			if (entetes.get('X-Api-Key')) {
				return json({ siren: '552032534' }, 200, { 'x-credits-charged': debitCredits });
			}
			if (entetes.get('PAYMENT-SIGNATURE')) return json({ siren: '552032534' }, 200);
			return json({ error: 'payment_required' }, 402, { 'payment-required': DEVIS });
		}),
	);
	return appels;
}

function cleApi(maxSpendPerExecution: number): Identifiants {
	return { sirenicApiKeyApi: { apiKey: CLE_API, baseUrl: BASE, maxSpendPerExecution } };
}

const RAILS: Array<{ rail: 'apiKey' | 'x402'; unite: string; identifiants: Identifiants }> = [
	{ rail: 'apiKey', unite: 'credits_eur', identifiants: cleApi(5) },
	{
		rail: 'x402',
		unite: 'usd',
		identifiants: {
			sirenicApi: {
				privateKey: KEY,
				baseUrl: BASE,
				payTo: PAY_TO,
				maxAmountPerCall: 1,
				maxAmountPerExecution: 5,
			},
		},
	},
];

/** A minimal IExecuteFunctions: `items` items, one company profile each, n8n's credential rules. */
function contexte(
	rail: 'apiKey' | 'x402',
	identifiants: Identifiants,
	items = 1,
	options: Record<string, unknown> = {},
) {
	const node = new Sirenic();
	const params: Record<string, unknown> = {
		authentication: rail,
		resource: 'frenchCompany',
		operation: 'getProfile',
		siren: '552032534',
		options,
	};
	return {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter: (nom: string, _item: number, defaut?: unknown) =>
			nom in params ? params[nom] : defaut,
		getNode: () => ({
			name: 'Sirenic',
			type: 'n8n-nodes-sirenic.sirenic',
			typeVersion: 1,
			position: [0, 0],
			parameters: params,
		}),
		getCredentials: lecteurIdentifiants(node.description, params as INodeParameters, identifiants),
		continueOnFail: () => false,
		helpers: {},
	} as unknown as IExecuteFunctions;
}

async function sirenic(contexteExecution: IExecuteFunctions) {
	const [items = []] = await new Sirenic().execute.call(contexteExecution);
	return items.map((item) => (item.json as { _sirenic: Record<string, unknown> })._sirenic);
}

describe.each(RAILS)('_sirenic on the $rail rail', ({ rail, unite, identifiants }) => {
	it(`reports what each paid call cost, under the same names as before, in ${unite}`, async () => {
		apiPayante();

		const sorties = await sirenic(contexte(rail, identifiants, 2));

		const commun = { resource: 'frenchCompany', operation: 'getProfile', status: 200, unit: unite };
		expect(sorties).toEqual([
			{ ...commun, paid_usd: 0.5, execution_total_usd: 0.5 },
			{ ...commun, paid_usd: 0.5, execution_total_usd: 1 },
		]);
	});

	it(`a dry run and a free route name the unit too: ${unite}`, async () => {
		apiPayante();
		const [essai] = await sirenic(contexte(rail, identifiants, 1, { dryRun: true }));
		expect(essai).toMatchObject({ status: 402, paid_usd: 0, execution_total_usd: 0, unit: unite });

		vi.stubGlobal('fetch', vi.fn(async () => json({ suggestions: [] }, 200)));
		const [gratuit] = await sirenic(contexte(rail, identifiants));
		expect(gratuit).toMatchObject({ status: 200, paid_usd: 0, execution_total_usd: 0, unit: unite });
	});
});

describe('the API-key rail counts credits, and says so', () => {
	it('its credential labels the ceiling in credits, under the same internal name', () => {
		const plafond = new SirenicApiKeyApi().properties.find((p) => p.name === 'maxSpendPerExecution');

		expect(plafond?.displayName).toBe('Max Spend Per Execution (credits, 1 credit = 1 euro)');
		expect(`${plafond?.displayName} ${plafond?.description}`).not.toMatch(/usd|dollar|\$/i);
	});

	it('the ceiling it enforces is read in credits, and its refusal counts credits, never USD', async () => {
		// Ceiling of 0.5 credit, a route quoted 0.5 and debited 0.4: the first
		// call fits (0.5), the second would reach 0.9 and is refused before the
		// key is sent. Up to 0.16.0 the second was sent too, and 0.8 credit was
		// charged under a ceiling of 0.5.
		const appels = apiPayante('0.4');

		const refus = await sirenic(contexte('apiKey', cleApi(0.5), 3)).then(
			() => null,
			(erreur: unknown) => erreur,
		);

		// Two quotes asked for without the key, one call sent with it.
		expect(appels).toHaveLength(3);
		expect(refus).toBeInstanceOf(Error);
		const message = (refus as Error).message;
		expect(message).toMatch(
			/Spending ceiling: this call is quoted 0\.5 credits and would bring the execution total to 0\.9 credits, above the "Max Spend Per Execution" ceiling of 0\.5 credits \(1 credit = 1 euro\)/,
		);
		expect(message).not.toMatch(/usd|dollar|\$/i);
	});
});
