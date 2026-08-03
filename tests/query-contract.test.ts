/**
 * Query-string contract with the Sirenic API.
 *
 * Every bug found in the 2026-08-03 audit was the same one: an operation built a
 * URL the API refuses — a required query parameter missing (`depuis`), named
 * something the API never reads (`q` instead of `nom`/`siren`), or invented
 * outright (`tranche_effectif`, which the API IGNORES, so the call is paid and
 * comes back unfiltered but plausible). Nothing tested the contract, so nothing
 * caught them.
 *
 * These tests pin the contract, parameter by parameter. They are deliberately
 * literal: the expected strings are copied from the API's own validation, so
 * updating one means going and reading the API again.
 */
import { describe, expect, it } from 'vitest';
import { RESOURCES, findOperation } from '../nodes/Sirenic/operations';

/** Builds the path of an operation from a map of user-entered values. */
function build(resource: string, operation: string, values: Record<string, string> = {}) {
	const op = findOperation(resource, operation);
	if (!op) throw new Error(`unknown operation ${resource}.${operation}`);
	return op.path((name) => values[name] ?? '');
}

describe('query contract — parameters the API requires', () => {
	it('getChanges sends depuis (the API answers 400 date_invalide without it)', () => {
		expect(build('frenchCompany', 'getChanges', { siren: '552032534', since: '2026-01-01' })).toBe(
			'/v1/entreprise/552032534/changements?depuis=2026-01-01',
		);
	});

	it('getChanges refuses to spend anything when the date is missing or malformed', () => {
		expect(() => build('frenchCompany', 'getChanges', { siren: '552032534' })).toThrow(/Since/);
		expect(() =>
			build('frenchCompany', 'getChanges', { siren: '552032534', since: '01/01/2026' }),
		).toThrow(/YYYY-MM-DD/);
	});

	it('getRegulatorAlerts sends nom and/or siren, never q', () => {
		expect(build('compliance', 'getRegulatorAlerts', { regulatorName: 'ACME' })).toBe(
			'/v1/regulateurs/fr/alertes?nom=ACME',
		);
		expect(build('compliance', 'getRegulatorAlerts', { regulatorSiren: '552032534' })).toBe(
			'/v1/regulateurs/fr/alertes?siren=552032534',
		);
		const both = build('compliance', 'getRegulatorAlerts', {
			regulatorName: 'ACME',
			regulatorSiren: '552032534',
		});
		expect(both).toContain('nom=ACME');
		expect(both).toContain('siren=552032534');
		expect(both).not.toContain('q=');
	});

	it('getRegulatorAlerts refuses an empty screening (the API requires one of the two)', () => {
		expect(() => build('compliance', 'getRegulatorAlerts')).toThrow(/Name to Screen/);
	});

	it('renew sends the target list again (it is priced per target)', () => {
		expect(
			build('monitoring', 'renew', { watchToken: 'sw_abc', targets: '552032534,542065479' }),
		).toBe('/v1/surveillance/sw_abc/renouveler?cibles=552032534%2C542065479');
		expect(() => build('monitoring', 'renew', { watchToken: 'sw_abc' })).toThrow(/Targets/);
	});

	it('prospect uses effectif_min/effectif_max — a headcount filter must never be dropped in silence', () => {
		const path = build('people', 'prospect', {
			nafCode: '62.01Z',
			workforceMin: '10',
			workforceMax: '250',
		});
		expect(path).toContain('effectif_min=10');
		expect(path).toContain('effectif_max=250');
		expect(path).not.toContain('tranche_effectif');
	});

	it('the European search passes pays through, and omits it when no country is chosen', () => {
		expect(build('europeanCompany', 'search', { query: 'Nestle', searchCountry: 'CH' })).toBe(
			'/v1/eu/recherche?q=Nestle&pays=CH',
		);
		expect(build('europeanCompany', 'search', { query: 'Nestle' })).toBe(
			'/v1/eu/recherche?q=Nestle',
		);
	});

	it('the European invoicing pack only offers the two countries the API serves', () => {
		const op = findOperation('invoicing', 'getEuPack');
		const country = op?.fields?.find((f) => f.name === 'country');
		expect(country?.options?.map((o) => o.value)).toEqual(['BE', 'PL']);
	});

	it('VAT numbers and IBANs are normalised before they reach the path', () => {
		// The API validates the raw path segment: spaces would arrive as %20.
		expect(build('invoicing', 'verifyVat', { vatNumber: 'FR 27 552032534' })).toBe(
			'/v1/tva/verifier/FR27552032534',
		);
		expect(
			build('invoicing', 'verifyIban', { iban: 'FR76 3000 6000 0112 3456 7890 189' }),
		).toBe('/v1/iban/verifier/FR7630006000011234567890189');
	});

	it('the disabled /comptes-pdf route is no longer offered', () => {
		expect(findOperation('financials', 'getAccountsPdf')).toBeFalsy();
	});
});

describe('slow routes: the client must not give up before the API settles', () => {
	// The window is no longer duplicated in this catalogue: it is read from the
	// quote the API sends (x402.ts), which is the only authority on it. What
	// matters here is that no operation re-declares one behind its back.
	it('no operation carries a hand-maintained timeout any more', () => {
		for (const r of RESOURCES) {
			for (const op of r.operations) {
				expect(op, `${r.value}.${op.value}`).not.toHaveProperty('timeoutMs');
			}
		}
	});

	it('routes whose 404 means "no data" are marked as such', () => {
		expect(findOperation('europeanCompany', 'getInsiderTransactions')?.notFoundIsEmpty).toBe(true);
		expect(findOperation('europeanCompany', 'get')?.notFoundIsEmpty).toBe(true);
		expect(findOperation('frenchCompany', 'downloadDocument')?.notFoundIsEmpty).toBe(true);
		// A paid data route must NOT swallow a 404.
		expect(findOperation('dueDiligence', 'getKyb')?.notFoundIsEmpty).toBeUndefined();
	});

	it('insider transactions refuse any country but Belgium instead of paying for a 404', () => {
		expect(() =>
			build('europeanCompany', 'getInsiderTransactions', { country: 'FR', companyId: '552032534' }),
		).toThrow(/Belgium only/);
		expect(
			build('europeanCompany', 'getInsiderTransactions', { country: 'BE', companyId: '0428750985' }),
		).toBe('/v1/eu/entreprise/BE/0428750985/transactions-dirigeants');
	});

	it('a watch with no delivery channel is refused before it is paid for', () => {
		expect(() => build('monitoring', 'watch', { targets: '552032534' })).toThrow(/Webhook URL or an Email/);
		expect(build('monitoring', 'watch', { targets: '552032534', email: 'a@b.c' })).toContain(
			'email=a%40b.c',
		);
	});

	it('the free read-back routes exist, so a watch is never unreachable', () => {
		expect(build('monitoring', 'getWatch', { watchToken: 'sw_abc' })).toBe('/v1/surveillance/sw_abc');
		expect(build('monitoring', 'stopWatch', { watchToken: 'sw_abc' })).toBe(
			'/v1/surveillance/sw_abc/arreter',
		);
	});

	it('every field an operation READS is also declared by that operation', () => {
		// The bug this catches: a field declared on the wrong resource is never
		// generated, so the value is always empty and the parameter never sent —
		// silently, with a green build.
		for (const r of RESOURCES) {
			for (const op of r.operations) {
				const lus = new Set<string>();
				try {
					op.path((name) => {
						lus.add(name);
						return { since: '2026-01-01', targets: '1', country: 'BE', webhook: 'https://x.tld/h' }[name] ?? 'v';
					});
				} catch {
					// A builder may refuse on purpose; the names it read still count.
				}
				const declares = new Set((op.fields ?? []).map((f) => f.name));
				for (const nom of lus) {
					expect(declares.has(nom), `${r.value}.${op.value} reads "${nom}" without declaring it`).toBe(true);
				}
			}
		}
	});
});
