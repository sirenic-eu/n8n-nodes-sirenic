/**
 * Écart entre ce que le nœud APPELLE et ce que la grille VEND.
 *
 * Le nœud a dérivé : au 19/09/2026 il appelait encore
 * `/v1/entreprise/{siren}/liens-capitalistiques`, retiré de la grille (404
 * mesuré), et huit routes vendues n'avaient aucune opération. Ce script relit
 * les deux surfaces au lieu de les supposer.
 *
 *   node ecart-grille.mjs
 */
import { readFileSync } from 'node:fs';

/**
 * Un chemin du nœud ramené à la forme de la grille.
 *
 * Deux idiomes cohabitent dans `operations.ts` : un paramètre de chemin s'écrit
 * toujours `${enc(p('nom'))}`, et un paramètre de QUERY facultatif s'écrit
 * `${p('nom') ? ... : ''}`, avec des backticks imbriqués. On coupe donc au
 * premier `?` ou au premier `${p(` — ce qui suit est la query, jamais le chemin.
 */
function normaliser(chemin) {
	const conditionnel = chemin.indexOf("${p(");
	const query = chemin.indexOf('?');
	// Le backtick FERMANT borne aussi : la capture prend la ligne entière.
	const fin = chemin.indexOf('`');
	const bornes = [conditionnel, query, fin].filter((i) => i >= 0);
	const base = bornes.length ? chemin.slice(0, Math.min(...bornes)) : chemin;
	return base
		.replace(/\$\{enc\(p\('([^']+)'\)[^}]*\}/g, (_, nom) => `{${nom}}`)
		// Un chemin à corps de bloc interpole une VARIABLE locale, pas `p()` :
		// `${enc(iban)}` est un paramètre comme un autre.
		.replace(/\$\{[^}]*\}/g, '{x}');
}

/**
 * Les noms de paramètres diffèrent entre surfaces : on compare la FORME.
 *
 * ⚠️ Un code pays LITTÉRAL de la grille (`/v1/eu/entreprise/GB/{n}`) est couvert
 * par le chemin paramétré du nœud (`/v1/eu/entreprise/{country}/{id}`), qui
 * offre une liste déroulante de pays. Sans cette réduction, le contrôle
 * signalait des dizaines de routes « sans opération » qui sont servies.
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
// Les chemins construits dans un bloc (plusieurs retours possibles).
for (const [, brut] of source.matchAll(/return\s+`(\/v1\/[^`]+)`/g)) cheminsNoeud.add(normaliser(brut));

const openapi = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
/** TOUTES les routes servies, gratuites comprises : un chemin n'est « mort »
 *  que s'il n'existe nulle part. `/v1/suggestions` est gratuite et bien vivante
 *  — la chercher dans la seule table des payantes la déclarait morte à tort. */
const servies = new Set(
	Object.entries(openapi.paths)
		.filter(([chemin, v]) => chemin.startsWith('/v1/') && v.get)
		.map(([chemin]) => forme(chemin)),
);
const grille = new Map();
for (const [chemin, verbes] of Object.entries(openapi.paths)) {
	const op = verbes.get;
	if (!op || !chemin.startsWith('/v1/')) continue;
	if (!op['x-price'] || /FREE/i.test(String(op['x-price']))) continue; // gratuites : hors périmètre
	// ⚠️ Une Map indexée par forme ÉCRASE les routes jumelles : GB, LV, DK et EE
	// `/dirigeants` partagent une forme, et seule la dernière survivait — le
	// contrôle annonçait alors « 63 routes » pour 63 FORMES. On regroupe.
	const cle = forme(chemin);
	if (!grille.has(cle)) grille.set(cle, []);
	grille.get(cle).push({ chemin, prix: String(op['x-price']).split(' ')[0] });
}

const formesNoeud = new Set([...cheminsNoeud].map(forme));

const nbRoutes = [...grille.values()].reduce((n, r) => n + r.length, 0);
console.log(`Nœud : ${cheminsNoeud.size} chemins. Grille : ${nbRoutes} routes payantes en ${grille.size} formes.\n`);

const morts = [...cheminsNoeud].filter((c) => c.startsWith('/v1/') && !servies.has(forme(c)));
console.log(`🔴 Appelés par le nœud mais ABSENTS de la grille (${morts.length}) :`);
for (const c of morts.sort()) console.log(`   ${c}`);

const manquants = [...grille.entries()].filter(([f]) => !formesNoeud.has(f));
const nbManquantes = manquants.reduce((n, [, r]) => n + r.length, 0);
console.log(`\n🟠 Vendues par la grille mais SANS opération : ${nbManquantes} routes en ${manquants.length} formes`);
for (const [, routes] of manquants.sort((a, b) => a[1][0].chemin.localeCompare(b[1][0].chemin))) {
	const [premiere] = routes;
	const jumelles = routes.length > 1 ? `  (+${routes.length - 1} jumelles : ${routes.slice(1).map((r) => r.chemin.split('/')[4]).join(', ')})` : '';
	console.log(`   ${premiere.prix.padEnd(7)} ${premiere.chemin}${jumelles}`);
}

const couvertes = nbRoutes - nbManquantes;
console.log(`\nCouverture : ${couvertes}/${nbRoutes} routes payantes (${Math.round((couvertes / nbRoutes) * 100)} %).`);
