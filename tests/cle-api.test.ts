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

const CLE = 'srn_live_jamais_valide_de_test';
const BASE = 'https://api.example.test';

/** A JSON response, with the headers the API really sets. */
function reponse(corps: unknown, entetes: Record<string, string> = {}, status = 200) {
	return new Response(JSON.stringify(corps), {
		status,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

function appelant(plafond = 5) {
	return new SirenicKeyCaller({ apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: plafond });
}

afterEach(() => vi.unstubAllGlobals());

describe('API key rail', () => {
	it('sends the key in a header, and only there', async () => {
		const appels: Array<{ url: string; entetes: Headers }> = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			appels.push({ url, entetes: new Headers(init.headers) });
			return reponse({ siren: '552032534' });
		});

		await appelant().call('/v1/entreprise/552032534', 30_000, false);

		expect(appels).toHaveLength(1);
		expect(appels[0]!.entetes.get('X-Api-Key')).toBe(CLE);
		// Never in the URL: a key in the query string ends up in the logs.
		expect(appels[0]!.url).not.toContain('srn_');
	});

	it('counts what the API SAYS it debited, never a copied price', async () => {
		vi.stubGlobal('fetch', async () => reponse({ ok: true }, { 'x-credits-charged': '0.105' }));
		const a = appelant();

		const r = await a.call('/v1/kyb/batch?sirens=1,2,3', 30_000, false);

		// A batch route costs its unit price MULTIPLIED by the number of
		// entities: only the header knows the real amount.
		expect(r.paid).toBe(0.105);
		expect(a.totalPaid).toBe(0.105);
	});

	it('counts nothing when the call is served by the free quota', async () => {
		vi.stubGlobal('fetch', async () =>
			reponse({ ok: true }, { 'x-credits-charged': '0', 'x-free-quota-remaining': '149' }),
		);
		const a = appelant();

		const r = await a.call('/v1/recherche?q=danone', 30_000, false);

		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
		// The remaining quota is passed up to the workflow: it is information
		// the user cannot get anywhere else in their flow.
		expect((r.body as { free_quota_remaining?: number }).free_quota_remaining).toBe(149);
	});

	it('refuses BEFORE the call that would cross the cap', async () => {
		const fetchStub = vi.fn(async () => reponse({ ok: true }, { 'x-credits-charged': '0.4' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(1);

		await a.call('/v1/kyb/1', 30_000, false);
		await a.call('/v1/kyb/2', 30_000, false);
		expect(a.totalPaid).toBe(0.8);

		// 0.8 spent out of 1.0: the third call GOES THROUGH (the cap is not
		// reached yet), the fourth is refused without being sent.
		await a.call('/v1/kyb/3', 30_000, false);
		expect(fetchStub).toHaveBeenCalledTimes(3);
		await expect(a.call('/v1/kyb/4', 30_000, false)).rejects.toThrow(/ceiling reached/i);
		expect(fetchStub).toHaveBeenCalledTimes(3);
	});

	it('a zero cap limits nothing, and that is an explicit choice', async () => {
		const fetchStub = vi.fn(async () => reponse({ ok: true }, { 'x-credits-charged': '9' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(0);

		await a.call('/v1/intelligence/1', 30_000, false);
		await a.call('/v1/intelligence/2', 30_000, false);

		expect(fetchStub).toHaveBeenCalledTimes(2);
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
		vi.stubGlobal('fetch', async () =>
			new Response(pdf, {
				status: 200,
				headers: { 'content-type': 'application/pdf', 'x-credits-charged': '0.5' },
			}),
		);

		const r = await appelant().call('/v1/rapport/552032534', 30_000, false);

		expect(r.binary?.contentType).toBe('application/pdf');
		expect(r.binary?.data.subarray(0, 5).toString()).toBe('%PDF-');
		expect(r.paid).toBe(0.5);
	});

	it('an error is never counted as spending', async () => {
		vi.stubGlobal('fetch', async () => reponse({ error: 'siren_invalide' }, {}, 400));
		const a = appelant();

		const r = await a.call('/v1/entreprise/000000000', 30_000, false);

		expect(r.status).toBe(400);
		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
	});
});
