/**
 * Dry Run states the price the API quotes, on EITHER payment rail.
 *
 * The option promises "Returns what the call would cost". Since 0.13.0 the API
 * key is the default rail, and on that rail the dry run returned
 * `quote: "see PAYMENT-REQUIRED header"` instead of a price: n8n shows the body
 * of a response, never its headers, so the promise was false on the default
 * rail. The wallet rail had always decoded that header. Same family as the
 * trigger of 0.15.0 and W12: a path written for the wallet, never played on
 * the key.
 *
 * These cases drive the whole node (`execute`), with ONLY the credential of the
 * chosen rail configured, the way n8n resolves it (helpers/identifiants.ts), and
 * a quote shaped like the one api.sirenic.eu serves (measured on 24 Sep 2026:
 * x402 v2, one USDC and one EURC option on Base, a Bazaar extension). The EURC
 * option comes FIRST here and carries another amount, so a reader that took the
 * first option, or any option, would state a wrong price.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INodeParameters } from 'n8n-workflow';
import { Sirenic } from '../nodes/Sirenic/Sirenic.node';
import { SirenicKeyCaller } from '../nodes/Sirenic/cle-api';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';
import { lecteurIdentifiants, type Identifiants } from './helpers/identifiants';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const CLE_API = 'srn_live_jamais_valide_de_test';

afterEach(() => vi.unstubAllGlobals());

interface Option {
	scheme: string;
	network: string;
	asset: string;
	payTo: string;
	amount: string;
	maxTimeoutSeconds: number;
	extra: { name: string; version: string };
}

function option(asset: string, amount: string, name: string, over: Partial<Option> = {}): Option {
	return {
		scheme: 'exact',
		network: NETWORK,
		asset,
		payTo: PAY_TO,
		amount,
		maxTimeoutSeconds: 120,
		extra: { name, version: '2' },
		...over,
	};
}

/** The PAYMENT-REQUIRED header of a 402, shaped as the API sends it. */
function entete(accepts: Option[], x402Version = 2): string {
	return Buffer.from(
		JSON.stringify({
			x402Version,
			resource: {
				url: 'https://api.sirenic.eu/v1/rapport/{siren}',
				description: 'PDF report on a French company, on demand',
				mimeType: 'application/pdf',
			},
			accepts,
			extensions: { bazaar: { info: {} } },
		}),
	).toString('base64');
}

/** $0.50 in USDC, listed AFTER an EURC option at another amount. */
const DEVIS_RAPPORT = entete([
	option(EURC, '600000', 'EURC'),
	option(USDC, '500000', 'USD Coin'),
]);

/**
 * The 402 body the API sends along. It states the price in prose: the node must
 * never read a price from there, only from the signable quote.
 */
function reponse402(entetePaiement: string | null): Response {
	return new Response(
		JSON.stringify({
			x402Version: 2,
			error: 'payment_required',
			message: 'Paid endpoint. Retry with an x402 payment header. Price: $0.50 in USDC.',
		}),
		{
			status: 402,
			headers: {
				'content-type': 'application/json',
				...(entetePaiement === null ? {} : { 'payment-required': entetePaiement }),
			},
		},
	);
}

interface Appel {
	url: string;
	entetes: Headers;
}

/** Stubs `fetch`: every request gets the same 402, and is recorded. */
function reseau(entetePaiement: string | null): Appel[] {
	const appels: Appel[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			appels.push({ url: String(url), entetes: new Headers(init?.headers) });
			return reponse402(entetePaiement);
		}),
	);
	return appels;
}

const RAILS: Array<{ rail: 'apiKey' | 'x402'; identifiants: Identifiants }> = [
	{
		rail: 'apiKey',
		identifiants: {
			sirenicApiKeyApi: {
				apiKey: CLE_API,
				baseUrl: 'https://api.example.test',
				maxSpendPerExecution: 5,
			},
		},
	},
	{
		rail: 'x402',
		identifiants: {
			sirenicApi: {
				privateKey: KEY,
				baseUrl: 'https://api.example.test',
				payTo: PAY_TO,
				maxAmountPerCall: 1,
				maxAmountPerExecution: 5,
			},
		},
	},
];

/** A minimal IExecuteFunctions: one item, the node's parameters, n8n's credential rules. */
function contexte(rail: 'apiKey' | 'x402', identifiants: Identifiants) {
	const node = new Sirenic();
	const params: Record<string, unknown> = {
		authentication: rail,
		resource: 'dueDiligence',
		operation: 'getReport',
		siren: '552032534',
		options: { dryRun: true },
	};
	return {
		getInputData: () => [{ json: {} }],
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

async function essai(rail: 'apiKey' | 'x402', identifiants: Identifiants) {
	const [items = []] = await new Sirenic().execute.call(contexte(rail, identifiants));
	expect(items).toHaveLength(1);
	return items[0]!.json as Record<string, unknown> & {
		_sirenic: { status: number; paid_usd: number; execution_total_usd: number };
	};
}

describe.each(RAILS)('Dry Run on the $rail rail, with only its credential', ({ rail, identifiants }) => {
	it('states the USDC price of the quote in would_pay_usd, and pays nothing', async () => {
		const appels = reseau(DEVIS_RAPPORT);

		const sortie = await essai(rail, identifiants);

		expect(sortie.dry_run).toBe(true);
		expect(sortie.would_pay_usd).toBe(0.5);
		expect(sortie._sirenic.status).toBe(402);
		expect(sortie._sirenic.paid_usd).toBe(0);
		expect(sortie._sirenic.execution_total_usd).toBe(0);
		// One unpaid request: a dry run never replays with a signature or a key.
		expect(appels).toHaveLength(1);
		expect(appels[0]!.url).toBe('https://api.example.test/v1/rapport/552032534');
		expect(appels[0]!.entetes.get('PAYMENT-SIGNATURE')).toBeNull();
		expect(appels[0]!.entetes.get('X-Api-Key')).toBeNull();
	});
});

describe('Dry Run on the API-key rail, when the quote cannot be read', () => {
	const appelant = () =>
		new SirenicKeyCaller({ apiKey: CLE_API, baseUrl: 'https://api.example.test', maxSpendPerExecution: 5 });

	/** The dry run of one call against a 402 carrying this header (or none). */
	async function prixLu(entetePaiement: string | null) {
		reseau(entetePaiement);
		const r = await appelant().call('/v1/rapport/552032534', 30_000, true);
		expect(r.status).toBe(402);
		expect(r.dryRun).toBe(true);
		expect(r.paid).toBe(0);
		return r.body as Record<string, unknown>;
	}

	it('no PAYMENT-REQUIRED header: no price, a reason, and never the price written in the body', async () => {
		const corps = await prixLu(null);
		expect(corps.would_pay_usd).toBeNull();
		expect(corps.price_unavailable_reason).toBe('no_quote_header');
	});

	it('a header that is not base64 JSON: no price, a reason', async () => {
		const corps = await prixLu('eyJ4NDAy');
		expect(corps.would_pay_usd).toBeNull();
		expect(corps.price_unavailable_reason).toBe('unreadable_quote');
	});

	it('another x402 version: no price, a reason', async () => {
		const corps = await prixLu(entete([option(USDC, '500000', 'USD Coin')], 1));
		expect(corps.would_pay_usd).toBeNull();
		expect(corps.price_unavailable_reason).toBe('unsupported_x402_version');
	});

	it('no USDC option on Base (EURC only, or USDC on another chain): no price, a reason', async () => {
		for (const accepts of [
			[option(EURC, '500000', 'EURC')],
			[option(USDC, '500000', 'USD Coin', { network: 'eip155:1' })],
			[option(USDC, '500000', 'USD Coin', { scheme: 'upto' })],
		]) {
			const corps = await prixLu(entete(accepts));
			expect(corps.would_pay_usd).toBeNull();
			expect(corps.price_unavailable_reason).toBe('no_usdc_on_base_option');
		}
	});

	it('an amount that is not an integer of atomic units: no price, a reason', async () => {
		const corps = await prixLu(entete([option(USDC, '0.50', 'USD Coin')]));
		expect(corps.would_pay_usd).toBeNull();
		expect(corps.price_unavailable_reason).toBe('unreadable_quote');
	});

	it('a batch call is quoted for the whole request, and that total is what it states', async () => {
		// Measured on 24 Sep 2026: /v1/kyb/batch with two SIRENs is quoted 210000.
		reseau(entete([option(USDC, '210000', 'USD Coin'), option(EURC, '210000', 'EURC')]));
		const r = await appelant().call('/v1/kyb/batch?sirens=552032534,652014051', 30_000, true);
		expect((r.body as Record<string, unknown>).would_pay_usd).toBe(0.21);
	});
});
