/**
 * Gap between what the node CALLS and what the price grid SELLS.
 *
 * The node had drifted: on 2026-09-19 it still called
 * `/v1/entreprise/{siren}/liens-capitalistiques`, removed from the grid (404
 * measured), and eight routes on sale had no operation. This script reads
 * both surfaces instead of assuming them.
 *
 *   node ecart-grille.mjs
 */
import { readFileSync } from 'node:fs';

/**
 * A node path reduced to the shape used by the grid.
 *
 * Two idioms coexist in `operations.ts`: a path parameter is always written
 * `${enc(p('nom'))}`, and an optional QUERY parameter is written
 * `${p('nom') ? ... : ''}`, with nested backticks. So we cut at the first `?`
 * or the first `${p(` — what follows is the query, never the path.
 */
function normaliser(chemin) {
	const conditionnel = chemin.indexOf("${p(");
	const query = chemin.indexOf('?');
	// The CLOSING backtick bounds it too: the capture takes the whole line.
	const fin = chemin.indexOf('`');
	const bornes = [conditionnel, query, fin].filter((i) => i >= 0);
	const base = bornes.length ? chemin.slice(0, Math.min(...bornes)) : chemin;
	return base
		.replace(/\$\{enc\(p\('([^']+)'\)[^}]*\}/g, (_, nom) => `{${nom}}`)
		// A path with a block body interpolates a local VARIABLE, not `p()`:
		// `${enc(iban)}` is a parameter like any other.
		.replace(/\$\{[^}]*\}/g, '{x}');
}

/**
 * Parameter names differ between surfaces: we compare the SHAPE.
 *
 * ⚠️ A LITERAL country code in the grid (`/v1/eu/entreprise/GB/{n}`) is covered
 * by the node's parameterised path (`/v1/eu/entreprise/{country}/{id}`), which
 * offers a country dropdown. Without this reduction, the check reported dozens
 * of routes "without an operation" that are in fact served.
 */
function forme(chemin) {
	return chemin
		.replace(/^\/v1\/eu\/entreprise\/[A-Z]{2}\//, '/v1/eu/entreprise/{}/')
		.replace(/\{[^}]*\}/g, '{}')
		.replace(/\/$/, '');
}

const source = readFileSync(new URL('../nodes/Sirenic/operations.ts', import.meta.url), 'utf8');
const cheminsNoeud = new Set();
for (const [, brut] of source.matchAll(/path:\s*\(p\)\s*=>\s*\n?\s*`([^\n]+)/g)) cheminsNoeud.add(normaliser(brut));
// Paths built inside a block (several possible returns).
for (const [, brut] of source.matchAll(/return\s+`(\/v1\/[^`]+)`/g)) cheminsNoeud.add(normaliser(brut));

const openapi = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
/** ALL served routes, free ones included: a path is "dead" only if it
 *  exists nowhere. `/v1/suggestions` is free and very much alive — looking
 *  for it in the paid table alone wrongly declared it dead. */
const servies = new Set(
	Object.entries(openapi.paths)
		.filter(([chemin, v]) => chemin.startsWith('/v1/') && v.get)
		.map(([chemin]) => forme(chemin)),
);
const grille = new Map();
for (const [chemin, verbes] of Object.entries(openapi.paths)) {
	const op = verbes.get;
	if (!op || !chemin.startsWith('/v1/')) continue;
	if (!op['x-price'] || /FREE/i.test(String(op['x-price']))) continue; // free routes: out of scope
	// ⚠️ A Map keyed by shape OVERWRITES twin routes: GB, LV, DK and EE
	// `/dirigeants` share one shape, and only the last one survived — the
	// check then reported "63 routes" for 63 SHAPES. So we group them.
	const cle = forme(chemin);
	if (!grille.has(cle)) grille.set(cle, []);
	grille.get(cle).push({ chemin, prix: String(op['x-price']).split(' ')[0] });
}

const formesNoeud = new Set([...cheminsNoeud].map(forme));

const nbRoutes = [...grille.values()].reduce((n, r) => n + r.length, 0);
console.log(`Node: ${cheminsNoeud.size} paths. Grid: ${nbRoutes} paid routes in ${grille.size} shapes.\n`);

const morts = [...cheminsNoeud].filter((c) => c.startsWith('/v1/') && !servies.has(forme(c)));
console.log(`🔴 Called by the node but MISSING from the grid (${morts.length}):`);
for (const c of morts.sort()) console.log(`   ${c}`);

const manquants = [...grille.entries()].filter(([f]) => !formesNoeud.has(f));
const nbManquantes = manquants.reduce((n, [, r]) => n + r.length, 0);
console.log(`\n🟠 Sold by the grid but WITHOUT an operation: ${nbManquantes} routes in ${manquants.length} shapes`);
for (const [, routes] of manquants.sort((a, b) => a[1][0].chemin.localeCompare(b[1][0].chemin))) {
	const [premiere] = routes;
	const jumelles = routes.length > 1 ? `  (+${routes.length - 1} twins: ${routes.slice(1).map((r) => r.chemin.split('/')[4]).join(', ')})` : '';
	console.log(`   ${premiere.prix.padEnd(7)} ${premiere.chemin}${jumelles}`);
}

const couvertes = nbRoutes - nbManquantes;
console.log(`\nCouverture : ${couvertes}/${nbRoutes} routes payantes (${Math.round((couvertes / nbRoutes) * 100)} %).`);
