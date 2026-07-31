/**
 * The catalogue (operations.ts) is the ONLY source of truth for the interface
 * and the routing. These tests lock down the invariants the n8n linter forced
 * us to duplicate by hand, plus the overall consistency of the catalogue —
 * a drift would otherwise only show up in production, once the customer has
 * been charged.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATION } from '../nodes/Sirenic/Sirenic.node';
import { RESOURCES, findOperation } from '../nodes/Sirenic/operations';

describe('operation catalogue', () => {
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
		// 41 = the paid BASE routes of the production price list (50 as of
		// 2026-07-29, minus the 9 dedicated per-country routes that go through
		// the generic EU profile).
		expect(seen.size).toBe(41);
	});

	it('every generated path starts with /v1/ and escapes its parameters', () => {
		// Booby-trapped parameters: if a builder forgets enc(), the slash and the
		// ampersand get through and break (or hijack) the route.
		const trap = (name: string) => ({ query: 'a&b/c', siren: '552032534' })[name] ?? 'x&y/z';
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
