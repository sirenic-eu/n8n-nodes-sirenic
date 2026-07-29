/**
 * The safety gates are the reason this node exists rather than a generic x402
 * one, so they are what gets tested. Every refusal below is a payment that
 * would otherwise have been signed.
 */
import { describe, expect, it } from 'vitest';
import { checkQuote, fromAtomic, toAtomic, NETWORK, USDC } from '../nodes/Sirenic/x402';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
const settings = { payTo: PAY_TO, maxPerCall: 0.2 };

const quote = (over: Partial<Record<string, string>> = {}) => [
	{
		scheme: 'exact',
		network: NETWORK,
		asset: USDC,
		payTo: PAY_TO,
		amount: '5000', // $0.005
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
