import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { cleEvenement, verifierLivraison, type CleDeSignature } from './signature';

/**
 * Sirenic Trigger — starts a workflow when a watched company changes.
 *
 * DESIGN RULE: this node NEVER spends money. Creating or renewing a watch is a
 * paid, per-target operation (up to $5.00 for 100 targets), so it stays an
 * explicit action on the main Sirenic node. Activating a workflow must not
 * charge anyone. Consequently `webhookMethods` registers nothing upstream: the
 * node hands you a URL, and you pass that URL to "Create Watch" yourself.
 *
 * Two modes, because Sirenic refuses a webhook URL that is not public HTTPS on
 * port 443 — which rules out most self-hosted instances:
 *  - `webhook`: Sirenic POSTs signed batches. Nothing is polled, nothing is paid.
 *  - `poll`: the node reads the watch back through its FREE read route. Also the
 *    only way to test the wiring, since the API sends no handshake on creation.
 *
 * No credential is required: reception costs nothing and the read route is
 * authorised by the watch token itself. Receiving events must not force a user
 * to hand a wallet private key to a trigger.
 *
 * ON DUPLICATES. Sirenic sends no event id and retries a batch up to three times
 * with identical bytes, so every item carries `_sirenic.event_key`, a stable hash
 * of the event. In polling mode the node remembers the keys it already emitted.
 * In webhook mode it CANNOT: n8n discards whatever a webhook context writes to
 * static data as soon as that webhook starts an execution (measured — only a
 * request that triggered nothing kept its write). Chain a Remove Duplicates node
 * on `_sirenic.event_key` if your workflow is not idempotent.
 */

/** Fallback when no base URL is given. */
const BASE_URL_DEFAUT = 'https://api.sirenic.eu';

/** Replay window. Wide enough for Sirenic's three retries over ~33 s. */
const TOLERANCE_HORODATAGE_MS = 5 * 60 * 1000;

/** How many event keys to remember. Bounded so static data cannot grow forever. */
const MEMOIRE_DEDUP = 500;

interface EtatNode {
	cleSignature?: CleDeSignature;
	cleSignatureLueLe?: number;
	vus?: string[];
}

// `usableAsTool` is deliberately absent. The type only admits `true`, and a
// trigger is not something an agent can call: it is started by Sirenic pushing a
// batch, or by the poll timer. Declaring it a tool would offer an agent an entry
// point that cannot be invoked. The paid lookups are on the main Sirenic node,
// which IS exposed as a tool.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class SirenicTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sirenic Trigger',
		name: 'sirenicTrigger',
		icon: { light: 'file:sirenic.light.svg', dark: 'file:sirenic.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["mode"] === "webhook" ? "webhook" : "polling"}}',
		description: 'Starts the workflow when a watched French company changes',
		defaults: { name: 'Sirenic Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		polling: true,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
				// The URL is meaningless in polling mode; hide it rather than let
				// someone paste an address nothing will ever call.
				ndvHideUrl: '={{$parameter["mode"] !== "webhook"}}',
			},
		],
		codex: {
			categories: ['Data & Storage', 'Finance & Accounting'],
			resources: { primaryDocumentation: [{ url: 'https://api.sirenic.eu' }] },
			alias: [
				'monitoring', 'watch', 'surveillance', 'insolvency', 'BODACC',
				'company', 'KYB', 'compliance', 'alert', 'webhook',
			],
		},
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				default: 'webhook',
				description:
					'How events reach this workflow. Sirenic only accepts a public HTTPS webhook on port 443, so a self-hosted n8n that is not reachable from the internet must poll instead.',
				options: [
					{
						name: 'Webhook (Sirenic Pushes Events)',
						value: 'webhook',
						description:
							'Sirenic POSTs signed batches to the URL below. Copy that URL into the Webhook URL field of Create Watch on the Sirenic node. A retry can repeat a batch, so chain a Remove Duplicates node on _sirenic.event_key if your workflow is not idempotent.',
					},
					{
						name: 'Polling (This Node Asks)',
						value: 'poll',
						description:
							'Reads the watch through its free read route. Works behind a firewall, and is the only way to test the wiring — Sirenic sends nothing when a watch is created.',
					},
				],
			},
			{
				displayName: 'Watch Token',
				name: 'watchToken',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				required: true,
				displayOptions: { show: { mode: ['poll'] } },
				description:
					'Token returned by Create Watch. It is the only credential the read route needs, and reading is free.',
			},
			{
				displayName: 'API Base URL',
				name: 'baseUrl',
				type: 'string',
				default: BASE_URL_DEFAUT,
				description:
					'Where to read the signing key and, in polling mode, the watch. Change it only against a Sirenic staging instance.',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				displayOptions: { show: { mode: ['webhook'] } },
				description:
					'Whether to check the Ed25519 signature of every batch and reject anything unsigned. Leave this on: the URL is otherwise a public endpoint anyone could post to.',
			},
			{
				displayName: 'Ignore Degraded-Source Notices',
				name: 'ignoreDegraded',
				type: 'boolean',
				default: false,
				description:
					'Whether to drop surveillance_degradee events. They report that a source was unreachable for a day, not a change at the company — useful to know, noisy to act on.',
			},
		],
	};

	// Nothing is registered upstream, on purpose: creating a watch is a paid
	// operation and must stay an explicit user action. These hooks exist because
	// n8n requires them for a webhook node, and they deliberately do nothing.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();

		// Idempotent, and it guarantees the bytes whatever the content type: the
		// signature covers the raw body, so a re-serialised JSON would not verify.
		await req.readRawBody();
		const corps = req.rawBody;

		if (this.getNodeParameter('verifySignature', true) as boolean) {
			if (!corps || corps.length === 0) {
				res.status(400).json({ error: 'empty body' });
				return { noWebhookResponse: true };
			}
			const cle = await cleDeSignature.call(this, false);
			const entetes = {
				kid: req.header('x-sirenic-key-id'),
				horodatage: req.header('x-sirenic-timestamp'),
				signature: req.header('x-sirenic-signature'),
			};
			let resultat = verifierLivraison(corps, entetes, cle, Date.now(), TOLERANCE_HORODATAGE_MS);

			// An unknown key id is what a rotation looks like from here. Refetch
			// once, bypassing the cache, before calling it a forgery.
			if (!resultat.valide && resultat.raison?.startsWith('unknown key id')) {
				const fraiche = await cleDeSignature.call(this, true);
				resultat = verifierLivraison(corps, entetes, fraiche, Date.now(), TOLERANCE_HORODATAGE_MS);
			}

			if (!resultat.valide) {
				// 401 stops Sirenic's retries for this round (it does not retry on
				// 4xx). The batch stays unacknowledged and comes back on the next
				// daily run, which is what we want while the setup is wrong.
				res.status(401).json({ error: 'invalid signature', reason: resultat.raison });
				return { noWebhookResponse: true };
			}
		}

		const lot = (req.body ?? {}) as IDataObject;
		// No deduplication here: n8n discards what a webhook context writes to
		// static data as soon as the webhook starts an execution, so a memory kept
		// here would be a lie. Every item carries `_sirenic.event_key` instead,
		// ready for a Remove Duplicates node.
		const items = evenementsEnItems.call(this, lot, false);

		// Always acknowledge, even when every event was a duplicate: a non-2xx
		// answer makes Sirenic redeliver the same batch tomorrow.
		if (items.length === 0) {
			res.status(200).json({ received: true, new_events: 0 });
			return { noWebhookResponse: true };
		}
		return { workflowData: [items] };
	}

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		// A node carrying both `webhook()` and `poll()` is activated twice by
		// n8n — the two paths never consult each other. Leaving quietly is what
		// keeps webhook mode from polling behind the user's back.
		if ((this.getNodeParameter('mode', 'webhook') as string) !== 'poll') {
			return null;
		}

		const jeton = (this.getNodeParameter('watchToken', '') as string).trim();
		if (!jeton) {
			throw new NodeOperationError(
				this.getNode(),
				'Polling mode needs the Watch Token returned by Create Watch.',
			);
		}
		const base = baseUrl.call(this);
		const reponse = (await this.helpers.httpRequest({
			method: 'GET',
			url: `${base}/v1/surveillance/${encodeURIComponent(jeton)}`,
			json: true,
		})) as IDataObject;

		// Polling is where the memory works: a poll context's static data is
		// persisted between runs, as in n8n's own polling triggers.
		const items = evenementsEnItems.call(this, reponse, true);
		return items.length > 0 ? [items] : null;
	}
}

/**
 * Turns a batch — from the webhook or from the read route, both carry the same
 * event shape — into one item per NEW event.
 *
 * Deduplication is not optional: the API exposes no event id, a batch can arrive
 * three times with identical bytes, and an undelivered one returns the next day.
 * A manual execution deliberately skips the memory so a test always shows
 * something.
 */
function evenementsEnItems(
	this: IWebhookFunctions | IPollFunctions,
	lot: IDataObject,
	memoriser: boolean,
): INodeExecutionData[] {
	const surveillanceId = String(lot.surveillance_id ?? '');
	const evenements = Array.isArray(lot.evenements) ? (lot.evenements as IDataObject[]) : [];
	const ignorerDegrade = this.getNodeParameter('ignoreDegraded', false) as boolean;
	const manuel = this.getMode() === 'manual';
	const dedupliquer = memoriser && !manuel;

	const etat = this.getWorkflowStaticData('node') as EtatNode;
	const vus = Array.isArray(etat.vus) ? etat.vus : [];
	const connus = new Set(vus);
	const items: INodeExecutionData[] = [];
	const nouvelles: string[] = [];

	for (const evenement of evenements) {
		if (ignorerDegrade && evenement.type === 'surveillance_degradee') continue;
		const cle = cleEvenement(surveillanceId, evenement);
		if (dedupliquer && connus.has(cle)) continue;
		nouvelles.push(cle);
		items.push({
			json: {
				...evenement,
				surveillance_id: surveillanceId,
				_sirenic: { event_key: cle, source: manuel ? 'manual' : 'automatic' },
			},
		});
	}

	// Remember only where the memory actually survives, and never on a manual
	// run: a test must not consume the events a scheduled run is waiting for.
	if (dedupliquer && nouvelles.length > 0) {
		etat.vus = [...vus, ...nouvelles].slice(-MEMOIRE_DEDUP);
	}
	return items;
}

/** Base URL without its trailing slash. */
function baseUrl(this: IWebhookFunctions | IPollFunctions | IHookFunctions): string {
	const brut = (this.getNodeParameter('baseUrl', BASE_URL_DEFAUT) as string).trim();
	return (brut || BASE_URL_DEFAUT).replace(/\/+$/, '');
}

/**
 * The published signing key, cached in the node's static data.
 *
 * Fetched rather than hard-coded so a key rotation does not silently turn every
 * delivery into a forgery; cached so a busy webhook does not refetch per call.
 */
async function cleDeSignature(
	this: IWebhookFunctions,
	forcer: boolean,
): Promise<CleDeSignature> {
	const etat = this.getWorkflowStaticData('node') as EtatNode;
	const age = Date.now() - (etat.cleSignatureLueLe ?? 0);
	if (!forcer && etat.cleSignature && age < 24 * 60 * 60 * 1000) {
		return etat.cleSignature;
	}
	const url = `${baseUrl.call(this)}/.well-known/sirenic-signing-key`;
	const reponse = (await this.helpers.httpRequest({ method: 'GET', url, json: true })) as IDataObject;
	const cle: CleDeSignature = {
		kid: String(reponse.kid ?? ''),
		alg: String(reponse.alg ?? ''),
		public_key: String(reponse.public_key ?? ''),
	};
	if (!cle.kid || !cle.public_key) {
		throw new NodeOperationError(
			this.getNode(),
			`Could not read the signing key from ${url}. Turn off Verify Signature only if you trust the network path.`,
		);
	}
	etat.cleSignature = cle;
	etat.cleSignatureLueLe = Date.now();
	return cle;
}
