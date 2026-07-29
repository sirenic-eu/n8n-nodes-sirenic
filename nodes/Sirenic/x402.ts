/**
 * x402 payment layer — self-contained.
 *
 * Sirenic answers `402 Payment Required` with a signable quote in the
 * `PAYMENT-REQUIRED` header (x402 v2: base64-encoded JSON). We sign the USDC
 * option of that quote with the user's Base wallet (EIP-3009
 * TransferWithAuthorization, gasless for the payer) and replay the request
 * carrying `PAYMENT-SIGNATURE`.
 *
 * ZERO DEPENDENCIES, BY REQUIREMENT. This file used to delegate to
 * viem/@x402. n8n verification demands both a dependency-free package AND a
 * shipped bundle free of `setTimeout`/`globalThis`/… — the bundled libraries
 * violated the latter (18 scanner errors, none in our code). The wire format
 * below reproduces @x402/core v2 + @x402/evm `exact` byte for byte; the
 * cryptography lives in `signer.ts` and is parity-tested against viem.
 *
 * SAFETY MODEL — the reason this node exists rather than a generic x402 node:
 * every quote is checked BEFORE signing, against constraints the user set in
 * the credential (`checkQuote`), and the signer receives EXACTLY the
 * requirements object that passed those checks, re-selected by the same
 * predicate — there is no code path that could sign anything else. A node
 * that can sign payments is only as trustworthy as its refusals.
 *
 * NOTE ON LANGUAGE: this package is written in English, unlike the rest of the
 * Sirenic codebase. n8n's verification guidelines require it — "Both the node
 * interface and all documentation must be in English only."
 */
import {
	addressFromPrivateKey,
	randomNonce,
	signTransferWithAuthorization,
	toChecksumAddress,
} from './signer';

/** Base mainnet, CAIP-2. Sirenic settles nowhere else. */
export const NETWORK = 'eip155:8453';

/** Circle's official USDC contract on Base mainnet. */
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** USDC has 6 decimals; quotes are expressed in atomic units. */
const DECIMALS = 1_000_000;

export interface PaymentSettings {
	privateKey: string;
	baseUrl: string;
	payTo: string;
	maxPerCall: number;
	maxPerExecution: number;
}

export interface CallResult {
	status: number;
	body: unknown;
	/** What was actually paid, in USD. Zero for a free endpoint. */
	paid: number;
}

interface QuoteOption {
	scheme: string;
	network: string;
	asset: string;
	payTo: string;
	amount: string;
	maxTimeoutSeconds?: number;
	extra?: { name?: string; version?: string } & Record<string, unknown>;
}

/** The x402 v2 PAYMENT-REQUIRED envelope, as decoded from the header. */
interface PaymentRequiredV2 {
	x402Version: number;
	resource?: unknown;
	accepts?: QuoteOption[];
	extensions?: unknown;
}

export function toAtomic(usd: number): bigint {
	// Round rather than truncate: 0.105 in binary floating point is slightly
	// under, and truncating would put the ceiling one atomic unit below the
	// price the user typed — rejecting a payment they explicitly allowed.
	return BigInt(Math.round(usd * DECIMALS));
}

export function fromAtomic(atomic: bigint): number {
	return Number(atomic) / DECIMALS;
}

/**
 * Picks the USDC option of a quote and proves it is safe to sign.
 * Exported so it can be tested without touching the network.
 */
export function checkQuote(
	options: readonly QuoteOption[],
	settings: { payTo: string; maxPerCall: number },
	spentSoFar: bigint,
	maxPerExecution: number,
): { amount: bigint } {
	const usdc = options.find(
		(o) =>
			o.scheme === 'exact' &&
			o.network === NETWORK &&
			o.asset.toLowerCase() === USDC.toLowerCase(),
	);
	if (!usdc) {
		throw new Error(
			`No USDC-on-Base option in the payment quote. Sirenic only settles USDC on Base (${NETWORK}); refusing to pay.`,
		);
	}
	if (usdc.payTo.toLowerCase() !== settings.payTo.toLowerCase()) {
		throw new Error(
			`Payment address mismatch: the quote asks to pay ${usdc.payTo}, but the credential expects ${settings.payTo}. Refusing to sign — check the API Base URL.`,
		);
	}

	const amount = BigInt(usdc.amount);
	const perCall = toAtomic(settings.maxPerCall);
	if (amount > perCall) {
		throw new Error(
			`Quote is $${fromAtomic(amount).toFixed(6)} but "Max Amount Per Call" is $${settings.maxPerCall}. Raise the cap in the credential if this price is expected.`,
		);
	}

	const perExecution = toAtomic(maxPerExecution);
	if (spentSoFar + amount > perExecution) {
		throw new Error(
			`This call would bring the execution total to $${fromAtomic(spentSoFar + amount).toFixed(6)}, above the "Max Amount Per Execution" cap of $${maxPerExecution}. Stopping before spending more.`,
		);
	}
	return { amount };
}

/** base64 helpers for the x402 headers (JSON payloads, UTF-8). */
function decodeHeader(header: string): PaymentRequiredV2 {
	return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as PaymentRequiredV2;
}

function encodeHeader(payload: unknown): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Builds the x402 v2 PAYMENT-SIGNATURE payload for one accepted requirement:
 * signs an EIP-3009 TransferWithAuthorization exactly like @x402/evm does
 * (validAfter 0, validBefore now+maxTimeoutSeconds, random 32-byte nonce,
 * EIP-712 domain taken from the quote's `extra.name`/`extra.version`), and
 * wraps it in the v2 envelope (payload + accepted + resource + extensions).
 * Exported for the parity test against the reference implementation.
 */
export function buildPaymentPayload(
	privateKey: string,
	quote: PaymentRequiredV2,
	accepted: QuoteOption,
	nowSeconds: number,
	nonce: string,
): Record<string, unknown> {
	if (!accepted.extra?.name || !accepted.extra?.version) {
		throw new Error(
			`EIP-712 domain parameters (name, version) are required in payment requirements for asset ${accepted.asset}`,
		);
	}
	// CAIP-2 `eip155:<chainId>`. Anything else (a Solana quote, a malformed
	// value) must be refused with a readable reason rather than letting
	// BigInt() throw "Cannot convert … to a BigInt" from deep in the stack.
	const [namespace, reference] = accepted.network.split(':');
	if (namespace !== 'eip155' || !/^[1-9][0-9]*$/.test(reference ?? '')) {
		throw new Error(`Unsupported network in quote: ${accepted.network}. This node signs EVM (eip155) payments only.`);
	}
	const chainId = BigInt(reference as string);
	const authorization = {
		from: addressFromPrivateKey(privateKey),
		to: toChecksumAddress(accepted.payTo),
		value: accepted.amount,
		validAfter: '0',
		validBefore: (nowSeconds + (accepted.maxTimeoutSeconds ?? 120)).toString(),
		nonce,
	};
	const signature = signTransferWithAuthorization(
		privateKey,
		{
			name: accepted.extra.name,
			version: accepted.extra.version,
			chainId,
			verifyingContract: toChecksumAddress(accepted.asset),
		},
		{
			from: authorization.from,
			to: authorization.to,
			value: BigInt(authorization.value),
			validAfter: BigInt(authorization.validAfter),
			validBefore: BigInt(authorization.validBefore),
			nonce,
		},
	);
	return {
		x402Version: 2,
		payload: { authorization, signature },
		...(quote.extensions !== undefined ? { extensions: quote.extensions } : {}),
		...(quote.resource !== undefined ? { resource: quote.resource } : {}),
		accepted,
	};
}

/**
 * A payer bound to one workflow execution, so the per-execution cap is
 * enforced across every item the node processes.
 */
export class SirenicPayer {
	private spent = 0n;

	constructor(private readonly settings: PaymentSettings) {}

	/** Total spent so far in this execution, in USD. */
	get totalPaid(): number {
		return fromAtomic(this.spent);
	}

	async call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult> {
		const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;

		// Pre-flight: unpaid request. A free endpoint answers 200 straight away
		// and costs nothing.
		const preflight = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(30_000),
		});
		if (preflight.status !== 402) {
			return { status: preflight.status, body: await readBody(preflight), paid: 0 };
		}

		const header = preflight.headers.get('payment-required');
		if (!header) {
			throw new Error(
				'The endpoint asked for payment but returned no signable quote (missing PAYMENT-REQUIRED header).',
			);
		}
		const quote = decodeHeader(header);
		if (quote.x402Version !== 2) {
			throw new Error(
				`Unsupported x402 version in quote: ${quote.x402Version}. This node speaks x402 v2.`,
			);
		}
		const options = quote.accepts ?? [];
		const { amount } = checkQuote(options, this.settings, this.spent, this.settings.maxPerExecution);

		if (dryRun) {
			return {
				status: 402,
				body: {
					dry_run: true,
					would_pay_usd: fromAtomic(amount),
					pay_to: this.settings.payTo,
					network: NETWORK,
					resource: url,
					message: 'Dry run: the quote passed every check but no payment was signed.',
				},
				paid: 0,
			};
		}

		// Sign EXACTLY the option that passed the checks: re-selected with the
		// same predicate, plus the amount `checkQuote` authorised. A quote that
		// mutated between the two lookups cannot reach the signer.
		const accepted = options.find(
			(o) =>
				o.scheme === 'exact' &&
				o.network === NETWORK &&
				o.asset.toLowerCase() === USDC.toLowerCase() &&
				o.payTo.toLowerCase() === this.settings.payTo.toLowerCase() &&
				BigInt(o.amount) === amount,
		);
		if (!accepted) {
			throw new Error('Quote changed between check and signature. Refusing to sign.');
		}
		const payload = buildPaymentPayload(
			this.settings.privateKey,
			quote,
			accepted,
			Math.floor(Date.now() / 1000),
			randomNonce(),
		);

		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'PAYMENT-SIGNATURE': encodeHeader(payload),
				'Access-Control-Expose-Headers': 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE',
			},
			signal: AbortSignal.timeout(timeoutMs),
		});

		const body = await readBody(response);
		if (response.status >= 400) {
			// Sirenic cancels the payment on 404/503, so nothing was charged.
			return { status: response.status, body, paid: 0 };
		}
		this.spent += amount;
		return { status: response.status, body, paid: fromAtomic(amount) };
	}
}

async function readBody(response: Response): Promise<unknown> {
	const type = response.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		return response.json().catch(() => ({}));
	}
	// Rate limits and header-size errors answer in plain text; parsing them as
	// JSON would turn a real error into a silent empty object.
	return { message: await response.text().catch(() => '') };
}
