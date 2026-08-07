/**
 * The watch lifecycle moved into the trigger, and it spends real money: $0.05
 * per target for 30 days, up to $5.00. These tests pin the rules that protect
 * the wallet, because every one of them is a silent, expensive failure if it
 * ever breaks.
 *
 *  1. "Listen for test event" NEVER pays — n8n runs the same hooks for a
 *     throwaway URL.
 *  2. Re-activating an unchanged watch pays NOTHING: checkExists re-uses it.
 *  3. An API that cannot be reached FAILS the activation instead of assuming
 *     the watch is gone and buying a second one.
 *  4. Deactivating keeps the prepaid watch unless the user asked to stop it.
 *
 * The network is stubbed throughout: no wallet, no HTTP, no payment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IHookFunctions } from 'n8n-workflow';
import { NETWORK, USDC } from '../nodes/Sirenic/x402';
import { SirenicTrigger } from '../nodes/SirenicTrigger/SirenicTrigger.node';

const PAY_TO = '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2';
// Test-only key, never used anywhere else.
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets -- unfunded test vector, and tests are not published (package.json `files` ships dist only)
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BASE = 'https://api.example.test';
const URL_WEBHOOK = 'https://n8n.example.test/webhook/6f2a/webhook';
const CIBLES = '552032534,542065479';

const hooks = new SirenicTrigger().webhookMethods.default;

afterEach(() => vi.unstubAllGlobals());

/** The single field of `helpers.httpRequest` these tests assert on. */
interface RequeteHttp {
	url: string;
}

interface Options {
	params?: Record<string, unknown>;
	statique?: Record<string, unknown>;
	mode?: string;
	activation?: string;
	httpRequest?: (requete: RequeteHttp) => Promise<unknown>;
}

/** A hook context with everything the node reads, and nothing it does not. */
function contexte(o: Options = {}) {
	const params: Record<string, unknown> = {
		watchSource: 'managed',
		targets: CIBLES,
		mode: 'webhook',
		autoRenew: true,
		stopOnDeactivate: false,
		...o.params,
	};
	const statique: Record<string, unknown> = { ...o.statique };
	const httpRequest = vi.fn<(requete: RequeteHttp) => Promise<unknown>>(
		o.httpRequest ?? (async () => ({})),
	);
	const ctx = {
		getNodeParameter: (nom: string, defaut?: unknown) => (nom in params ? params[nom] : defaut),
		getWorkflowStaticData: () => statique,
		getNode: () => ({
			name: 'Sirenic Trigger',
			type: 'n8n-nodes-sirenic.sirenicTrigger',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getMode: () => o.mode ?? 'trigger',
		getActivationMode: () => o.activation ?? 'activate',
		getNodeWebhookUrl: () => URL_WEBHOOK,
		getCredentials: async () => ({
			privateKey: KEY,
			baseUrl: BASE,
			payTo: PAY_TO,
			maxAmountPerCall: 2,
			maxAmountPerExecution: 10,
		}),
		helpers: { httpRequest },
	};
	return { ctx: ctx as unknown as IHookFunctions, statique, httpRequest };
}

/** A signable x402 v2 quote, as the API sends it in the PAYMENT-REQUIRED header. */
function quote(amount: string, ressource: string) {
	return Buffer.from(
		JSON.stringify({
			x402Version: 2,
			resource: ressource,
			accepts: [
				{
					scheme: 'exact',
					network: NETWORK,
					asset: USDC,
					payTo: PAY_TO,
					amount,
					maxTimeoutSeconds: 120,
					extra: { name: 'USD Coin', version: '2' },
				},
			],
		}),
	).toString('base64');
}

/** Stubs the paid round trip: 402 with a quote, then the settled answer. */
function reseauPayant(corps: Record<string, unknown>, amount = '100000') {
	const urls: string[] = [];
	const appel = vi.fn(async (url: string | URL) => {
		urls.push(String(url));
		if (urls.length === 1) {
			return new Response('{}', {
				status: 402,
				headers: {
					'content-type': 'application/json',
					'payment-required': quote(amount, String(url)),
				},
			});
		}
		return new Response(JSON.stringify(corps), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
	vi.stubGlobal('fetch', appel);
	return { urls, appel };
}

/** What the free read route answers for a live watch on those two SIRENs. */
function watchVivante(expireLe = '2026-09-05T08:00:00.000Z') {
	return {
		surveillance_id: 'sw_3f2b1c8e-7d40-4a91-9c02-b6e5f1a83d77',
		statut: 'active',
		expire_le: expireLe,
		cibles: [
			{ type: 'entreprise', siren: '552032534', nom: null },
			{ type: 'entreprise', siren: '542065479', nom: null },
		],
		evenements: [],
	};
}

describe('creating the watch', () => {
	it('refuses to pay for a test listen — n8n uses a throwaway URL for those', async () => {
		const appel = vi.fn();
		vi.stubGlobal('fetch', appel);
		const { ctx } = contexte({ mode: 'manual', activation: 'manual' });

		await expect(hooks.create.call(ctx)).rejects.toThrow(/PAID watch/);
		// The point of the test: not one byte left the instance.
		expect(appel).not.toHaveBeenCalled();
	});

	it('lets a test listen through once the watch is already paid for', async () => {
		const appel = vi.fn();
		vi.stubGlobal('fetch', appel);
		const { ctx } = contexte({
			mode: 'manual',
			activation: 'manual',
			statique: { jeton: 'sw_deja', cibles: ['entreprise:542065479', 'entreprise:552032534'] },
		});

		await expect(hooks.create.call(ctx)).resolves.toBe(true);
		expect(appel).not.toHaveBeenCalled();
	});

	it('points the watch at the production webhook URL and remembers the token', async () => {
		const { urls } = reseauPayant({
			surveillance_id: 'sw_neuve',
			expire_le: '2026-09-05T08:00:00.000Z',
		});
		const { ctx, statique } = contexte();

		await expect(hooks.create.call(ctx)).resolves.toBe(true);
		expect(urls[0]).toContain('/v1/surveillance/creer?cibles=552032534%2C542065479');
		expect(urls[0]).toContain(`webhook=${encodeURIComponent(URL_WEBHOOK)}`);
		expect(statique.jeton).toBe('sw_neuve');
		expect(statique.cibles).toEqual(['entreprise:542065479', 'entreprise:552032534']);
		expect(statique.expireLe).toBe('2026-09-05T08:00:00.000Z');
	});

	it('creates a channel-less watch in polling delivery, so a firewalled n8n still works', async () => {
		const { urls } = reseauPayant({ surveillance_id: 'sw_poll' });
		const { ctx } = contexte({ params: { mode: 'poll' } });

		await hooks.create.call(ctx);
		expect(urls[0]).toContain('/v1/surveillance/creer?cibles=');
		expect(urls[0]).not.toContain('webhook=');
	});

	it('refuses an impossible target list before anything is signed', async () => {
		const appel = vi.fn();
		vi.stubGlobal('fetch', appel);
		const { ctx } = contexte({ params: { targets: '552032534,not-a-siren' } });

		await expect(hooks.create.call(ctx)).rejects.toThrow(/nine-digit SIREN/);
		expect(appel).not.toHaveBeenCalled();
	});

	it('stops the previous watch before paying for one with different targets', async () => {
		const { urls } = reseauPayant({ surveillance_id: 'sw_neuve' });
		const { ctx, httpRequest } = contexte({
			statique: { jeton: 'sw_ancienne', cibles: ['entreprise:552032534'] },
		});

		await hooks.create.call(ctx);
		expect(String(httpRequest.mock.calls[0]?.[0]?.url)).toContain('/v1/surveillance/sw_ancienne/arreter');
		expect(urls[0]).toContain('/v1/surveillance/creer?');
	});
});

describe('re-activating', () => {
	it('re-uses a live watch instead of buying a second one', async () => {
		const appel = vi.fn();
		vi.stubGlobal('fetch', appel);
		const { ctx, httpRequest } = contexte({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:542065479', 'entreprise:552032534'] },
			httpRequest: async () => watchVivante(),
		});

		await expect(hooks.checkExists.call(ctx)).resolves.toBe(true);
		expect(String(httpRequest.mock.calls[0]?.[0]?.url)).toContain('/v1/surveillance/sw_vivante');
		// create() is never reached, so nothing is ever signed.
		expect(appel).not.toHaveBeenCalled();
	});

	it('stops the activation when Sirenic cannot be reached, rather than pay twice', async () => {
		const { ctx } = contexte({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:542065479', 'entreprise:552032534'] },
			httpRequest: async () => {
				throw Object.assign(new Error('ECONNREFUSED'), { statusCode: 503 });
			},
		});

		await expect(hooks.checkExists.call(ctx)).rejects.toThrow(/Could not reach Sirenic/);
	});

	it('forgets a watch Sirenic no longer knows, so a new one is created', async () => {
		const { ctx, statique } = contexte({
			statique: { jeton: 'sw_purgee', cibles: ['entreprise:552032534'] },
			httpRequest: async () => {
				throw Object.assign(new Error('not found'), { statusCode: 404 });
			},
		});

		await expect(hooks.checkExists.call(ctx)).resolves.toBe(false);
		expect(statique.jeton).toBeUndefined();
	});

	it('asks for a new watch when the target list changed', async () => {
		const { ctx } = contexte({
			params: { targets: '552032534' },
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:552032534'] },
			httpRequest: async () => watchVivante(),
		});

		await expect(hooks.checkExists.call(ctx)).resolves.toBe(false);
	});
});

describe('deactivating', () => {
	it('keeps the watch by default — it is prepaid for 30 days', async () => {
		const { ctx, statique, httpRequest } = contexte({
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:552032534'] },
		});

		await expect(hooks.delete.call(ctx)).resolves.toBe(true);
		expect(httpRequest).not.toHaveBeenCalled();
		expect(statique.jeton).toBe('sw_vivante');
	});

	it('stops and forgets it when the user asked for that', async () => {
		const { ctx, statique, httpRequest } = contexte({
			params: { stopOnDeactivate: true },
			statique: { jeton: 'sw_vivante', cibles: ['entreprise:552032534'] },
		});

		await expect(hooks.delete.call(ctx)).resolves.toBe(true);
		expect(String(httpRequest.mock.calls[0]?.[0]?.url)).toContain('/v1/surveillance/sw_vivante/arreter');
		expect(statique.jeton).toBeUndefined();
	});
});

describe('a watch created elsewhere', () => {
	it('is never created, renewed or stopped by this node', async () => {
		const appel = vi.fn();
		vi.stubGlobal('fetch', appel);
		const { ctx, httpRequest } = contexte({
			params: { watchSource: 'existing', watchToken: 'sw_ailleurs' },
			statique: {},
		});

		await expect(hooks.checkExists.call(ctx)).resolves.toBe(true);
		await expect(hooks.create.call(ctx)).resolves.toBe(true);
		await expect(hooks.delete.call(ctx)).resolves.toBe(true);
		expect(appel).not.toHaveBeenCalled();
		expect(httpRequest).not.toHaveBeenCalled();
	});
});
