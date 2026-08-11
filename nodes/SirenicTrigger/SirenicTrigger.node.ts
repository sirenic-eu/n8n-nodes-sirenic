import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SirenicPayer, type PaymentSettings } from '../Sirenic/x402';
import { cleEvenement, verifierLivraison, type CleDeSignature } from './signature';

/**
 * Sirenic Trigger — starts a workflow when a watched company changes.
 *
 * THE WATCH LIFECYCLE LIVES HERE. Sirenic surveillance is a subscription: the
 * caller hands over a URL and Sirenic posts signed batches to it. That is n8n's
 * trigger pattern, so `webhookMethods` owns it end to end — activating the
 * workflow creates the watch, `checkExists` re-uses it, deactivating can stop
 * it. Earlier versions asked the user to create the watch by hand on the
 * Sirenic node and paste the URL across; n8n's review rejected that shape, and
 * they were right: two nodes shared one subscription and neither owned it.
 *
 * IT SPENDS MONEY, AND ONLY WHERE THE USER CAN SEE IT. Creating a watch costs
 * $0.05 per target for 30 days, $0.135 for 90 days or $0.50 for a year
 * (so $5.00, $13.50 or $50.00 for the maximum of 100 targets), so:
 *  - the paid call happens on ACTIVATION, never on "Listen for test event" —
 *    a test listen registers a throwaway URL, and paying for one would be a
 *    trap;
 *  - `checkExists` verifies the stored watch before create() runs, so toggling
 *    a workflow off and on does not pay twice;
 *  - an unreachable API at activation FAILS activation rather than assume the
 *    watch is gone and pay for a second one;
 *  - deactivating keeps the watch by default: it is prepaid for its whole
 *    duration, and stopping it early forfeits the rest — there is no refund.
 *
 * Two delivery modes, because Sirenic refuses a webhook URL that is not public
 * HTTPS on port 443 — which rules out most self-hosted instances:
 *  - `webhook`: Sirenic POSTs signed batches to this node's production URL.
 *  - `poll`: the watch is created with no delivery channel and this node reads
 *    it back through the FREE read route. Works behind a firewall.
 *
 * RENEWAL. A watch lasts 30, 90 or 365 days, as chosen in Duration. A workflow
 * that stays active while its watch quietly expires is the worst possible
 * outcome — it looks monitored and is not — so the poll tick renews it before
 * expiry, buying whatever Duration is set at that moment. Turn that off
 * and the node emits a `surveillance_expiree` item instead of going silent.
 *
 * ON DUPLICATES. Sirenic sends no event id and retries a batch up to three
 * times with identical bytes, so every item carries `_sirenic.event_key`, a
 * stable hash of the event. In polling mode the node remembers the keys it
 * already emitted. In webhook mode it CANNOT: n8n discards whatever a webhook
 * context writes to static data as soon as that webhook starts an execution
 * (measured — only a request that triggered nothing kept its write). Chain a
 * Remove Duplicates node on `_sirenic.event_key` if your workflow is not
 * idempotent.
 */

/** Fallback when no base URL is given. */
const BASE_URL_DEFAUT = 'https://api.sirenic.eu';

/** Replay window. Wide enough for Sirenic's three retries over ~33 s. */
const TOLERANCE_HORODATAGE_MS = 5 * 60 * 1000;

/** How many event keys to remember. Bounded so static data cannot grow forever. */
const MEMOIRE_DEDUP = 500;

/** Maximum targets in one watch, as the API enforces it. */
const MAX_CIBLES = 100;

/**
 * Watch durations Sirenic sells, in days. Kept in step with the API grid — a
 * value absent from it is refused with 400 duree_invalide, and nothing is
 * charged.
 */
const DUREES_VENDUES = [30, 90, 365];

/**
 * Renew this long before expiry. Renewal adds the chosen duration to the
 * CURRENT expiry date, not to today, so renewing early costs nothing in
 * coverage — and the margin absorbs a poll interval measured in days.
 *
 * Seven days is also when Sirenic emits its own expiration_proche event, so the
 * two warnings line up instead of contradicting each other.
 */
const MARGE_RENOUVELLEMENT_MS = 7 * 864e5;

/** In webhook delivery the poll tick is pure maintenance; four times a day is plenty. */
const PERIODE_ENTRETIEN_MS = 6 * 3600e3;

/** Creation and renewal are single database writes; the API answers in seconds. */
const TIMEOUT_PAIEMENT_MS = 60_000;

interface EtatNode {
	cleSignature?: CleDeSignature;
	cleSignatureLueLe?: number;
	vus?: string[];
	/** The watch this node created and now owns. */
	jeton?: string;
	/** Normalised target keys of that watch, to detect a changed target list. */
	cibles?: string[];
	expireLe?: string;
	entretenuLe?: number;
	expirationSignalee?: boolean;
}

/** Every context this node runs in exposes the helpers used below. */
type Contexte = IHookFunctions | IPollFunctions | IWebhookFunctions;

/** A target list, ready for the API (`liste`) and for comparison (`cles`). */
interface Cibles {
	liste: string[];
	cles: string[];
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
		// Only needed when this node creates the watch: reading one back and
		// receiving its events cost nothing and are authorised by the watch token
		// itself. Nobody should have to hand a wallet key to a trigger that only
		// listens.
		credentials: [
			{
				name: 'sirenicApi',
				required: true,
				displayOptions: { show: { watchSource: ['managed'] } },
			},
		],
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
				displayName: 'Watch',
				name: 'watchSource',
				type: 'options',
				default: 'managed',
				description:
					'Where the watch comes from. Company monitoring covers France: officers, insolvency, deregistration, sanctions and regulator matches, checked daily against the official sources.',
				options: [
					{
						name: 'Created and Managed by This Trigger',
						value: 'managed',
						description:
							'Activating the workflow creates the watch and PAYS for it, at the per-target price of the chosen Duration (up to $5.00 for 100 targets over 30 days, $50.00 over a year — raise Max Amount Per Call on the credential accordingly). Deactivating keeps it unless you say otherwise, and re-activating never pays twice.',
					},
					{
						name: 'Already Created Elsewhere',
						value: 'existing',
						description:
							'Receive the events of a watch created outside n8n, from its token. Nothing is created, renewed or stopped here, and no wallet is needed.',
					},
				],
			},
			{
				displayName: 'Targets',
				name: 'targets',
				type: 'string',
				default: '',
				required: true,
				placeholder: '552032534,542065479',
				displayOptions: { show: { watchSource: ['managed'] } },
				description:
					'One to 100 comma-separated entries: nine-digit SIRENs, or "dirigeant:Name" to follow the public mandates of a person. Changing this list after activation replaces the watch — the old one is stopped and a new one is paid for.',
			},
			{
				displayName: 'Duration',
				name: 'duree',
				type: 'options',
				default: 30,
				displayOptions: { show: { watchSource: ['managed'] } },
				// Changing this on an ALREADY ACTIVE workflow does NOT re-create the
				// watch and charges nothing: the current watch is already paid for its
				// own duration. The new value is what the next RENEWAL buys. Re-creating
				// here would bill a second watch for a dropdown change.
				description:
					'How long each paid watch runs. Longer is cheaper per day, and this is also what renewals buy. Changing it on an active workflow costs nothing and does not restart the watch: the new duration applies at the next renewal.',
				options: [
					{
						name: '30 Days, $0.05 per Target',
						value: 30,
						description: 'Up to $5.00 for the maximum of 100 targets',
					},
					{
						name: '90 Days, $0.135 per Target (10% Off)',
						value: 90,
						description: 'Up to $13.50 for the maximum of 100 targets',
					},
					{
						name: '365 Days, $0.50 per Target (17.8% Off)',
						value: 365,
						description:
							'Up to $50.00 for the maximum of 100 targets. Raise Max Amount Per Call on the credential before activating.',
					},
				],
			},
			{
				displayName: 'Delivery',
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
							'The watch is created against the production URL of this node and Sirenic POSTs signed batches to it. A retry can repeat a batch, so chain a Remove Duplicates node on _sirenic.event_key if your workflow is not idempotent.',
					},
					{
						name: 'Polling (This Node Asks)',
						value: 'poll',
						description:
							'The watch is created with no delivery channel and this node reads it through its free read route. Works behind a firewall, and lets you test the wiring — Sirenic sends nothing when a watch is created.',
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
				displayOptions: { show: { watchSource: ['existing'] } },
				description:
					'Token returned when the watch was created. It is the only credential the read route needs, and reading is free.',
			},
			{
				displayName: 'Renew Before Expiry',
				name: 'autoRenew',
				type: 'boolean',
				default: true,
				displayOptions: { show: { watchSource: ['managed'] } },
				description:
					'Whether to renew the watch before it runs out, buying whatever Duration is set at that moment. Leave it on: an active workflow whose watch has quietly expired looks monitored and is not. Turned off, the node emits a surveillance_expiree item instead of going silent.',
			},
			{
				displayName: 'Stop the Watch When the Workflow Is Deactivated',
				name: 'stopOnDeactivate',
				type: 'boolean',
				default: false,
				displayOptions: { show: { watchSource: ['managed'] } },
				description:
					'Whether to stop the watch when the workflow is deactivated. Off by default because the watch is prepaid for its whole duration, and stopping refunds nothing: keeping it means re-activating costs nothing. Turn it on to have the targets and their events purged from Sirenic immediately.',
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
			{
				displayName: 'API Base URL',
				name: 'baseUrl',
				type: 'string',
				default: BASE_URL_DEFAUT,
				displayOptions: { show: { watchSource: ['existing'] } },
				description:
					'Where to read the watch and the signing key. Change it only against a Sirenic staging instance. With a managed watch this comes from the credential instead, so the paid call and the read can never target different servers.',
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * Answers "is the subscription already in place?". Getting this wrong
			 * costs real money, so it never guesses: only a watch Sirenic confirms
			 * is gone leads to a new, paid one.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				if (sourceSurveillance.call(this) !== 'managed') return true;

				const etat = this.getWorkflowStaticData('node') as EtatNode;
				if (!etat.jeton) return false;

				let watch: IDataObject;
				try {
					watch = await lireSurveillance.call(this, etat.jeton);
				} catch (error) {
					if (statutDe(error) === 404) {
						// Sirenic does not know this token any more: purged after the
						// grace period, or stopped elsewhere. Creating a new one is right.
						oublierSurveillance(etat);
						return false;
					}
					// Anything else — network, 5xx, DNS — means we do NOT know. Saying
					// "it is gone" here would pay for a duplicate watch every time the
					// API blinks during an activation.
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						message: 'Could not reach Sirenic to check the existing watch',
						description:
							'Activation was stopped rather than risk paying for a second watch. Nothing was charged. Try again once api.sirenic.eu answers.',
					});
				}

				if (String(watch.statut ?? '') === 'expiree') {
					oublierSurveillance(etat);
					return false;
				}
				// A changed target list is a different watch. create() stops the old
				// one before paying for the new one.
				if (!memesCibles(clesDeLetat(watch), ciblesDemandees.call(this).cles)) return false;

				etat.expireLe = typeof watch.expire_le === 'string' ? watch.expire_le : etat.expireLe;
				return true;
			},

			/** Creates the watch — the only place in this node that spends money. */
			async create(this: IHookFunctions): Promise<boolean> {
				if (sourceSurveillance.call(this) !== 'managed') return true;

				const etat = this.getWorkflowStaticData('node') as EtatNode;
				const cibles = ciblesDemandees.call(this);

				// n8n runs these same hooks for "Listen for test event", against a
				// throwaway URL that stops existing when the listen ends. Paying
				// $0.05 per target for that would be indefensible.
				if (this.getMode() === 'manual' || this.getActivationMode() === 'manual') {
					if (etat.jeton) return true;
					throw new NodeOperationError(
						this.getNode(),
						'Listening for a test event would create a PAID watch, so this node refuses',
						{
							description:
								'Activate the workflow instead: activation creates the watch once and Sirenic then posts to the production URL. To try the wiring first, set Delivery to Polling and use an existing Watch Token — reading a watch back is free.',
						},
					);
				}

				// A stored watch with a different target list is dead weight: it would
				// keep pushing events for targets nobody asked about. Stopping it is
				// free.
				if (etat.jeton && !memesCibles(etat.cibles ?? [], cibles.cles)) {
					try {
						await arreterSurveillance.call(this, etat.jeton);
					} catch (error) {
						// Already gone, or unreachable. Either way the new watch is what
						// matters, and the old one expires on its own — so this is logged,
						// never rethrown: it must not block the activation.
						this.logger?.debug('Could not stop old watch: ' + String(error));
					}
					oublierSurveillance(etat);
				}

				const requete = new URLSearchParams({ cibles: cibles.liste.join(',') });
				requete.set('duree', String(dureeChoisie.call(this)));
				if ((this.getNodeParameter('mode', 'webhook') as string) === 'webhook') {
					const url = this.getNodeWebhookUrl('default');
					if (!url) {
						throw new NodeOperationError(
							this.getNode(),
							'n8n did not provide a production webhook URL for this node',
						);
					}
					requete.set('webhook', url);
				}

				const corps = await appelPaye.call(
					this,
					`/v1/surveillance/creer?${requete.toString()}`,
					'Creating the watch',
				);

				const jeton = String(corps.surveillance_id ?? '');
				if (!jeton) {
					throw new NodeOperationError(
						this.getNode(),
						'Sirenic accepted the payment but returned no watch token',
						{ description: 'Contact contact@sirenic.eu with the time of this activation.' },
					);
				}
				etat.jeton = jeton;
				etat.cibles = cibles.cles;
				etat.expireLe = typeof corps.expire_le === 'string' ? corps.expire_le : undefined;
				etat.entretenuLe = Date.now();
				etat.expirationSignalee = false;
				etat.vus = [];
				return true;
			},

			/**
			 * Deactivation. Stopping is free but forfeits the rest of the 30 prepaid
			 * days, so it only happens when the user asked for it.
			 */
			async delete(this: IHookFunctions): Promise<boolean> {
				if (sourceSurveillance.call(this) !== 'managed') return true;

				const etat = this.getWorkflowStaticData('node') as EtatNode;
				if (!etat.jeton) return true;
				if (!(this.getNodeParameter('stopOnDeactivate', false) as boolean)) return true;

				try {
					await arreterSurveillance.call(this, etat.jeton);
				} catch (error) {
					if (statutDe(error) !== 404) {
						throw new NodeApiError(this.getNode(), error as JsonObject, {
							message: 'Could not stop the watch on Sirenic',
							description:
								'The workflow is deactivated all the same. The watch stops on its own at expiry, or you can stop it by calling GET /v1/surveillance/{token}/arreter.',
						});
					}
				}
				oublierSurveillance(etat);
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
		const source = sourceSurveillance.call(this);
		const parWebhook = (this.getNodeParameter('mode', 'webhook') as string) === 'webhook';
		const manuel = this.getMode() === 'manual';
		const etat = this.getWorkflowStaticData('node') as EtatNode;

		const jeton =
			source === 'managed'
				? (etat.jeton ?? '')
				: String(this.getNodeParameter('watchToken', '') ?? '').trim();
		if (!jeton) {
			if (source === 'managed') {
				// Nothing has been created yet: the workflow has never been active.
				// A trigger that threw here would make every save look broken.
				return null;
			}
			throw new NodeOperationError(
				this.getNode(),
				'This trigger needs the Watch Token of the watch it should read',
			);
		}

		// In webhook delivery this tick exists only to keep the watch alive, so it
		// stays cheap and rare. In polling delivery it IS the delivery channel.
		if (parWebhook) {
			if (source !== 'managed' || manuel) return null;
			if (Date.now() - (etat.entretenuLe ?? 0) < PERIODE_ENTRETIEN_MS) return null;
		}

		const watch = await lireSurveillance.call(this, jeton);

		const avis = source === 'managed' && !manuel ? await entretenir.call(this, watch, etat) : null;

		// Webhook delivery: Sirenic pushes the events, this path must not emit
		// them a second time. Only a lifecycle notice goes through.
		if (parWebhook) return avis ? [[avis]] : null;

		// Polling is where the memory works: a poll context's static data is
		// persisted between runs, as in n8n's own polling triggers.
		const items = evenementsEnItems.call(this, watch, true);
		if (avis) items.push(avis);
		return items.length > 0 ? [items] : null;
	}
}

/* -------------------------------------------------------------------------- */
/* Watch lifecycle                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Keeps a managed watch alive.
 *
 * Renews it before it runs out — renewal adds the chosen duration to the current
 * expiry, so an early renewal loses nothing. When renewal is off, returns a
 * single item saying so: a workflow must never mistake an expired watch for a
 * quiet month.
 */
async function entretenir(
	this: IPollFunctions,
	watch: IDataObject,
	etat: EtatNode,
): Promise<INodeExecutionData | null> {
	etat.entretenuLe = Date.now();
	const expireLe = typeof watch.expire_le === 'string' ? watch.expire_le : undefined;
	etat.expireLe = expireLe ?? etat.expireLe;
	const statut = String(watch.statut ?? '');
	const echeance = expireLe ? Date.parse(expireLe) : NaN;
	const bientot =
		statut === 'expiree_renouvelable' ||
		(Number.isFinite(echeance) && echeance - Date.now() < MARGE_RENOUVELLEMENT_MS);
	if (!bientot) {
		etat.expirationSignalee = false;
		return null;
	}

	if (this.getNodeParameter('autoRenew', true) as boolean) {
		// The target list is rebuilt from the answer of Sirenic, not from the node
		// parameter: renewal is refused unless the list matches EXACTLY, and the
		// watch is the authority on what it covers.
		const liste = ciblesDeLetat(watch);
		if (liste.length > 0) {
			const requete = new URLSearchParams({ cibles: liste.join(',') });
			// Duration is re-read on EVERY renewal: changing the dropdown on a live
			// workflow re-creates nothing, but the next renewal buys the new value.
			requete.set('duree', String(dureeChoisie.call(this)));
			const corps = await appelPaye.call(
				this,
				`/v1/surveillance/${encodeURIComponent(etat.jeton ?? '')}/renouveler?${requete.toString()}`,
				'Renewing the watch',
			);
			etat.expireLe = typeof corps.expire_le === 'string' ? corps.expire_le : etat.expireLe;
			etat.expirationSignalee = false;
			return null;
		}
	}

	if (etat.expirationSignalee) return null;
	etat.expirationSignalee = true;
	const id = String(watch.surveillance_id ?? '');
	return {
		json: {
			type: 'surveillance_expiree',
			surveillance_id: id,
			statut,
			expire_le: etat.expireLe ?? null,
			message:
				statut === 'expiree_renouvelable'
					? 'This watch has expired. Sirenic keeps it renewable for seven days, then purges it. Renewal is off on this trigger, so nothing is being watched right now.'
					: 'This watch expires within seven days. Renewal is off on this trigger, so it will stop reporting.',
			_sirenic: { event_key: `lifecycle:${id}:${etat.expireLe ?? ''}`, source: 'lifecycle' },
		},
	};
}

/** Reads a watch and its 100 most recent events. Free, and the token authorises it. */
async function lireSurveillance(this: Contexte, jeton: string): Promise<IDataObject> {
	const base = await urlBase.call(this);
	return (await this.helpers.httpRequest({
		method: 'GET',
		url: `${base}/v1/surveillance/${encodeURIComponent(jeton)}`,
		json: true,
	})) as IDataObject;
}

/** Stops a watch. Free, immediate purge of its targets and events. */
async function arreterSurveillance(this: Contexte, jeton: string): Promise<void> {
	const base = await urlBase.call(this);
	await this.helpers.httpRequest({
		method: 'GET',
		url: `${base}/v1/surveillance/${encodeURIComponent(jeton)}/arreter`,
		json: true,
	});
}

/** Clears every trace of a watch this node no longer owns. */
function oublierSurveillance(etat: EtatNode): void {
	delete etat.jeton;
	delete etat.cibles;
	delete etat.expireLe;
	delete etat.expirationSignalee;
	delete etat.entretenuLe;
}

/* -------------------------------------------------------------------------- */
/* Paid calls                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Signs and settles one x402 call, then turns an API refusal into something the
 * user can act on.
 *
 * The two refusals that actually happen deserve their own words: a webhook URL
 * that is not publicly reachable, and a quote above the ceiling of the
 * credential. Both are configuration, not failure.
 */
async function appelPaye(
	this: IHookFunctions | IPollFunctions,
	chemin: string,
	quoi: string,
): Promise<IDataObject> {
	const reglages = await reglagesPaiement.call(this);
	const payer = new SirenicPayer(reglages);

	let resultat;
	try {
		resultat = await payer.call(chemin, TIMEOUT_PAIEMENT_MS, false);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`${quoi} failed: ${error instanceof Error ? error.message : String(error)}`,
			{
				description:
					'Nothing was charged. A watch is priced per target AND per duration ($0.05 for 30 days, $0.135 for 90, $0.50 for a year), so 100 targets quote between $5.00 and $50.00 — raise Max Amount Per Call on the Sirenic credential if the quote was refused, or pick a shorter Duration.',
			},
		);
	}

	if (resultat.status >= 400) {
		const corps = (resultat.body ?? {}) as Record<string, unknown>;
		const code = String(corps.error ?? '');
		const detail = String(corps.message ?? code);
		const explication =
			code === 'webhook_invalide'
				? 'Sirenic only calls a PUBLIC https URL on port 443 — never localhost, a private address, or a custom port. That is what a self-hosted n8n usually exposes, so set Delivery to Polling instead: the watch is then created with no webhook and this node reads it back for free.'
				: code === 'cibles_invalides'
					? 'Each target must be a nine-digit SIREN with a valid check digit, or "dirigeant:Name" (2 to 80 characters), 1 to 100 of them.'
					: 'Nothing was charged: Sirenic cancels the payment on any error.';
		throw new NodeApiError(this.getNode(), corps as JsonObject, {
			message: `${quoi} failed: Sirenic returned ${resultat.status}${detail ? ` (${detail})` : ''}`,
			description: explication,
			httpCode: String(resultat.status),
		});
	}
	return (resultat.body ?? {}) as IDataObject;
}

/** Wallet and spending caps, read from the credential and checked before use. */
async function reglagesPaiement(this: IHookFunctions | IPollFunctions): Promise<PaymentSettings> {
	const credentials = await this.getCredentials('sirenicApi');
	const reglages: PaymentSettings = {
		privateKey: String(credentials.privateKey ?? ''),
		baseUrl: String(credentials.baseUrl ?? BASE_URL_DEFAUT),
		payTo: String(credentials.payTo ?? ''),
		maxPerCall: Number(credentials.maxAmountPerCall ?? 0),
		maxPerExecution: Number(credentials.maxAmountPerExecution ?? 0),
	};
	if (!reglages.privateKey.startsWith('0x') || reglages.privateKey.length !== 66) {
		throw new NodeOperationError(
			this.getNode(),
			'The wallet private key must be a 0x-prefixed 32-byte hex string.',
		);
	}
	if (!(reglages.maxPerCall > 0) || !(reglages.maxPerExecution > 0)) {
		throw new NodeOperationError(
			this.getNode(),
			'Both spending caps must be greater than zero. They are what keeps a runaway workflow from draining the wallet.',
		);
	}
	return reglages;
}

/* -------------------------------------------------------------------------- */
/* Parameters and small helpers                                               */
/* -------------------------------------------------------------------------- */

function sourceSurveillance(this: Contexte): string {
	return this.getNodeParameter('watchSource', 'managed') as string;
}

/**
 * The chosen watch duration, in days.
 *
 * Defaults to 30 so a workflow saved before this option existed keeps paying
 * exactly what it paid before. A value the API does not sell would be refused
 * with 400 duree_invalide and NOTHING would be charged, but the dropdown makes
 * that unreachable from the UI.
 */
function dureeChoisie(this: Contexte): number {
	const brut = this.getNodeParameter('duree', 30);
	const jours = Number(brut);
	return DUREES_VENDUES.includes(jours) ? jours : 30;
}

/**
 * The requested target list, validated here so an obvious mistake never reaches
 * the point where money is signed.
 *
 * Deduplication mirrors the rule of the API (`type:value`, case-insensitive):
 * without it, a list built by an expression could be quoted for more targets
 * than the watch ends up holding.
 */
function ciblesDemandees(this: Contexte): Cibles {
	const brut = String(this.getNodeParameter('targets', '') ?? '').trim();
	const entrees = brut
		.split(',')
		.map((e) => e.trim())
		.filter(Boolean);
	if (entrees.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			'Targets is required: one to 100 comma-separated SIRENs, or "dirigeant:Name" entries',
		);
	}

	const vues = new Set<string>();
	const liste: string[] = [];
	for (const entree of entrees) {
		let cle: string;
		let valeur: string;
		if (/^dirigeant:/i.test(entree)) {
			const nom = entree.slice('dirigeant:'.length).trim();
			if (nom.length < 2 || nom.length > 80) {
				throw new NodeOperationError(
					this.getNode(),
					`Target "${entree}" is invalid: the name of a person must be 2 to 80 characters`,
				);
			}
			cle = `dirigeant:${nom.toLowerCase()}`;
			valeur = `dirigeant:${nom}`;
		} else if (/^\d{9}$/.test(entree)) {
			cle = `entreprise:${entree}`;
			valeur = entree;
		} else {
			throw new NodeOperationError(
				this.getNode(),
				`Target "${entree}" is invalid: expected a nine-digit SIREN or "dirigeant:Name"`,
			);
		}
		if (vues.has(cle)) continue;
		vues.add(cle);
		liste.push(valeur);
	}
	if (liste.length > MAX_CIBLES) {
		throw new NodeOperationError(
			this.getNode(),
			`A watch holds at most ${MAX_CIBLES} targets; this list has ${liste.length}`,
		);
	}
	return { liste, cles: [...vues].sort() };
}

/** Target list of a watch, in the form the create and renew routes expect. */
function ciblesDeLetat(watch: IDataObject): string[] {
	const cibles = Array.isArray(watch.cibles) ? (watch.cibles as IDataObject[]) : [];
	return cibles.map((c) =>
		String(c.type) === 'dirigeant' ? `dirigeant:${String(c.nom ?? '')}` : String(c.siren ?? ''),
	);
}

/** Same list, normalised for comparison. */
function clesDeLetat(watch: IDataObject): string[] {
	const cibles = Array.isArray(watch.cibles) ? (watch.cibles as IDataObject[]) : [];
	return cibles
		.map((c) =>
			String(c.type) === 'dirigeant'
				? `dirigeant:${String(c.nom ?? '').toLowerCase()}`
				: `entreprise:${String(c.siren ?? '')}`,
		)
		.sort();
}

function memesCibles(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((cle, i) => cle === b[i]);
}

/** HTTP status carried by an n8n request error, whatever shape it arrived in. */
function statutDe(error: unknown): number | undefined {
	const e = (error ?? {}) as Record<string, unknown>;
	const brut =
		e.httpCode ??
		e.statusCode ??
		((e.response as Record<string, unknown> | undefined)?.status as unknown) ??
		((e.cause as Record<string, unknown> | undefined)?.statusCode as unknown);
	const statut = Number(brut);
	return Number.isFinite(statut) && statut > 0 ? statut : undefined;
}

/** Base URL without its trailing slash. */
async function urlBase(this: Contexte): Promise<string> {
	// A managed watch is paid for through the credential, so the credential is
	// also where its address comes from: a node parameter pointing elsewhere
	// would read one server and pay another.
	if (sourceSurveillance.call(this) === 'managed') {
		const credentials = await this.getCredentials('sirenicApi');
		const brut = String(credentials.baseUrl ?? BASE_URL_DEFAUT).trim();
		return (brut || BASE_URL_DEFAUT).replace(/\/+$/, '');
	}
	const brut = String(this.getNodeParameter('baseUrl', BASE_URL_DEFAUT) ?? '').trim();
	return (brut || BASE_URL_DEFAUT).replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

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

/**
 * The published signing key, cached in the node static data.
 *
 * Fetched rather than hard-coded so a key rotation does not silently turn every
 * delivery into a forgery; cached so a busy webhook does not refetch per call.
 */
async function cleDeSignature(this: IWebhookFunctions, forcer: boolean): Promise<CleDeSignature> {
	const etat = this.getWorkflowStaticData('node') as EtatNode;
	const age = Date.now() - (etat.cleSignatureLueLe ?? 0);
	if (!forcer && etat.cleSignature && age < 24 * 60 * 60 * 1000) {
		return etat.cleSignature;
	}
	const url = `${await urlBase.call(this)}/.well-known/sirenic-signing-key`;
	const reponse = (await this.helpers.httpRequest({
		method: 'GET',
		url,
		json: true,
	})) as IDataObject;
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
