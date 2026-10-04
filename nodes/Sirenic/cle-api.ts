/**
 * The "API key and prepaid credits" rail — the other way to pay Sirenic.
 *
 * Nothing is signed and nothing touches a blockchain: the key travels in the
 * `X-Api-Key` header and the account is debited in euros. Same routes, same
 * prices, same responses as the x402 rail — only the means of payment changes.
 *
 * This module honours the SAME contract as `SirenicPayer` (`AppelantSirenic`),
 * so the 61 operations, the node and the trigger never know which of the two
 * rails they hold.
 */
import {
	quotedPriceUsd,
	readBody,
	type AppelantSirenic,
	type CallResult,
	type PaymentUnit,
	type PriceUnavailable,
} from './x402';

export interface KeySettings {
	apiKey: string;
	baseUrl: string;
	/** Spending cap for ONE execution, in credits (1 credit = 1 euro). 0 = no cap. */
	maxSpendPerExecution: number;
}

/** Header through which the API reports what it has just debited. */
const ENTETE_DEBIT = 'x-credits-charged';

/** What is left of the monthly free quota, when the API reports it. */
const ENTETE_QUOTA = 'x-free-quota-remaining';

/**
 * Credits the API reports it debited, in whole thousandths of a credit (the
 * unit it debits in). Anything that is not a finite positive number counts 0:
 * a negative debit would lower the total and loosen the ceiling for the calls
 * that follow.
 */
function milliemesDebites(entete: string | null): number {
	const credits = Number(entete ?? 0);
	return Number.isFinite(credits) && credits > 0 ? Math.round(credits * 1000) : 0;
}

/**
 * The price of a quote in whole thousandths of a credit. The API debits the
 * same number as the dollar price of the quote, in whole thousandths of a
 * credit rounded UP, so the quote is rounded up the same way: never below what
 * the call will cost.
 */
function milliemesDuDevis(usd: number): number {
	return Math.ceil(Math.round(usd * 1_000_000) / 1000);
}

/** The answer to a quote request: the quote, or an answer that is not one. */
type Sonde = { entete: string | null } | { reponse: CallResult };

/** How every refusal of the ceiling ends. */
const RIEN_FACTURE =
	'Nothing was charged: the key was not sent. Raise the ceiling on the Sirenic API Key credential, or send fewer items.';

/** What a refusal says when a deed was, or would be, checked after the call. */
const PHRASE_ACTES =
	'Deed downloads require an account: their price cannot be read without the key, so the ceiling is checked after the call; the overshoot is bounded by one deed price.';

/**
 * The answer the API gives to a deed asked for without a key. Its access
 * policy, which runs before the x402 gate, reserves filed deeds to accounts and
 * answers 401 `compte_requis`, with no quote. That status with that code, and
 * nothing else: any other answer stays what it is.
 */
function estCompteRequis(reponse: CallResult): boolean {
	const corps = reponse.body;
	return (
		reponse.status === 401 &&
		typeof corps === 'object' &&
		corps !== null &&
		(corps as Record<string, unknown>).error === 'compte_requis'
	);
}

export class SirenicKeyCaller implements AppelantSirenic {
	/**
	 * The API debits credits, 1 credit = 1 euro, and reports them in
	 * `x-credits-charged`: what this rail counts is credits, never dollars, even
	 * though the number equals the dollar price of the route. Up to 0.15.0 the
	 * node reported them under `_usd` names with nothing to say so.
	 */
	readonly unit: PaymentUnit = 'credits_eur';

	/** Spent in this execution, in whole thousandths of a credit: an exact count. */
	private depenseMilliemes = 0;

	/** Whether a deed went out in this execution, its ceiling checked after the call. */
	private acteApresCoup = false;

	constructor(private readonly settings: KeySettings) {}

	get totalPaid(): number {
		// Thousandths, not a sum of floats: 0.1 + 0.2 would otherwise end up as
		// 0.30000000000000004 in the output, and a total of exactly the ceiling
		// would compare as above it.
		return this.depenseMilliemes / 1000;
	}

	async call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult> {
		const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;

		if (dryRun) return this.essaiABlanc(url);

		// The ceiling is checked BEFORE the key is sent: once the API has the key,
		// the call is debited. Up to 0.16.0 this rail only added up what the API
		// said it had debited and refused the NEXT call, so the call that crossed
		// the ceiling was charged. It now reads the price of the call first, from
		// the free quote the API returns without the key (the request Dry Run
		// makes), and refuses the call that would take the execution above the
		// ceiling, as the wallet refuses a quote before signing. Deed downloads
		// are the one exception (below). A ceiling of 0 means no ceiling, and no
		// quote is asked for.
		const plafond = this.settings.maxSpendPerExecution;
		if (plafond > 0) {
			const sonde = await this.sonder(url);
			if ('reponse' in sonde) {
				// Not a quote, so not a paid call: a free route answers with its data
				// and an error stays an error, as on the wallet rail. Nothing charged.
				if (!estCompteRequis(sonde.reponse)) return sonde.reponse;
				// A deed: the API serves it to accounts only, and answers this
				// request, made without the key, before any quote. Its price cannot
				// be read without the key, so the call goes out with the key and the
				// ceiling is checked AFTER it, as up to 0.16.0: a deed is refused once
				// the credits charged reach the ceiling, so the overshoot is bounded by
				// one deed price (0.10 credit). Remove this exception in the next
				// version, once the API joins its quote to that 401 (Sirenic ticket
				// #471).
				if (this.depenseMilliemes / 1000 >= plafond) {
					throw new Error(
						`Spending ceiling: ${this.totalPaid} credits are already charged in this execution, at or above the "Max Spend Per Execution" ceiling of ${plafond} credits (1 credit = 1 euro). ` +
							`${PHRASE_ACTES} ${RIEN_FACTURE}`,
					);
				}
				this.acteApresCoup = true;
			} else {
				const prix = quotedPriceUsd(sonde.entete);
				if (prix.usd === null) throw new Error(refusDevisIllisible(prix.reason));
				const devis = milliemesDuDevis(prix.usd);
				const total = (this.depenseMilliemes + devis) / 1000;
				if (total > plafond) {
					// After a deed, the total may already be over the ceiling: say why.
					throw new Error(
						`Spending ceiling: this call is quoted ${devis / 1000} credits and would bring the execution total to ${total} credits, above the "Max Spend Per Execution" ceiling of ${plafond} credits (1 credit = 1 euro). ` +
							`${this.acteApresCoup ? `${PHRASE_ACTES} ` : ''}${RIEN_FACTURE}`,
					);
				}
			}
		}

		const reponse = await fetch(url, {
			headers: { Accept: 'application/json', 'X-Api-Key': this.settings.apiKey },
			signal: AbortSignal.timeout(timeoutMs),
		});

		// Debited by the API, not estimated by us: a copied price drifts, and a
		// batch route costs its unit price MULTIPLIED by the number of entities.
		const paye = milliemesDebites(reponse.headers.get(ENTETE_DEBIT));
		this.depenseMilliemes += paye;

		const { body, binary } = await readBody(reponse);
		const quota = reponse.headers.get(ENTETE_QUOTA);
		return {
			status: reponse.status,
			body:
				quota !== null && body !== null && typeof body === 'object' && !Array.isArray(body)
					? { ...(body as Record<string, unknown>), free_quota_remaining: Number(quota) }
					: body,
			paid: paye / 1000,
			...(binary ? { binary } : {}),
		};
	}

	/**
	 * Asks the API for the quote of a call, WITHOUT the key: it answers 402 with
	 * the quote, for free. Dry Run and the ceiling read prices through this one
	 * request, so they cannot disagree on what a call costs.
	 *
	 * Any other answer is not a quote: a free route answers with its data (the
	 * same answer it gives with the key) and an error stays an error. One
	 * answer differs with the key, and `call` reads it: the 401 a deed gets
	 * without one.
	 */
	private async sonder(url: string): Promise<Sonde> {
		const sonde = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(30_000),
		});
		if (sonde.status !== 402) {
			const { body, binary } = await readBody(sonde);
			return { reponse: { status: sonde.status, body, paid: 0, ...(binary ? { binary } : {}) } };
		}
		// Read the body to the end, so the call with the key can reuse the
		// connection: left unread, it made the next request open a new one
		// (measured on 4 Oct 2026, about 50 ms more).
		await sonde.arrayBuffer().catch(() => undefined);
		return { entete: sonde.headers.get('payment-required') };
	}

	/**
	 * A dry run WITHOUT the key: the API answers 402 with its quote.
	 *
	 * It is free and it is true — the quote comes from the price grid, not from
	 * a price this node would have copied. A free route answers 200 and says so.
	 *
	 * The price is read from the quote by the same code as the wallet rail, in
	 * the same field. From 0.13.0 to 0.15.0 this rail only pointed at the
	 * PAYMENT-REQUIRED header, and n8n shows the body of a response, never its
	 * headers: the dry run of the default rail stated no price at all.
	 */
	private async essaiABlanc(url: string): Promise<CallResult> {
		const sonde = await this.sonder(url);
		// Not a quote, so not a dry-run answer: a free route answers with its
		// data and an error stays an error, exactly as on the wallet rail. Flagged
		// as a dry run (up to 0.15.0), a 429 or a 503 came out of this rail as a
		// normal item carrying no price.
		if ('reponse' in sonde) return sonde.reponse;
		const prix = quotedPriceUsd(sonde.entete);
		return {
			status: 402,
			body:
				prix.usd === null
					? {
							dry_run: true,
							would_pay_usd: null,
							price_unavailable_reason: prix.reason,
							resource: url,
							message:
								'Dry run: the route is billable, but the quote the API sent could not be read, so no price is stated (see price_unavailable_reason). Your key was not sent, so nothing was charged.',
						}
					: {
							dry_run: true,
							would_pay_usd: prix.usd,
							resource: url,
							message:
								'Dry run: would_pay_usd is the price the API quotes for this call. This rail debits the same number in credits (1 credit = 1 euro), or nothing when your monthly free quota covers the call. Your key was not sent, so nothing was charged.',
						},
			paid: 0,
			dryRun: true,
		};
	}
}

/**
 * What the ceiling says when it cannot read the quote of a call. The call is
 * not made: a ceiling cannot bound what it cannot price.
 */
function refusDevisIllisible(raison: PriceUnavailable): string {
	return (
		`The quote for this call could not be read (${raison}), so "Max Spend Per Execution" cannot tell whether the call fits under the ceiling. ` +
		'Nothing was charged: the key was not sent. Dry Run reports the same reason in price_unavailable_reason.'
	);
}
