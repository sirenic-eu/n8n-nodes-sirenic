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

/**
 * Head-room added to the window declared in the quote before the client gives
 * up. Settlement runs after the handler returns, so a client that aborts at
 * exactly the window pays for a response it never reads.
 */
const MARGE_REGLEMENT_MS = 30_000;

/**
 * What the node and the trigger expect from a caller, whatever the rail.
 *
 * Two implementations: `SirenicPayer` signs one x402 payment per call, and
 * `SirenicKeyCaller` sends an API key and adds up what the API says it
 * debited. The rest of the code does not know which one it holds — that is
 * what allows adding a rail without touching the 61 operations.
 */
export interface AppelantSirenic {
	/** Total spent so far in this execution, in dollars. */
	readonly totalPaid: number;
	call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult>;
}

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
	/**
	 * Set when the 402 is the answer to a dry run, not a failure: the quote was
	 * checked and nothing was signed. Callers must not treat it as an error.
	 */
	dryRun?: true;
	/**
	 * Set when the endpoint answered with something other than JSON — a PDF,
	 * typically. The bytes are handed over untouched so the caller can attach
	 * them as an n8n binary: decoding a PDF as text corrupts it, and the user
	 * has already paid for those bytes.
	 */
	binary?: { data: Buffer; contentType: string; fileName?: string };
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
 * An x402 amount in atomic units: a string of digits, the form the protocol
 * states, or a non-negative safe integer. Anything else (negative, empty,
 * padded or hexadecimal, a boolean, an object, a list) is not a price and comes
 * back as null. `BigInt()` alone accepts most of those, and a negative amount
 * used to be signed. The payment and the dry run read amounts here only, so a
 * quote cannot be signed for an amount the dry run would call unreadable.
 */
export function atomicAmount(value: unknown): bigint | null {
	if (typeof value === 'string') return /^[0-9]+$/.test(value) ? BigInt(value) : null;
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
	return null;
}

/**
 * The one option this node ever reads a price from or pays: the `exact`
 * scheme, USDC, on Base. Sirenic also quotes EURC at the same number, and
 * reading or signing that option against a dollar figure would be wrong. The
 * payment and the price of a dry run, on both rails, select through here: they
 * cannot disagree on which option is the price.
 */
export function isUsdcOnBase(option: unknown): boolean {
	if (typeof option !== 'object' || option === null) return false;
	const { scheme, network, asset } = option as Partial<QuoteOption>;
	return (
		scheme === 'exact' &&
		network === NETWORK &&
		typeof asset === 'string' &&
		asset.toLowerCase() === USDC.toLowerCase()
	);
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
	const usdc = options.find(isUsdcOnBase);
	if (!usdc) {
		throw new Error(
			`No USDC-on-Base option in the payment quote. Sirenic only settles USDC on Base (${NETWORK}); refusing to pay.`,
		);
	}
	if (usdc.payTo.toLowerCase() !== settings.payTo.toLowerCase()) {
		throw new Error(
			`Payment address mismatch: the quote asks to pay ${usdc.payTo}, but the credential expects ${settings.payTo}. Refusing to sign: check the API Base URL.`,
		);
	}

	const amount = atomicAmount(usdc.amount);
	if (amount === null) {
		throw new Error(
			`The USDC amount in the payment quote (${String(JSON.stringify(usdc.amount)).slice(0, 40)}) is not a whole number of atomic units. Refusing to sign.`,
		);
	}
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
export function decodeHeader(header: string): PaymentRequiredV2 {
	return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as PaymentRequiredV2;
}

function encodeHeader(payload: unknown): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** Why the PAYMENT-REQUIRED header of a 402 could not be read. A closed list. */
export type QuoteUnreadable = 'no_quote_header' | 'unreadable_quote' | 'unsupported_x402_version';

/**
 * Reads the PAYMENT-REQUIRED header of a 402: base64-encoded JSON, x402 v2.
 *
 * Both rails read a quote here and nowhere else. It never throws: a header that
 * cannot be read comes back as a reason, and each rail decides what that means.
 * The wallet refuses to sign; the dry run of the API-key rail states no price.
 * Neither falls back on a price found elsewhere, such as the prose of the 402
 * body or a copy in this package: the quote is the only price the API stands
 * behind, and a copy drifts.
 */
export function readQuote(
	header: string | null,
): { quote: PaymentRequiredV2 } | { unreadable: QuoteUnreadable; version?: unknown } {
	if (!header) return { unreadable: 'no_quote_header' };
	let quote: unknown;
	try {
		quote = decodeHeader(header);
	} catch {
		return { unreadable: 'unreadable_quote' };
	}
	if (typeof quote !== 'object' || quote === null || Array.isArray(quote)) {
		return { unreadable: 'unreadable_quote' };
	}
	const { x402Version, accepts } = quote as PaymentRequiredV2;
	if (x402Version !== 2) return { unreadable: 'unsupported_x402_version', version: x402Version };
	// No list at all (absent or null) offers no option, as in 0.15.0; a list of
	// the wrong type cannot be read. Entries the node does not understand are
	// left to the option predicate, which skips them.
	if (accepts !== undefined && accepts !== null && !Array.isArray(accepts)) {
		return { unreadable: 'unreadable_quote' };
	}
	return { quote: quote as PaymentRequiredV2 };
}

/** Why a dry run states no price. A closed list, returned to the workflow. */
export type PriceUnavailable = QuoteUnreadable | 'no_usdc_on_base_option';

/**
 * The price a 402 quotes, in dollars: the amount of its USDC option on Base,
 * read without paying it. When there is no such price, `null` comes with its
 * reason, never with a guess.
 */
export function quotedPriceUsd(
	header: string | null,
): { usd: number } | { usd: null; reason: PriceUnavailable } {
	const lecture = readQuote(header);
	if ('unreadable' in lecture) return { usd: null, reason: lecture.unreadable };
	const usdc = (lecture.quote.accepts ?? []).find(isUsdcOnBase);
	if (!usdc) return { usd: null, reason: 'no_usdc_on_base_option' };
	// Not a whole number of atomic units: said, never rounded or guessed.
	const atomique = atomicAmount(usdc.amount);
	if (atomique === null) return { usd: null, reason: 'unreadable_quote' };
	return { usd: fromAtomic(atomique) };
}

/** What the wallet rail says when it refuses to sign a quote it cannot read. */
const REFUS_DEVIS_ILLISIBLE: Record<QuoteUnreadable, (version: unknown) => string> = {
	no_quote_header: () =>
		'The endpoint asked for payment but returned no signable quote (missing PAYMENT-REQUIRED header).',
	unreadable_quote: () =>
		'The payment quote (PAYMENT-REQUIRED header) cannot be read as an x402 quote: it is not base64-encoded JSON, or not shaped as one. Refusing to sign a quote that cannot be read.',
	unsupported_x402_version: (version) =>
		`Unsupported x402 version in quote: ${String(version)}. This node speaks x402 v2.`,
};

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
export class SirenicPayer implements AppelantSirenic {
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
			const free = await readBody(preflight);
			return { status: preflight.status, body: free.body, paid: 0, binary: free.binary };
		}

		const lecture = readQuote(preflight.headers.get('payment-required'));
		if ('unreadable' in lecture) {
			throw new Error(REFUS_DEVIS_ILLISIBLE[lecture.unreadable](lecture.version));
		}
		const { quote } = lecture;
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
				dryRun: true,
			};
		}

		// Sign EXACTLY the option that passed the checks: re-selected with the
		// same predicate, plus the amount `checkQuote` authorised. A quote that
		// mutated between the two lookups cannot reach the signer.
		const accepted = options.find(
			(o) =>
				isUsdcOnBase(o) &&
				o.payTo.toLowerCase() === this.settings.payTo.toLowerCase() &&
				atomicAmount(o.amount) === amount,
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

		// The quote states the window the API grants this route; settlement happens
		// AFTER the handler, so aborting before window + settlement pays for a
		// response that is thrown away (up to $2.00 on capital links). The user's
		// timeout can only ever extend that floor, never cut it short.
		const plancher = (accepted.maxTimeoutSeconds ?? 120) * 1000 + MARGE_REGLEMENT_MS;
		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'PAYMENT-SIGNATURE': encodeHeader(payload),
			},
			signal: AbortSignal.timeout(Math.max(timeoutMs, plancher)),
		});

		const { body, binary } = await readBody(response);
		if (response.status >= 400) {
			// Sirenic cancels the payment on 404/503, so nothing was charged.
			return { status: response.status, body, paid: 0 };
		}
		this.spent += amount;
		return { status: response.status, body, paid: fromAtomic(amount), binary };
	}
}

/**
 * Reads a response body according to what the endpoint actually returned.
 *
 * Three shapes exist: JSON (almost every route), binary (the PDF report and the
 * original filed documents), and plain text (rate limits and header-size
 * errors, which must not be parsed as JSON or a real error becomes a silent
 * empty object). Binary is returned as raw bytes: reading a PDF with `.text()`
 * replaces every non-UTF-8 byte and destroys a file the user just paid for.
 */
export async function readBody(
	response: Response,
): Promise<{ body: unknown; binary?: CallResult['binary'] }> {
	const type = response.headers.get('content-type') ?? '';
	if (/\bjson\b/.test(type)) {
		return { body: await response.json().catch(() => ({})) };
	}
	if (!type || type.startsWith('text/')) {
		return { body: { message: await response.text().catch(() => '') } };
	}
	const data = Buffer.from(await response.arrayBuffer());
	return {
		body: {
			is_binary: true,
			content_type: type.split(';')[0]?.trim() ?? type,
			bytes: data.length,
			note: 'The bytes are attached as n8n binary data under "data", not in this JSON.',
		},
		binary: {
			data,
			contentType: type.split(';')[0]?.trim() ?? type,
			fileName: fileNameFrom(response.headers.get('content-disposition')),
		},
	};
}

/** Filename the API suggests for a downloaded document, when it sends one. */
function fileNameFrom(disposition: string | null): string | undefined {
	if (!disposition) return undefined;
	const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
	if (!match?.[1]) return undefined;
	// Never throw here: this runs after the server settled the payment.
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}
