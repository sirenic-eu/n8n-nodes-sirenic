/**
 * Le rail « clé d'API et crédits prépayés » — l'autre façon de payer Sirenic.
 *
 * Rien n'est signé, rien ne touche une blockchain : la clé part dans l'en-tête
 * `X-Api-Key` et le compte est débité en euros. Mêmes routes, mêmes prix,
 * mêmes réponses que le rail x402 — seul le moyen de paiement change.
 *
 * Ce module honore le MÊME contrat que `SirenicPayer` (`AppelantSirenic`), de
 * sorte que les 61 opérations, le node et le trigger ignorent lequel des deux
 * rails ils tiennent.
 */
import { readBody, type AppelantSirenic, type CallResult } from './x402';

export interface KeySettings {
	apiKey: string;
	baseUrl: string;
	/** Plafond de dépense sur UNE exécution, en dollars. 0 = pas de plafond. */
	maxSpendPerExecution: number;
}

/** En-tête par lequel l'API annonce ce qu'elle vient de débiter. */
const ENTETE_DEBIT = 'x-credits-charged';

/** Ce qui reste du quota gratuit mensuel, quand l'API le dit. */
const ENTETE_QUOTA = 'x-free-quota-remaining';

export class SirenicKeyCaller implements AppelantSirenic {
	private depense = 0;

	constructor(private readonly settings: KeySettings) {}

	get totalPaid(): number {
		// Arrondi au millième : les prix de la grille descendent à $0.002, et une
		// somme de flottants finit sinon en 0.30000000000000004 dans la sortie.
		return Math.round(this.depense * 1000) / 1000;
	}

	async call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult> {
		const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;

		if (dryRun) return this.essaiABlanc(url);

		// Le plafond se vérifie AVANT l'appel : après, c'est déjà débité. Il ne
		// peut pas refuser un devis — ce rail n'en produit pas — donc il compte ce
		// que l'API DIT avoir débité, appel après appel, et s'arrête avant celui
		// qui franchirait la ligne.
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

		// Débité par l'API, pas estimé par nous : un prix recopié dérive, et une
		// route à lot coûte son prix unitaire MULTIPLIÉ par le nombre d'entités.
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
	 * Un essai à blanc SANS la clé : l'API répond 402 avec son devis.
	 *
	 * C'est gratuit et c'est vrai — le devis vient de la grille, pas d'un prix
	 * que ce node aurait recopié. Une route gratuite répond 200 et le dit.
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
