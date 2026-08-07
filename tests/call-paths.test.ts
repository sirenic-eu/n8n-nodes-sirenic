/**
 * The two paths through `call()` that no test covered — which is exactly why a
 * regression slipped in: the dry run answers 402 BY DESIGN, and a review guard
 * that treated "status >= 400" as a failure turned every dry run into an error.
 *
 * The network is stubbed: no wallet, no payment, no HTTP.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NETWORK, SirenicPayer, USDC } from '../nodes/Sirenic/x402';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
// Test-only key (never used anywhere): the dry run stops before signing anyway.
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const settings = {
	privateKey: KEY,
	baseUrl: 'https://api.example.test',
	payTo: PAY_TO,
	maxPerCall: 2,
	maxPerExecution: 10,
};

/** A signable x402 v2 quote, as the API sends it in the PAYMENT-REQUIRED header. */
function quoteHeader(amount = '350000', maxTimeoutSeconds = 200) {
	return Buffer.from(
		JSON.stringify({
			x402Version: 2,
			resource: 'https://api.example.test/v1/entreprise/552032534/capital',
			accepts: [
				{
					scheme: 'exact',
					network: NETWORK,
					asset: USDC,
					payTo: PAY_TO,
					amount,
					maxTimeoutSeconds,
					extra: { name: 'USD Coin', version: '2' },
				},
			],
		}),
	).toString('base64');
}

afterEach(() => vi.unstubAllGlobals());

describe('dry run', () => {
	it('reports the price without signing, and is not an error', async () => {
		const appels = vi.fn(async () =>
			new Response('{}', {
				status: 402,
				headers: { 'content-type': 'application/json', 'payment-required': quoteHeader() },
			}),
		);
		vi.stubGlobal('fetch', appels);
		const payer = new SirenicPayer(settings);
		const result = await payer.call('/v1/entreprise/552032534/capital', 120_000, true);

		// A 402 here is the ANSWER, not a failure: callers must key on dryRun.
		expect(result.status).toBe(402);
		expect(result.dryRun).toBe(true);
		expect(result.paid).toBe(0);
		expect((result.body as Record<string, unknown>).would_pay_usd).toBe(0.35);
		expect(payer.totalPaid).toBe(0);
		// One request only: the dry run must never replay with a signature.
		expect(appels).toHaveBeenCalledTimes(1);
	});

	it('a free endpoint needs no dry run and reports no cost', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ etat: 'actif' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);
		const result = await new SirenicPayer(settings).call('/v1/surveillance/sw_abc', 120_000, false);
		expect(result.status).toBe(200);
		expect(result.paid).toBe(0);
		expect(result.dryRun).toBeUndefined();
	});
});

describe('response bodies', () => {
	it('hands a PDF over as raw bytes, never as text', async () => {
		// A real PDF starts with %PDF- and contains bytes that are not valid UTF-8;
		// reading it with .text() would replace them and corrupt a paid file.
		const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x80, 0xff, 0x00, 0xfe])]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(pdf, {
					status: 200,
					headers: {
						'content-type': 'application/pdf',
						'content-disposition': 'attachment; filename="sirenic-rapport-552032534.pdf"',
					},
				}),
			),
		);
		const result = await new SirenicPayer(settings).call('/v1/rapport/552032534', 120_000, false);

		expect(result.binary?.contentType).toBe('application/pdf');
		expect(result.binary?.fileName).toBe('sirenic-rapport-552032534.pdf');
		expect(result.binary?.data.equals(pdf)).toBe(true);
		// The JSON side must not pretend to carry the document.
		expect((result.body as Record<string, unknown>).is_binary).toBe(true);
		expect((result.body as Record<string, unknown>).bytes).toBe(pdf.length);
	});

	it('parses a problem+json error body instead of treating it as binary', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ error: 'date_invalide', message: 'depuis requis' }), {
					status: 400,
					headers: { 'content-type': 'application/problem+json' },
				}),
			),
		);
		const result = await new SirenicPayer(settings).call('/v1/entreprise/1/changements', 1000, false);
		// The machine-readable code must survive: workflows branch on it.
		expect((result.body as Record<string, unknown>).error).toBe('date_invalide');
		expect(result.binary).toBeUndefined();
		expect(result.paid).toBe(0);
	});

	it('keeps a plain-text body readable (rate limits answer in text)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response('Too many requests', {
					status: 429,
					headers: { 'content-type': 'text/plain' },
				}),
			),
		);
		const result = await new SirenicPayer(settings).call('/v1/recherche?q=a', 1000, false);
		expect((result.body as Record<string, unknown>).message).toBe('Too many requests');
	});
});
