/**
 * The safety gates are the reason this node exists rather than a generic x402
 * one, so they are what gets tested. Every refusal below is a payment that
 * would otherwise have been signed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkQuote, fromAtomic, toAtomic, NETWORK, SirenicPayer, USDC } from '../nodes/Sirenic/x402';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
const settings = { payTo: PAY_TO, maxPerCall: 0.2 };

const quote = (over: Partial<Record<string, string>> = {}) => [
	{
		scheme: 'exact',
		network: NETWORK,
		asset: USDC,
		payTo: PAY_TO,
		amount: '5000', // $0.005
		// The API sends a window on every option (route.timeoutSeconds ?? 120).
		maxTimeoutSeconds: 120,
		...over,
	},
];

describe('atomic conversion', () => {
	it('round-trips whole prices', () => {
		expect(fromAtomic(toAtomic(0.15))).toBe(0.15);
		expect(fromAtomic(toAtomic(2))).toBe(2);
	});

	it('rounds instead of truncating', () => {
		// 0.105 is slightly under in binary floating point; truncating would put
		// the ceiling one atomic unit below the price the user typed, rejecting
		// a payment they explicitly allowed.
		expect(toAtomic(0.105)).toBe(105_000n);
		expect(toAtomic(0.001)).toBe(1_000n);
	});
});

describe('quote checks', () => {
	it('accepts a normal quote and returns the amount', () => {
		expect(checkQuote(quote(), settings, 0n, 5).amount).toBe(5000n);
	});

	it('refuses a quote paying to another address', () => {
		expect(() =>
			checkQuote(quote({ payTo: '0x000000000000000000000000000000000000dEaD' }), settings, 0n, 5),
		).toThrow(/Payment address mismatch/);
	});

	it('refuses another network, even with the right asset', () => {
		expect(() => checkQuote(quote({ network: 'eip155:1' }), settings, 0n, 5)).toThrow(
			/only settles USDC on Base/,
		);
	});

	it('refuses another token, even on Base', () => {
		expect(() =>
			checkQuote(quote({ asset: '0x0000000000000000000000000000000000000001' }), settings, 0n, 5),
		).toThrow(/only settles USDC on Base/);
	});

	it('refuses an unknown scheme', () => {
		expect(() => checkQuote(quote({ scheme: 'upto' }), settings, 0n, 5)).toThrow(
			/only settles USDC on Base/,
		);
	});

	it('refuses a quote above the per-call cap', () => {
		// $2.00 route against a $0.20 cap — the exact case a user hits after
		// pointing the node at /comptes-pdf without raising the ceiling.
		expect(() => checkQuote(quote({ amount: '2000000' }), settings, 0n, 5)).toThrow(
			/Max Amount Per Call/,
		);
	});

	it('accepts a quote exactly AT the per-call cap', () => {
		expect(checkQuote(quote({ amount: '200000' }), settings, 0n, 5).amount).toBe(200_000n);
	});

	it('refuses once the execution cap would be exceeded', () => {
		// 49 KYB calls already made; the 50th crosses $5.00.
		expect(() => checkQuote(quote({ amount: '150000' }), settings, 4_900_000n, 5)).toThrow(
			/Max Amount Per Execution/,
		);
	});

	it('the execution cap counts the cumulative total, not one call', () => {
		// Each call is well under the per-call cap — only the running total trips
		// the guard. This is the runaway-loop case.
		expect(() => checkQuote(quote({ amount: '1000' }), settings, 5_000_000n, 5)).toThrow(
			/Max Amount Per Execution/,
		);
	});

	it('refuses an empty quote rather than assuming a price', () => {
		expect(() => checkQuote([], settings, 0n, 5)).toThrow(/No USDC-on-Base option/);
	});

	it('picks the USDC option when EURC is offered alongside', () => {
		// Sirenic quotes both currencies at the same numeric amount; we must not
		// sign the EURC one against a USD cap.
		const mixed = [
			{
				scheme: 'exact',
				network: NETWORK,
				asset: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
				payTo: PAY_TO,
				amount: '5000',
			},
			...quote(),
		];
		expect(checkQuote(mixed, settings, 0n, 5).amount).toBe(5000n);
	});

	it('address comparison is case-insensitive (EIP-55 checksums vary)', () => {
		expect(checkQuote(quote({ payTo: PAY_TO.toLowerCase() }), settings, 0n, 5).amount).toBe(5000n);
	});
});

/**
 * The window of the USDC option (`maxTimeoutSeconds`) is how long the signed
 * authorization stays valid (`validBefore` = now + window) and the floor of the
 * wait for the paid answer (window + 30 s). Up to 0.17.0 it was read unchecked:
 * the text "60" was appended to the current time instead of added to it, which
 * signed an authorization valid for thousands of years, and a huge number
 * stretched the wait. Only a whole number of seconds from 1 to 600 is signed;
 * anything else, or no window at all, is refused before signing, on the payment
 * and on the dry run alike.
 */
describe('payment window (maxTimeoutSeconds)', () => {
	// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
	const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
	const NOW_S = 1_785_300_000;
	const LONG = '9'.repeat(80);

	/** Values the node must refuse to sign, `undefined` meaning the field is absent. */
	const REFUSEES: Array<{ cas: string; fenetre: unknown }> = [
		{ cas: 'the text "60"', fenetre: '60' },
		{ cas: '10^9 s', fenetre: 1e9 },
		{ cas: 'no window at all', fenetre: undefined },
		{ cas: '0', fenetre: 0 },
		{ cas: '601, one second above the bound', fenetre: 601 },
		{ cas: '120.5', fenetre: 120.5 },
		{ cas: '-1', fenetre: -1 },
		{ cas: 'true', fenetre: true },
		{ cas: 'null', fenetre: null },
		{ cas: 'an object', fenetre: { seconds: 60 } },
		{ cas: 'a list holding 60', fenetre: [60] },
		{ cas: 'a text of 80 digits', fenetre: LONG },
	];
	const ACCEPTEES = [1, 120, 600];

	/** The USDC option, with this window, or without the field when `undefined`. */
	function usdc(fenetre: unknown): Record<string, unknown> {
		const option: Record<string, unknown> = { ...quote()[0]!, extra: { name: 'USD Coin', version: '2' } };
		delete option.maxTimeoutSeconds;
		if (fenetre !== undefined) option.maxTimeoutSeconds = fenetre;
		return option;
	}

	/** The PAYMENT-REQUIRED header of a 402, an EURC option listed first. */
	function entete(fenetre: unknown): string {
		const eurc = {
			...usdc(120),
			asset: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
			extra: { name: 'EURC', version: '2' },
		};
		return Buffer.from(
			JSON.stringify({
				x402Version: 2,
				resource: { url: 'https://api.example.test/v1/x' },
				accepts: [eurc, usdc(fenetre)],
			}),
		).toString('base64');
	}

	/** Stubs `fetch`: a 402 with that window, then 200 for a signed replay, which is recorded. */
	function reseau(fenetre: unknown) {
		const signees: Array<{ payload: { authorization: Record<string, string> }; accepted: Record<string, unknown> }> = [];
		const appels = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			const signature = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
			if (signature) {
				signees.push(JSON.parse(Buffer.from(signature, 'base64').toString('utf8')));
				return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response('{}', {
				status: 402,
				headers: { 'content-type': 'application/json', 'payment-required': entete(fenetre) },
			});
		});
		vi.stubGlobal('fetch', appels);
		return { appels, signees };
	}

	const payer = () =>
		new SirenicPayer({
			privateKey: KEY,
			baseUrl: 'https://api.example.test',
			payTo: PAY_TO,
			maxPerCall: 1,
			maxPerExecution: 5,
		});

	/** The refusal, which cites the value received, cut at 40 characters as the amount is. */
	const refus = (fenetre: unknown) => {
		const cite = String(JSON.stringify(fenetre))
			.slice(0, 40)
			.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(
			`payment window .*\\(maxTimeoutSeconds: ${cite}\\) is not a whole number of seconds from 1 to 600\\. Refusing to sign`,
		);
	};

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	describe('checkQuote', () => {
		it.each(REFUSEES)('refuses $cas, citing it', ({ fenetre }) => {
			const options = [usdc(fenetre)] as unknown as Parameters<typeof checkQuote>[0];
			expect(() => checkQuote(options, settings, 0n, 5)).toThrow(refus(fenetre));
		});

		it.each(ACCEPTEES)('accepts %i s', (fenetre) => {
			const options = [usdc(fenetre)] as unknown as Parameters<typeof checkQuote>[0];
			expect(checkQuote(options, settings, 0n, 5).amount).toBe(5000n);
		});

		it('cuts a long value at 40 characters in the refusal', () => {
			const options = [usdc(LONG)] as unknown as Parameters<typeof checkQuote>[0];
			expect(() => checkQuote(options, settings, 0n, 5)).toThrow(/maxTimeoutSeconds: "9{39}\)/);
		});
	});

	describe('payment', () => {
		it.each(REFUSEES)('refuses $cas before signing, and pays nothing', async ({ fenetre }) => {
			const { appels, signees } = reseau(fenetre);
			const p = payer();
			await expect(p.call('/v1/x', 1000, false)).rejects.toThrow(refus(fenetre));
			// One request only: nothing was replayed with a signature.
			expect(appels).toHaveBeenCalledTimes(1);
			expect(signees).toHaveLength(0);
			expect(p.totalPaid).toBe(0);
		});

		it.each(ACCEPTEES)(
			'signs %i s: validBefore is now + the window, and the paid answer is awaited window + 30 s',
			async (fenetre) => {
				vi.spyOn(Date, 'now').mockReturnValue(NOW_S * 1000);
				const delais = vi.spyOn(AbortSignal, 'timeout');
				const { appels, signees } = reseau(fenetre);
				const r = await payer().call('/v1/x', 1000, false);

				expect(r.status).toBe(200);
				expect(r.paid).toBe(0.005);
				expect(appels).toHaveBeenCalledTimes(2);
				expect(signees).toHaveLength(1);
				const autorisation = signees[0]!.payload.authorization;
				expect(autorisation.validAfter).toBe('0');
				expect(autorisation.validBefore).toBe(String(NOW_S + fenetre));
				// The signed requirement is the option as quoted, window included.
				expect(signees[0]!.accepted.maxTimeoutSeconds).toBe(fenetre);
				expect(signees[0]!.accepted.asset).toBe(USDC);
				// Pre-flight 30 s, then the floor the window sets, above the 1 s asked for.
				expect(delais.mock.calls.map(([ms]) => ms)).toEqual([30_000, fenetre * 1000 + 30_000]);
			},
		);
	});

	describe('dry run', () => {
		it.each(REFUSEES)('refuses $cas as the payment does', async ({ fenetre }) => {
			const { appels } = reseau(fenetre);
			const p = payer();
			await expect(p.call('/v1/x', 1000, true)).rejects.toThrow(refus(fenetre));
			expect(appels).toHaveBeenCalledTimes(1);
			expect(p.totalPaid).toBe(0);
		});

		it.each(ACCEPTEES)('states the price for %i s, and signs nothing', async (fenetre) => {
			const { appels, signees } = reseau(fenetre);
			const r = await payer().call('/v1/x', 1000, true);
			expect(r.dryRun).toBe(true);
			expect(r.paid).toBe(0);
			expect((r.body as Record<string, unknown>).would_pay_usd).toBe(0.005);
			expect(appels).toHaveBeenCalledTimes(1);
			expect(signees).toHaveLength(0);
		});
	});
});
