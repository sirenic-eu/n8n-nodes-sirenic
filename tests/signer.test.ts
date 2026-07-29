/**
 * PARITY TESTS — the dependency-free signer against the reference libraries.
 *
 * `signer.ts` reimplements keccak-256, secp256k1 and the EIP-712 hashing that
 * viem used to provide, because n8n verification forbids shipping runtime
 * dependencies AND forbids the globals those libraries use. Correctness is
 * therefore not a matter of trust: every signature is compared BYTE FOR BYTE
 * with viem's, which stays a dev dependency (never shipped).
 *
 * If one bit drifts, these tests fail and the payment path is known-broken
 * before a single cent moves.
 */
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 as viemKeccak256, getAddress as viemGetAddress } from 'viem';

import {
	addressFromPrivateKey,
	bytesToHex,
	hexToBytes,
	keccak256,
	randomNonce,
	signTransferWithAuthorization,
	toChecksumAddress,
} from '../nodes/Sirenic/signer';
import { buildPaymentPayload } from '../nodes/Sirenic/x402';

/** Throwaway keys — test vectors only, never funded. */
const KEY_A = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const KEY_B = '0x0000000000000000000000000000000000000000000000000000000000000001';
const KEY_C = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';

const AUTHORIZATION_TYPES = {
	TransferWithAuthorization: [
		{ name: 'from', type: 'address' },
		{ name: 'to', type: 'address' },
		{ name: 'value', type: 'uint256' },
		{ name: 'validAfter', type: 'uint256' },
		{ name: 'validBefore', type: 'uint256' },
		{ name: 'nonce', type: 'bytes32' },
	],
} as const;

describe('keccak-256', () => {
	it('matches the known empty-input vector', () => {
		expect(bytesToHex(keccak256(new Uint8Array()))).toBe(
			'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
		);
	});

	it('matches viem across sizes, including multi-block inputs', () => {
		for (const length of [1, 31, 32, 33, 135, 136, 137, 271, 1000]) {
			const data = new Uint8Array(length);
			for (let i = 0; i < length; i++) data[i] = (i * 37 + 11) % 256;
			expect(bytesToHex(keccak256(data)), `length ${length}`).toBe(viemKeccak256(data));
		}
	});
});

describe('addresses', () => {
	it('derives the same address as viem, for several keys', () => {
		for (const key of [KEY_A, KEY_B, KEY_C]) {
			expect(addressFromPrivateKey(key)).toBe(privateKeyToAccount(key as `0x${string}`).address);
		}
	});

	it('EIP-55 checksums match viem', () => {
		for (const address of [USDC, PAY_TO, '0x0000000000000000000000000000000000000000']) {
			expect(toChecksumAddress(address.toLowerCase())).toBe(viemGetAddress(address));
		}
	});
});

describe('EIP-3009 signature parity with viem', () => {
	/** viem's reference signature for the same authorization. */
	async function reference(
		key: string,
		domainName: string,
		version: string,
		chainId: number,
		verifyingContract: string,
		message: Record<string, unknown>,
	): Promise<string> {
		return privateKeyToAccount(key as `0x${string}`).signTypedData({
			domain: { name: domainName, version, chainId, verifyingContract: verifyingContract as `0x${string}` },
			types: AUTHORIZATION_TYPES,
			primaryType: 'TransferWithAuthorization',
			message: message as never,
		});
	}

	it('matches on a realistic USDC-on-Base authorization', async () => {
		const message = {
			from: addressFromPrivateKey(KEY_A),
			to: viemGetAddress(PAY_TO),
			value: 5000n,
			validAfter: 0n,
			validBefore: 1785312345n,
			nonce: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const,
		};
		const mine = signTransferWithAuthorization(
			KEY_A,
			{ name: 'USD Coin', version: '2', chainId: 8453n, verifyingContract: USDC },
			message,
		);
		expect(mine).toBe(await reference(KEY_A, 'USD Coin', '2', 8453, USDC, message));
	});

	it('matches across keys, amounts, nonces and EURC domain', async () => {
		const cases = [
			{ key: KEY_A, name: 'EURC', version: '2', value: 1n, chainId: 8453 },
			{ key: KEY_B, name: 'USD Coin', version: '2', value: 2_000_000n, chainId: 8453 },
			{ key: KEY_C, name: 'USD Coin', version: '2', value: 105_000n, chainId: 8453 },
			{ key: KEY_C, name: 'USD Coin', version: '1', value: 999_999_999n, chainId: 1 },
		];
		for (const [i, c] of cases.entries()) {
			const message = {
				from: addressFromPrivateKey(c.key),
				to: viemGetAddress(PAY_TO),
				value: c.value,
				validAfter: 0n,
				validBefore: BigInt(1700000000 + i * 7919),
				nonce: bytesToHex(keccak256(new Uint8Array([i]))) as `0x${string}`,
			};
			const mine = signTransferWithAuthorization(
				c.key,
				{ name: c.name, version: c.version, chainId: BigInt(c.chainId), verifyingContract: USDC },
				message,
			);
			expect(mine, `case ${i}`).toBe(
				await reference(c.key, c.name, c.version, c.chainId, USDC, message),
			);
		}
	});

	it('matches on 12 random authorizations (fuzz against the reference)', async () => {
		for (let i = 0; i < 12; i++) {
			const nonce = randomNonce();
			const key = bytesToHex(hexToBytes(randomNonce())); // random 32-byte scalar
			const message = {
				from: addressFromPrivateKey(key),
				to: viemGetAddress(PAY_TO),
				value: BigInt(Math.floor(Math.random() * 2_000_000) + 1),
				validAfter: 0n,
				validBefore: BigInt(1700000000 + Math.floor(Math.random() * 1e7)),
				nonce: nonce as `0x${string}`,
			};
			const mine = signTransferWithAuthorization(
				key,
				{ name: 'USD Coin', version: '2', chainId: 8453n, verifyingContract: USDC },
				message,
			);
			expect(mine, `random case ${i} (nonce ${nonce})`).toBe(
				await reference(key, 'USD Coin', '2', 8453, USDC, message),
			);
		}
	});

	it('the nonce is 32 random bytes, never repeated', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 50; i++) {
			const n = randomNonce();
			expect(n).toMatch(/^0x[0-9a-f]{64}$/);
			expect(seen.has(n)).toBe(false);
			seen.add(n);
		}
	});
});

describe('x402 v2 payload envelope', () => {
	const quote = {
		x402Version: 2,
		resource: { url: 'https://api.sirenic.eu/v1/recherche' },
		extensions: { bazaar: { info: {} } },
		accepts: [],
	};
	const accepted = {
		scheme: 'exact',
		network: 'eip155:8453',
		asset: USDC,
		payTo: PAY_TO,
		amount: '5000',
		maxTimeoutSeconds: 120,
		extra: { name: 'USD Coin', version: '2' },
	};

	it('carries version 2, the authorization, the accepted requirement and the quote context', () => {
		const payload = buildPaymentPayload(KEY_A, quote, accepted, 1785300000, randomNonce()) as {
			x402Version: number;
			payload: { authorization: Record<string, string>; signature: string };
			accepted: unknown;
			resource: unknown;
			extensions: unknown;
		};
		expect(payload.x402Version).toBe(2);
		expect(payload.accepted).toEqual(accepted);
		expect(payload.resource).toEqual(quote.resource);
		expect(payload.extensions).toEqual(quote.extensions);
		const auth = payload.payload.authorization;
		expect(auth.from).toBe(addressFromPrivateKey(KEY_A));
		expect(auth.to).toBe(viemGetAddress(PAY_TO));
		expect(auth.value).toBe('5000');
		expect(auth.validAfter).toBe('0');
		// validBefore = now + maxTimeoutSeconds, exactly like @x402/evm.
		expect(auth.validBefore).toBe(String(1785300000 + 120));
		expect(payload.payload.signature).toMatch(/^0x[0-9a-f]{130}$/);
	});

	it('refuses a quote without EIP-712 domain parameters rather than signing blind', () => {
		expect(() =>
			buildPaymentPayload(KEY_A, quote, { ...accepted, extra: {} }, 1785300000, randomNonce()),
		).toThrow(/domain parameters/);
	});

	it('refuses a network it cannot map to a chain id', () => {
		expect(() =>
			buildPaymentPayload(KEY_A, quote, { ...accepted, network: 'solana:mainnet' }, 1785300000, randomNonce()),
		).toThrow(/Unsupported network/);
	});
});
