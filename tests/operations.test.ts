/**
 * Le catalogue (operations.ts) est la SEULE source de vérité de l'interface et
 * du routage. Ces tests verrouillent les invariants que le linter n8n nous a
 * forcés à dupliquer à la main, et la cohérence générale du catalogue —
 * un écart ne se verrait sinon qu'en production, une fois le client débité.
 */
import { describe, expect, it } from 'vitest';
import { OPERATION_PAR_DEFAUT } from '../nodes/Sirenic/Sirenic.node';
import { RESSOURCES, trouverOperation } from '../nodes/Sirenic/operations';

describe('catalogue des opérations', () => {
	it('OPERATION_PAR_DEFAUT = première opération de chaque ressource (doublon exigé par le linter, verrouillé ici)', () => {
		expect(Object.keys(OPERATION_PAR_DEFAUT).sort()).toEqual(RESSOURCES.map((r) => r.valeur).sort());
		for (const r of RESSOURCES) {
			expect(OPERATION_PAR_DEFAUT[r.valeur], `ressource ${r.valeur}`).toBe(r.operations[0]?.valeur);
		}
	});

	it('les couples ressource.opération sont uniques et routables', () => {
		const vus = new Set<string>();
		for (const r of RESSOURCES) {
			for (const op of r.operations) {
				const cle = `${r.valeur}.${op.valeur}`;
				expect(vus.has(cle), `doublon ${cle}`).toBe(false);
				vus.add(cle);
				expect(trouverOperation(r.valeur, op.valeur), cle).toBeDefined();
			}
		}
		// 41 = les routes payantes de BASE de la grille prod (50 au 29/07, moins
		// les 9 fiches dédiées par pays qui passent par le profil EU générique).
		expect(vus.size).toBe(41);
	});

	it('chaque chemin généré commence par /v1/ et échappe ses paramètres', () => {
		// Paramètres pièges : si un constructeur oublie enc(), le slash et
		// l'esperluette traversent et cassent (ou détournent) la route.
		const piege = (nom: string) => ({ query: 'a&b/c', siren: '552032534' })[nom] ?? 'x&y/z';
		for (const r of RESSOURCES) {
			for (const op of r.operations) {
				const chemin = op.chemin(piege);
				expect(chemin, `${r.valeur}.${op.valeur}`).toMatch(/^\/v1\//);
				// Aucun paramètre brut : les / et & injectés doivent être encodés
				// (le chemin ne peut contenir que ceux du gabarit).
				const apresGabarit = chemin.replace(/^\/v1\//, '');
				expect(apresGabarit, `${r.valeur}.${op.valeur} laisse passer a&b/c brut`).not.toContain('a&b/c');
			}
		}
	});

	it('une opération inconnue ne route rien', () => {
		expect(trouverOperation('frenchCompany', 'inexistante')).toBeFalsy();
		expect(trouverOperation('inexistante', 'search')).toBeFalsy();
	});

	it('chaque opération a un nom, une action et une description (exigences du Store n8n)', () => {
		for (const r of RESSOURCES) {
			expect(r.nom.length, r.valeur).toBeGreaterThan(0);
			for (const op of r.operations) {
				expect(op.nom.length, op.valeur).toBeGreaterThan(0);
				expect(op.action.length, op.valeur).toBeGreaterThan(0);
				expect(op.description.length, op.valeur).toBeGreaterThan(0);
			}
		}
	});
});
