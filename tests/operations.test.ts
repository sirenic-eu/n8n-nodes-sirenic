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
	// ⚠️ LE test qui compte, ajouté en 0.8.0 après un raté réel : en 0.7.0 j'avais
	// changé DEFAULT_OPERATION en croyant changer le défaut du menu, alors que
	// RIEN ne lit cette table — le paquet publié ouvrait toujours sur l'opération
	// PAYANTE, contrairement à son changelog. Ce test lit les littéraux
	// `default:` des menus déroulants RÉELLEMENT servis à n8n.
	it("le défaut de CHAQUE menu déroulant est la première opération de sa ressource", () => {
		const proprietes = new Sirenic().description.properties as Array<{
			name: string;
			default?: unknown;
			displayOptions?: { show?: { resource?: string[] } };
		}>;
		const menus = proprietes.filter(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.length === 1,
		);
		// Une ressource sans menu passerait inaperçue : on exige la couverture.
		expect(menus.length).toBe(RESOURCES.length);
		for (const menu of menus) {
			const ressource = menu.displayOptions!.show!.resource![0] as string;
			const premiere = RESOURCES.find((r) => r.value === ressource)?.operations[0]?.value;
			expect(menu.default, `menu de ${ressource}`).toBe(premiere);
			// Et la table de documentation doit dire la même chose que le menu.
			expect(DEFAULT_OPERATION[ressource], `DEFAULT_OPERATION.${ressource}`).toBe(premiere);
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
		// 40 = 38 paid operations + 1 FREE (frenchCompany:suggest, the name
		// autocomplete added in 0.7.0 — the only operation that costs nothing)
		// + 1 modular (dueDiligence:getFile, the à-la-carte company file of 0.8.0,
		// whose price depends on the blocks asked for).
		// The 38 paid ones = 40 paid BASE routes (50 in the production price list
		// as of 2026-07-29, minus the 9 dedicated per-country routes that go
		// through the generic EU profile, minus /comptes-pdf which production
		// disabled on 2026-07-29) minus the 2 paid surveillance routes, which
		// moved to the Sirenic Trigger: a subscription belongs to the node that
		// owns its lifecycle, not to a catalogue of one-shot lookups.
		expect(seen.size).toBe(40);
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
