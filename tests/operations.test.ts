/**
 * The catalogue (operations.ts) is the ONLY source of truth for the interface
 * and the routing. These tests lock down the invariants the n8n linter forced
 * us to duplicate by hand, plus the overall consistency of the catalogue —
 * a drift would otherwise only show up in production, once the customer has
 * been charged.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATION, Sirenic } from '../nodes/Sirenic/Sirenic.node';
import { RESOURCES, findOperation } from '../nodes/Sirenic/operations';

describe('operation catalogue', () => {
	// ⚠️ THE test that matters, added in 0.8.0 after a real miss: in 0.7.0
	// DEFAULT_OPERATION was changed in the belief that it changed the dropdown
	// default, when NOTHING reads that table — the published package still opened
	// on the PAID operation, contrary to its changelog. This test reads the
	// `default:` literals of the dropdowns ACTUALLY served to n8n.
	it('every dropdown default is the first operation of its resource', () => {
		const properties = new Sirenic().description.properties as Array<{
			name: string;
			default?: unknown;
			displayOptions?: { show?: { resource?: string[] } };
		}>;
		const dropdowns = properties.filter(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.length === 1,
		);
		// A resource without a dropdown would slip through: coverage is required.
		expect(dropdowns.length).toBe(RESOURCES.length);
		for (const dropdown of dropdowns) {
			const resource = dropdown.displayOptions!.show!.resource![0] as string;
			const first = RESOURCES.find((r) => r.value === resource)?.operations[0]?.value;
			expect(dropdown.default, `dropdown of ${resource}`).toBe(first);
			// And the documentation table must say the same thing as the dropdown.
			expect(DEFAULT_OPERATION[resource], `DEFAULT_OPERATION.${resource}`).toBe(first);
		}
	});

	it('DEFAULT_OPERATION = first operation of each resource (duplication required by the linter, locked here)', () => {
		expect(Object.keys(DEFAULT_OPERATION).sort()).toEqual(RESOURCES.map((r) => r.value).sort());
		for (const r of RESOURCES) {
			expect(DEFAULT_OPERATION[r.value], `resource ${r.value}`).toBe(r.operations[0]?.value);
		}
	});

	it('resource.operation pairs are unique and routable', () => {
		const seen = new Set<string>();
		for (const r of RESOURCES) {
			for (const op of r.operations) {
				const key = `${r.value}.${op.value}`;
				expect(seen.has(key), `duplicate ${key}`).toBe(false);
				seen.add(key);
				expect(findOperation(r.value, op.value), key).toBeDefined();
			}
		}
		// 41 = 38 paid operations + 1 FREE (frenchCompany:suggest, the name
		// autocomplete added in 0.7.0 — the only operation that costs nothing)
		// + 1 modular (dueDiligence:getFile, the pick-your-blocks company file of
		// 0.8.0, whose price depends on the blocks asked for)
		// + 1 criteria search (dueDiligence:searchBodacc, 0.10.0 — the BODACC gazette
		// searched by family/date/department instead of by company).
		// The 38 paid ones = 40 paid BASE routes (50 in the production price list
		// as of 2026-07-29, minus the 9 dedicated per-country routes that go
		// through the generic EU profile, minus /comptes-pdf which production
		// disabled on 2026-07-29) minus the 2 paid surveillance routes, which
		// moved to the Sirenic Trigger: a subscription belongs to the node that
		// owns its lifecycle, not to a catalogue of one-shot lookups.
		expect(seen.size).toBe(41);
	});

	it('every generated path starts with /v1/ and escapes its parameters', () => {
		// Booby-trapped parameters: if a builder forgets enc(), the slash and the
		// ampersand get through and break (or hijack) the route.
		// Fields whose builder checks the FORMAT get a plausible value; every other
		// field keeps the booby-trapped one, which is what this test is about.
		const plausible: Record<string, string> = {
			query: 'a&b/c',
			siren: '552032534',
			since: '2026-01-01',
			regulatorName: 'a&b/c',
			iban: 'FR7630006000011234567890189',
			// Builders that refuse an unserved value need a served one here: their
			// own guards are covered in query-contract.test.ts.
			country: 'BE',
		};
		const trap = (name: string) => plausible[name] ?? 'x&y/z';
		for (const r of RESOURCES) {
			for (const op of r.operations) {
				const path = op.path(trap);
				expect(path, `${r.value}.${op.value}`).toMatch(/^\/v1\//);
				// No raw parameter: the injected / and & must be encoded (the path
				// can only contain the ones from the template).
				const afterTemplate = path.replace(/^\/v1\//, '');
				expect(afterTemplate, `${r.value}.${op.value} lets a&b/c through raw`).not.toContain(
					'a&b/c',
				);
			}
		}
	});

	it('an unknown operation routes nothing', () => {
		expect(findOperation('frenchCompany', 'doesNotExist')).toBeFalsy();
		expect(findOperation('doesNotExist', 'search')).toBeFalsy();
	});

	it('every operation has a name, an action and a description (n8n Store requirements)', () => {
		for (const r of RESOURCES) {
			expect(r.name.length, r.value).toBeGreaterThan(0);
			for (const op of r.operations) {
				expect(op.name.length, op.value).toBeGreaterThan(0);
				expect(op.action.length, op.value).toBeGreaterThan(0);
				expect(op.description.length, op.value).toBeGreaterThan(0);
			}
		}
	});
});
