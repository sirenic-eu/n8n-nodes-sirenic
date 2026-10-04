/**
 * The "API key" rail, checked without network and without spending.
 *
 * What matters here is not that a call "works": it is that the key goes where
 * it should, that spending is counted from what the API SAYS it debited, and
 * that the cap bites BEFORE the call that would cross it — afterwards it is
 * already debited and the safeguard no longer guards anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SirenicKeyCaller } from '../nodes/Sirenic/cle-api';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';

const CLE = 'srn_live_jamais_valide_de_test';
const BASE = 'https://api.example.test';

/** A JSON response, with the headers the API really sets. */
function reponse(corps: unknown, entetes: Record<string, string> = {}, status = 200) {
	return new Response(JSON.stringify(corps), {
		status,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

/** The PAYMENT-REQUIRED header of a route quoted `usd` (x402 v2, USDC on Base). */
function devis(usd: number): string {
	return Buffer.from(
		JSON.stringify({
			x402Version: 2,
			accepts: [
				{
					scheme: 'exact',
					network: NETWORK,
					asset: USDC,
					payTo: '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2',
					amount: String(Math.round(usd * 1_000_000)),
					maxTimeoutSeconds: 120,
					extra: { name: 'USD Coin', version: '2' },
				},
			],
		}),
	).toString('base64');
}

/**
 * A paid route as the API serves it on this rail: without the key, its quote
 * (402); with the key, `avecCle()`. Since 0.17.0 the caller asks for the quote
 * before each paid call when the ceiling is above 0: a stub that answered 200
 * without the key would be a free route, which a paid route never is.
 */
function routePayante(prix: number, avecCle: () => Response) {
	return vi.fn(async (_url: string | URL, init?: RequestInit) =>
		new Headers(init?.headers).get('X-Api-Key')
			? avecCle()
			: reponse({ error: 'payment_required' }, { 'payment-required': devis(prix) }, 402),
	);
}

function appelant(plafond = 5) {
	return new SirenicKeyCaller({ apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: plafond });
}

afterEach(() => vi.unstubAllGlobals());

describe('API key rail', () => {
	it('sends the key in a header, and only there', async () => {
		const appels: Array<{ url: string; entetes: Headers }> = [];
		const route = routePayante(0.005, () => reponse({ siren: '552032534' }, { 'x-credits-charged': '0.005' }));
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			appels.push({ url, entetes: new Headers(init.headers) });
			return route(url, init);
		});

		await appelant().call('/v1/entreprise/552032534', 30_000, false);

		// The quote is asked for without the key, then the call carries it.
		expect(appels).toHaveLength(2);
		expect(appels[0]!.entetes.get('X-Api-Key')).toBeNull();
		expect(appels[1]!.entetes.get('X-Api-Key')).toBe(CLE);
		// Never in the URL: a key in the query string ends up in the logs.
		expect(appels.map((a) => a.url).join(' ')).not.toContain('srn_');
	});

	it('counts what the API SAYS it debited, never a copied price', async () => {
		// Quoted 0.2, debited 0.105: what counts is the debit the API reports.
		vi.stubGlobal('fetch', routePayante(0.2, () => reponse({ ok: true }, { 'x-credits-charged': '0.105' })));
		const a = appelant();

		const r = await a.call('/v1/kyb/batch?sirens=1,2,3', 30_000, false);

		// A batch route costs its unit price MULTIPLIED by the number of
		// entities: only the header knows the real amount.
		expect(r.paid).toBe(0.105);
		expect(a.totalPaid).toBe(0.105);
	});

	it('counts nothing when the call is served by the free quota', async () => {
		vi.stubGlobal(
			'fetch',
			routePayante(0.002, () => reponse({ ok: true }, { 'x-credits-charged': '0', 'x-free-quota-remaining': '149' })),
		);
		const a = appelant();

		const r = await a.call('/v1/recherche?q=danone', 30_000, false);

		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
		// The remaining quota is passed up to the workflow: it is information
		// the user cannot get anywhere else in their flow.
		expect((r.body as { free_quota_remaining?: number }).free_quota_remaining).toBe(149);
	});

	it('refuses, before sending the key, the call whose quote would cross the cap', async () => {
		const fetchStub = routePayante(0.4, () => reponse({ ok: true }, { 'x-credits-charged': '0.4' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(1);
		const avecCle = () =>
			fetchStub.mock.calls.filter(([, init]) => new Headers(init?.headers).get('X-Api-Key')).length;

		await a.call('/v1/kyb/1', 30_000, false);
		await a.call('/v1/kyb/2', 30_000, false);
		expect(a.totalPaid).toBe(0.8);
		expect(avecCle()).toBe(2);

		// 0.8 spent out of 1.0, and the third call is quoted 0.4: it would end
		// at 1.2, so it is refused, and the key is never sent. Up to 0.16.0 it
		// went through and was charged, and only the fourth was refused.
		await expect(a.call('/v1/kyb/3', 30_000, false)).rejects.toThrow(/Spending ceiling/);
		expect(avecCle()).toBe(2);
		expect(a.totalPaid).toBe(0.8);
	});

	it('a zero cap limits nothing, and that is an explicit choice', async () => {
		const fetchStub = routePayante(9, () => reponse({ ok: true }, { 'x-credits-charged': '9' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(0);

		await a.call('/v1/intelligence/1', 30_000, false);
		await a.call('/v1/intelligence/2', 30_000, false);

		// No quote is asked for: both requests carry the key.
		expect(fetchStub).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchStub.mock.calls) expect(new Headers(init?.headers).get('X-Api-Key')).toBe(CLE);
		expect(a.totalPaid).toBe(18);
	});

	it('the dry run does NOT send the key and debits nothing', async () => {
		const appels: Array<Headers> = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			appels.push(new Headers(init.headers));
			return new Response('', { status: 402, headers: { 'payment-required': 'eyJ4NDAy' } });
		});
		const a = appelant();

		const r = await a.call('/v1/rapport/552032534', 30_000, true);

		expect(appels[0]!.get('X-Api-Key')).toBeNull();
		expect(r.dryRun).toBe(true);
		expect(r.status).toBe(402);
		expect(a.totalPaid).toBe(0);
	});

	it('returns the bytes of a PDF without decoding them', async () => {
		const pdf = Buffer.from('%PDF-1.4 essai');
		vi.stubGlobal(
			'fetch',
			routePayante(0.5, () =>
				new Response(pdf, {
					status: 200,
					headers: { 'content-type': 'application/pdf', 'x-credits-charged': '0.5' },
				}),
			),
		);

		const r = await appelant().call('/v1/rapport/552032534', 30_000, false);

		expect(r.binary?.contentType).toBe('application/pdf');
		expect(r.binary?.data.subarray(0, 5).toString()).toBe('%PDF-');
		expect(r.paid).toBe(0.5);
	});

	it('an error is never counted as spending', async () => {
		// The API refunds any answer of 400 or more, and says so in the header.
		vi.stubGlobal(
			'fetch',
			routePayante(0.005, () => reponse({ error: 'siren_invalide' }, { 'x-credits-charged': '0' }, 400)),
		);
		const a = appelant();

		const r = await a.call('/v1/entreprise/000000000', 30_000, false);

		expect(r.status).toBe(400);
		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
	});
});
