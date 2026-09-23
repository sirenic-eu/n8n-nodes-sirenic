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
import { readBody, type AppelantSirenic, type CallResult } from './x402';

export interface KeySettings {
	apiKey: string;
	baseUrl: string;
	/** Spending cap for ONE execution, in dollars. 0 = no cap. */
	maxSpendPerExecution: number;
}

/** Header through which the API reports what it has just debited. */
const ENTETE_DEBIT = 'x-credits-charged';

/** What is left of the monthly free quota, when the API reports it. */
const ENTETE_QUOTA = 'x-free-quota-remaining';

export class SirenicKeyCaller implements AppelantSirenic {
	private depense = 0;

	constructor(private readonly settings: KeySettings) {}

	get totalPaid(): number {
		// Rounded to the thousandth: grid prices go down to $0.002, and a sum of
		// floats would otherwise end up as 0.30000000000000004 in the output.
		return Math.round(this.depense * 1000) / 1000;
	}

	async call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult> {
		const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;

		if (dryRun) return this.essaiABlanc(url);

		// The cap is checked BEFORE the call: afterwards it is already debited. It
		// cannot refuse a quote — this rail produces none — so it adds up what the
		// API SAYS it debited, call after call, and stops before the one that
		// would cross the line.
		const plafond = this.settings.maxSpendPerExecution;
		if (plafond > 0 && this.depense >= plafond) {
			throw new Error(
				`Spending ceiling reached: ${this.totalPaid} USD charged in this execution, limit ${plafond} USD. ` +
					'Raise "Max Spend Per Execution" on the Sirenic API Key credential, or send fewer items.',
			);
		}

		const reponse = await fetch(url, {
			headers: { Accept: 'application/json', 'X-Api-Key': this.settings.apiKey },
			signal: AbortSignal.timeout(timeoutMs),
		});

		// Debited by the API, not estimated by us: a copied price drifts, and a
		// batch route costs its unit price MULTIPLIED by the number of entities.
		const debite = Number(reponse.headers.get(ENTETE_DEBIT) ?? 0);
		const paid = Number.isFinite(debite) && debite > 0 ? debite : 0;
		this.depense += paid;

		const { body, binary } = await readBody(reponse);
		const quota = reponse.headers.get(ENTETE_QUOTA);
		return {
			status: reponse.status,
			body:
				quota !== null && body !== null && typeof body === 'object' && !Array.isArray(body)
					? { ...(body as Record<string, unknown>), free_quota_remaining: Number(quota) }
					: body,
			paid,
			...(binary ? { binary } : {}),
		};
	}

	/**
	 * A dry run WITHOUT the key: the API answers 402 with its quote.
	 *
	 * It is free and it is true — the quote comes from the price grid, not from
	 * a price this node would have copied. A free route answers 200 and says so.
	 */
	private async essaiABlanc(url: string): Promise<CallResult> {
		const sonde = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(30_000),
		});
		if (sonde.status !== 402) {
			const libre = await readBody(sonde);
			return { status: sonde.status, body: libre.body, paid: 0, dryRun: true };
		}
		return {
			status: 402,
			body: {
				dry_run: true,
				resource: url,
				quote: sonde.headers.get('payment-required') ? 'see PAYMENT-REQUIRED header' : null,
				message:
					'Dry run: the route exists and is billable. Nothing was called with your key, so nothing was charged.',
			},
			paid: 0,
			dryRun: true,
		};
	}
}
