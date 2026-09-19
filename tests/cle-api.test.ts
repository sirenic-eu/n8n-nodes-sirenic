/**
 * Le rail « clé d'API », vérifié sans réseau et sans dépense.
 *
 * Ce qui compte ici n'est pas qu'un appel « marche » : c'est que la clé parte
 * où il faut, que la dépense se compte sur ce que l'API DIT avoir débité, et
 * que le plafond morde AVANT l'appel qui le franchirait — après, c'est déjà
 * débité et le garde-fou ne garde plus rien.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SirenicKeyCaller } from '../nodes/Sirenic/cle-api';

const CLE = 'srn_live_jamais_valide_de_test';
const BASE = 'https://api.example.test';

/** Une réponse JSON, avec les en-têtes que l'API pose réellement. */
function reponse(corps: unknown, entetes: Record<string, string> = {}, status = 200) {
	return new Response(JSON.stringify(corps), {
		status,
		headers: { 'content-type': 'application/json', ...entetes },
	});
}

function appelant(plafond = 5) {
	return new SirenicKeyCaller({ apiKey: CLE, baseUrl: BASE, maxSpendPerExecution: plafond });
}

afterEach(() => vi.unstubAllGlobals());

describe('rail clé d’API', () => {
	it('envoie la clé en en-tête, et seulement là', async () => {
		const appels: Array<{ url: string; entetes: Headers }> = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			appels.push({ url, entetes: new Headers(init.headers) });
			return reponse({ siren: '552032534' });
		});

		await appelant().call('/v1/entreprise/552032534', 30_000, false);

		expect(appels).toHaveLength(1);
		expect(appels[0]!.entetes.get('X-Api-Key')).toBe(CLE);
		// Jamais dans l'URL : une clé en query se retrouve dans les journaux.
		expect(appels[0]!.url).not.toContain('srn_');
	});

	it('compte ce que l’API DIT avoir débité, jamais un prix recopié', async () => {
		vi.stubGlobal('fetch', async () => reponse({ ok: true }, { 'x-credits-charged': '0.105' }));
		const a = appelant();

		const r = await a.call('/v1/kyb/batch?sirens=1,2,3', 30_000, false);

		// Une route à lot coûte son prix unitaire MULTIPLIÉ par le nombre
		// d'entités : seul l'en-tête connaît le vrai montant.
		expect(r.paid).toBe(0.105);
		expect(a.totalPaid).toBe(0.105);
	});

	it('ne compte rien quand l’appel est servi par le quota gratuit', async () => {
		vi.stubGlobal('fetch', async () =>
			reponse({ ok: true }, { 'x-credits-charged': '0', 'x-free-quota-remaining': '149' }),
		);
		const a = appelant();

		const r = await a.call('/v1/recherche?q=danone', 30_000, false);

		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
		// Ce qui reste du quota est remonté au workflow : c'est une information
		// que l'utilisateur ne peut obtenir nulle part ailleurs dans son flux.
		expect((r.body as { free_quota_remaining?: number }).free_quota_remaining).toBe(149);
	});

	it('refuse AVANT l’appel qui franchirait le plafond', async () => {
		const fetchStub = vi.fn(async () => reponse({ ok: true }, { 'x-credits-charged': '0.4' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(1);

		await a.call('/v1/kyb/1', 30_000, false);
		await a.call('/v1/kyb/2', 30_000, false);
		expect(a.totalPaid).toBe(0.8);

		// 0,8 dépensé sur 1,0 : le troisième appel PASSE (le plafond n'est pas
		// encore atteint), le quatrième est refusé sans être émis.
		await a.call('/v1/kyb/3', 30_000, false);
		expect(fetchStub).toHaveBeenCalledTimes(3);
		await expect(a.call('/v1/kyb/4', 30_000, false)).rejects.toThrow(/ceiling reached/i);
		expect(fetchStub).toHaveBeenCalledTimes(3);
	});

	it('un plafond à zéro ne borne rien, et c’est un choix explicite', async () => {
		const fetchStub = vi.fn(async () => reponse({ ok: true }, { 'x-credits-charged': '9' }));
		vi.stubGlobal('fetch', fetchStub);
		const a = appelant(0);

		await a.call('/v1/intelligence/1', 30_000, false);
		await a.call('/v1/intelligence/2', 30_000, false);

		expect(fetchStub).toHaveBeenCalledTimes(2);
		expect(a.totalPaid).toBe(18);
	});

	it('l’essai à blanc n’envoie PAS la clé et ne débite rien', async () => {
		const appels: Array<Headers> = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			appels.push(new Headers(init.headers));
			return new Response('', { status: 402, headers: { 'payment-required': 'eyJ4NDAy' } });
		});
		const a = appelant();

		const r = await a.call('/v1/rapport/552032534', 30_000, true);

		expect(appels[0]!.get('X-Api-Key')).toBeNull();
		expect(r.dryRun).toBe(true);
		expect(r.status).toBe(402);
		expect(a.totalPaid).toBe(0);
	});

	it('rend les octets d’un PDF sans les décoder', async () => {
		const pdf = Buffer.from('%PDF-1.4 essai');
		vi.stubGlobal('fetch', async () =>
			new Response(pdf, {
				status: 200,
				headers: { 'content-type': 'application/pdf', 'x-credits-charged': '0.5' },
			}),
		);

		const r = await appelant().call('/v1/rapport/552032534', 30_000, false);

		expect(r.binary?.contentType).toBe('application/pdf');
		expect(r.binary?.data.subarray(0, 5).toString()).toBe('%PDF-');
		expect(r.paid).toBe(0.5);
	});

	it('une erreur n’est jamais comptée comme une dépense', async () => {
		vi.stubGlobal('fetch', async () => reponse({ error: 'siren_invalide' }, {}, 400));
		const a = appelant();

		const r = await a.call('/v1/entreprise/000000000', 30_000, false);

		expect(r.status).toBe(400);
		expect(r.paid).toBe(0);
		expect(a.totalPaid).toBe(0);
	});
});
