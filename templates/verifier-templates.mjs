/**
 * Checks the ready-to-import workflows of this folder before they are published
 * (the n8n creator portal, the npm package, GitHub).
 *
 * Since 23/09/2026 the templates run on the API KEY rail with native nodes
 * only, so they import on n8n Cloud: n8n Cloud cannot install this community
 * node, and a template built on it excluded every Cloud user. Since 20/11/2026
 * this folder keeps the two whose route no workflow of the gallery at
 * https://api.sirenic.eu/workflows calls (T07, T08; kopko13/sirenic#177).
 * This script keeps them there:
 *   1. no node of this package (`n8n-nodes-sirenic.*`): native nodes only;
 *   2. every HTTP Request node authenticates with a Header Auth credential
 *      (X-Api-Key) and calls a REAL route of the live price grid, read from
 *      https://api.sirenic.eu/openapi.json (free), with query parameters the
 *      route declares; the grid price of each called route is quoted in the
 *      main sticky note;
 *   3. every MCP Client Tool node targets https://api.sirenic.eu/mcp/connecteur
 *      with header auth: the anonymous /mcp endpoint IGNORES an X-Api-Key
 *      header, so paid tools would only ever return quotes there;
 *   4. no embedded credential, no API key in clear;
 *   5. the main sticky (yellow) carries the five sections n8n requires, and no
 *      sticky still says "community node" or "self-hosted only";
 *   6. no em dash anywhere (house rule of 23/09/2026 for published text), and
 *      none of the terms the Sirenic charter forbids in a template;
 *   7. a Google Sheets node that writes defined columns carries a schema equal
 *      to its values and RAW cells: with `schema: []`, n8n 2.40 fails the write
 *      of the JSON as imported (the editor only fills it when the sheet is
 *      picked again), and USER_ENTERED turns a SIREN into a number;
 *   8. every node sits inside exactly one section note, every section note
 *      frames a node, starts with a title and stays under 50 words, and no two
 *      notes overlap: the "missing annotations" of the n8n review (07/08 and
 *      14/08/2026). Checks 7 and 8 are those of the gallery check of
 *      kopko13/sirenic (scripts/templates-nocode/verifier-galerie.mjs, 1 and 5).
 *
 * It can fail: `node verifier-templates.mjs --dossier <folder of the six
 * originals>` must go red on all six (measured on 23/09/2026; on 20/11/2026,
 * T07 and T08 as they stood went red on checks 7 and 8), and `--morsure`
 * breaks a converted template in memory once per check family.
 *
 *   node templates/verifier-templates.mjs
 *   node templates/verifier-templates.mjs --openapi openapi.json   # offline grid
 *   node templates/verifier-templates.mjs --dossier <folder>
 *   node templates/verifier-templates.mjs --morsure
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'https://api.sirenic.eu';
const MCP_AVEC_CLE = `${BASE}/mcp/connecteur`;
const TIRET_LONG = '—';
const SECTIONS = ["Who's it for", 'How it works', 'How to set up', 'Requirements', 'How to customize'];
const INTERDITS = [/bénéficiaires effectifs/i, /beneficial owners?/i];

const arg = (nom) => {
	const i = process.argv.indexOf(nom);
	return i > -1 ? process.argv[i + 1] : undefined;
};
const DOSSIER = arg('--dossier') ? `${resolve(arg('--dossier'))}/` : new URL('./', import.meta.url).pathname;

async function chargerGrille() {
	const fichier = arg('--openapi');
	const texte = fichier ? readFileSync(resolve(fichier), 'utf8') : await (await fetch(`${BASE}/openapi.json`)).text();
	const openapi = JSON.parse(texte);
	const resoudre = (p) => (p.$ref ? openapi.components?.parameters?.[p.$ref.split('/').pop()] ?? {} : p);
	return Object.entries(openapi.paths ?? {})
		.filter(([, v]) => v.get)
		.map(([chemin, v]) => ({
			chemin,
			motif: new RegExp(`^${chemin.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}|\{[^}]+\}/g, '[^/]+')}$`),
			parametres: chemin.split('/').filter((s) => s.startsWith('{')).length,
			prix: v.get['x-price'] ?? null,
			requete: (v.get.parameters ?? []).map(resoudre).filter((p) => p.in === 'query').map((p) => p.name),
		}));
}

/** The URL an HTTP Request node will call, expressions replaced by a placeholder. */
function urlConcrete(url) {
	return String(url ?? '').replace(/^=/, '').replace(/\{\{[\s\S]*?\}\}/g, (expr) => {
		// A query parameter added by an expression (`{{ x ? '&iban=' + … : '' }}`) is kept by name.
		const ajoute = /'[&?]([a-z_]+)='/i.exec(expr);
		return ajoute ? `&${ajoute[1]}=X` : 'X';
	});
}

/** Canvas geometry, as the gallery check of kopko13/sirenic reads it: a node is a 100 x 100 box at its
 *  position, a sticky note the rectangle of its position, width and height. */
const NOEUD = 100;
const MOTS_SECTION = 50;
const rectangle = (s) => ({ x: s.position[0], y: s.position[1], l: s.parameters.width, h: s.parameters.height });
const contient = (r, n) => n.position[0] >= r.x && n.position[1] >= r.y && n.position[0] + NOEUD <= r.x + r.l && n.position[1] + NOEUD <= r.y + r.h;
const chevauche = (a, b) => a.x < b.x + b.l && b.x < a.x + a.l && a.y < b.y + b.h && b.y < a.y + a.h;

function chaines(valeur, chemin = '', vus = []) {
	if (typeof valeur === 'string') vus.push({ chemin: chemin || '(root)', texte: valeur });
	else if (Array.isArray(valeur)) valeur.forEach((v, i) => chaines(v, `${chemin}[${i}]`, vus));
	else if (valeur && typeof valeur === 'object') for (const [k, v] of Object.entries(valeur)) chaines(v, chemin ? `${chemin}.${k}` : k, vus);
	return vus;
}

function controler(wf, grille) {
	const ecarts = [];
	const noeuds = wf.nodes ?? [];
	const noms = new Set(noeuds.map((n) => n.name));
	const principal = noeuds.filter((n) => n.type === 'n8n-nodes-base.stickyNote' && n.parameters?.color === undefined);
	const apercu = String(principal[0]?.parameters?.content ?? '');

	// 1. native nodes only
	for (const n of noeuds.filter((x) => String(x.type).startsWith('n8n-nodes-sirenic.'))) {
		ecarts.push(`"${n.name}" uses the community node ${n.type} (self-hosted only, excluded from n8n Cloud)`);
	}

	// 2. HTTP Request: header auth, real route, declared query parameters, grid price quoted
	for (const n of noeuds.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
		const p = n.parameters ?? {};
		if (p.authentication !== 'genericCredentialType' || p.genericAuthType !== 'httpHeaderAuth') {
			ecarts.push(`"${n.name}" does not use a Header Auth credential (X-Api-Key)`);
		}
		const url = urlConcrete(p.url);
		if (!url.startsWith(`${BASE}/`)) { ecarts.push(`"${n.name}" calls outside Sirenic: ${url}`); continue; }
		const [chemin, requete = ''] = url.slice(BASE.length).split('?');
		const candidates = grille.filter((r) => r.motif.test(chemin)).sort((a, b) => a.parametres - b.parametres);
		const route = candidates[0];
		if (!route) { ecarts.push(`"${n.name}" calls ${chemin}, which is not a route of the price grid`); continue; }
		for (const nom of requete.split('&').filter(Boolean).map((x) => x.split('=')[0])) {
			if (!route.requete.includes(nom)) ecarts.push(`"${n.name}": query parameter "${nom}" is not declared by ${route.chemin}`);
		}
		if (route.prix && !apercu.includes(`(${route.prix})`) && !apercu.includes(route.prix)) {
			ecarts.push(`"${n.name}": the grid price of ${route.chemin} (${route.prix}) is not quoted in the main sticky`);
		}
	}

	// 3. MCP Client Tool: the endpoint that reads the X-Api-Key header
	for (const n of noeuds.filter((x) => x.type === '@n8n/n8n-nodes-langchain.mcpClientTool')) {
		if (n.parameters?.endpointUrl !== MCP_AVEC_CLE) ecarts.push(`"${n.name}" targets ${n.parameters?.endpointUrl}; with an API key it must be ${MCP_AVEC_CLE} (/mcp ignores the header)`);
		if (n.parameters?.authentication !== 'headerAuth') ecarts.push(`"${n.name}" does not authenticate with a header (authentication: ${n.parameters?.authentication})`);
	}

	// 4. no embedded credential, no key in clear
	for (const n of noeuds.filter((x) => x.credentials && Object.keys(x.credentials).length)) ecarts.push(`"${n.name}" embeds a credential`);
	if (/srn_live_[A-Za-z0-9]/.test(JSON.stringify(wf))) ecarts.push('an API key in clear');

	// 5. main sticky: exactly one, five sections; no stale community-node wording
	if (principal.length !== 1) ecarts.push(`${principal.length} main (yellow) sticky notes, exactly 1 expected`);
	for (const s of SECTIONS) if (!apercu.includes(`### ${s}`)) ecarts.push(`main sticky: section "${s}" missing`);
	for (const n of noeuds.filter((x) => x.type === 'n8n-nodes-base.stickyNote')) {
		const c = String(n.parameters?.content ?? '');
		if (/community node/i.test(c)) ecarts.push(`sticky "${n.name}" still mentions the community node`);
		if (/self-hosted (n8n )?only/i.test(c)) ecarts.push(`sticky "${n.name}" still says "self-hosted only"`);
	}

	// 6. published text: no em dash, no forbidden term
	for (const { chemin, texte } of chaines(wf)) {
		if (texte.includes(TIRET_LONG)) ecarts.push(`em dash in ${chemin}`);
		for (const motif of INTERDITS) if (motif.test(texte)) ecarts.push(`forbidden term in ${chemin}`);
	}

	// 7. Google Sheets writing defined columns: a schema equal to the values, RAW cells
	for (const n of noeuds.filter((x) => x.type === 'n8n-nodes-base.googleSheets' && x.parameters?.columns?.mappingMode === 'defineBelow')) {
		const c = n.parameters.columns;
		const ids = (c.schema ?? []).map((s) => s.id);
		const valeurs = Object.keys(c.value ?? {});
		if (ids.length === 0) ecarts.push(`"${n.name}": columns.schema is empty (n8n 2.40 fails the write of the JSON as imported, until the editor reloads the columns)`);
		else if (JSON.stringify([...ids].sort()) !== JSON.stringify([...valeurs].sort())) ecarts.push(`"${n.name}": schema (${ids.join(', ')}) and values (${valeurs.join(', ')}) differ`);
		for (const m of c.matchingColumns ?? []) if (!valeurs.includes(m)) ecarts.push(`"${n.name}": matching column "${m}" is not written`);
		if (n.parameters?.options?.cellFormat !== 'RAW') ecarts.push(`"${n.name}": cellFormat RAW expected (USER_ENTERED turns a SIREN into a number and drops its leading zeros)`);
	}

	// 8. section notes frame the nodes (the "missing annotations" of the n8n review)
	const sections = noeuds.filter((n) => n.type === 'n8n-nodes-base.stickyNote' && n.parameters?.color !== undefined);
	const actifs = noeuds.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
	if (sections.length === 0) ecarts.push('no section note');
	for (const n of actifs) {
		const cadres = sections.filter((s) => contient(rectangle(s), n));
		if (cadres.length !== 1) ecarts.push(`"${n.name}" is framed by ${cadres.length} section notes, exactly 1 expected`);
	}
	for (const s of sections) {
		const texte = String(s.parameters.content ?? '');
		if (!/^##+ \S/.test(texte)) ecarts.push(`section note "${s.name}" does not start with a title`);
		const mots = texte.split(/\s+/).filter(Boolean).length;
		if (mots >= MOTS_SECTION) ecarts.push(`section note "${s.name}": ${mots} words (under ${MOTS_SECTION} for a section note)`);
		if (!actifs.some((n) => contient(rectangle(s), n))) ecarts.push(`section note "${s.name}" frames no node`);
	}
	const notes = [...principal, ...sections];
	for (let i = 0; i < notes.length; i++) {
		for (let j = i + 1; j < notes.length; j++) {
			if (chevauche(rectangle(notes[i]), rectangle(notes[j]))) ecarts.push(`notes "${notes[i].name}" and "${notes[j].name}" overlap`);
		}
	}

	// structure: links and $('…') references point to existing nodes
	for (const [source, sorties] of Object.entries(wf.connections ?? {})) {
		if (!noms.has(source)) ecarts.push(`link from an unknown node "${source}"`);
		for (const branches of Object.values(sorties)) for (const b of branches) for (const l of b ?? []) if (!noms.has(l.node)) ecarts.push(`link to an unknown node "${l.node}"`);
	}
	for (const [, cible] of JSON.stringify(wf).matchAll(/\$\('([^']+)'\)/g)) if (!noms.has(cible)) ecarts.push(`expression to an unknown node $('${cible}')`);

	return ecarts;
}

const grille = await chargerGrille();
if (grille.length < 50) { console.error(`Price grid unreadable (${grille.length} routes). Nothing checked.`); process.exit(2); }
const fichiers = readdirSync(DOSSIER).filter((f) => /^T\d+-.+\.json$/.test(f)).sort();
if (!fichiers.length) { console.error(`No T*.json template in ${DOSSIER}.`); process.exit(2); }
const charger = (f) => JSON.parse(readFileSync(DOSSIER + f, 'utf8'));

if (process.argv.includes('--morsure')) {
	// T07: an HTTP Request node, a Google Sheets write in defined columns and two section notes.
	const base = charger(fichiers.find((f) => f.startsWith('T07-')) ?? fichiers[0]);
	const http = (w) => w.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest');
	const principal = (w) => w.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote' && n.parameters.color === undefined);
	const section = (w) => w.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote' && n.parameters.color !== undefined);
	const feuille = (w) => w.nodes.find((n) => n.type === 'n8n-nodes-base.googleSheets' && n.parameters.columns?.mappingMode === 'defineBelow');
	const prixAppele = (w) => grille.find((r) => r.motif.test(urlConcrete(http(w).parameters.url).slice(BASE.length).split('?')[0]))?.prix;
	const mutations = [
		['community node back', (w) => { Object.assign(http(w), { type: 'n8n-nodes-sirenic.sirenic', typeVersion: 1 }); }],
		['no header auth', (w) => { http(w).parameters.authentication = 'none'; }],
		['invented route', (w) => { http(w).parameters.url = `=${BASE}/v1/entreprise/{{ $json.siren }}/liens-capitalistiques`; }],
		['undeclared query parameter', (w) => { http(w).parameters.url = `=${BASE}/v1/recherche?query={{ $json.name }}`; }],
		['call outside Sirenic', (w) => { http(w).parameters.url = 'https://example.test/v1/x'; }],
		['grid price missing from the sticky', (w) => { principal(w).parameters.content = principal(w).parameters.content.replaceAll(prixAppele(w), '$9.99'); }],
		['anonymous MCP endpoint', (w) => { w.nodes.push({ name: 'MCP', type: '@n8n/n8n-nodes-langchain.mcpClientTool', parameters: { endpointUrl: `${BASE}/mcp`, authentication: 'headerAuth' }, position: [0, 0] }); }],
		['embedded credential', (w) => { http(w).credentials = { httpHeaderAuth: { id: '42', name: 'Mine' } }; }],
		['key in clear', (w) => { http(w).parameters.url += '&k=srn_live_abcdef'; }],
		['section missing', (w) => { principal(w).parameters.content = principal(w).parameters.content.replace("### Who's it for", '### Audience'); }],
		['stale disclaimer', (w) => { principal(w).parameters.content += '\n\n**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**'; }],
		['em dash', (w) => { w.name += ` ${TIRET_LONG} Sirenic`; }],
		['forbidden term', (w) => { principal(w).parameters.content += '\nReturns the beneficial owners.'; }],
		['dead link', (w) => { Object.values(w.connections)[0].main[0][0].node = 'Ghost node'; }],
		['empty Sheets schema', (w) => { feuille(w).parameters.columns.schema = []; }],
		['Sheets schema short of a value', (w) => { feuille(w).parameters.columns.schema.pop(); }],
		['Sheets cells not RAW', (w) => { delete feuille(w).parameters.options.cellFormat; }],
		['node outside every section note', (w) => { http(w).position = [5000, 5000]; }],
		['node framed twice', (w) => { w.nodes.push({ ...section(w), name: 'Twin note' }); }],
		['section note framing nothing', (w) => { w.nodes.push({ ...section(w), name: 'Empty note', position: [5000, 5000] }); }],
		['section note without a title', (w) => { section(w).parameters.content = section(w).parameters.content.replace(/^#+ /, ''); }],
		['long section note', (w) => { section(w).parameters.content += ' word'.repeat(60); }],
		['notes overlapping', (w) => { section(w).position = [...principal(w).position]; }],
	];
	const avant = new Set(controler(base, grille));
	let mordent = 0;
	for (const [nom, muter] of mutations) {
		const copie = JSON.parse(JSON.stringify(base));
		muter(copie);
		const mord = controler(copie, grille).some((e) => !avant.has(e));
		console.log(`${mord ? '✅' : '🔴'} ${nom}${mord ? '' : ': THE CHECK DOES NOT BITE'}`);
		if (mord) mordent++;
	}
	console.log(`${mordent}/${mutations.length} mutations caught`);
	process.exit(mordent === mutations.length ? 0 : 1);
}

let rouges = 0;
for (const f of fichiers) {
	const ecarts = controler(charger(f), grille);
	if (ecarts.length === 0) console.log(`✅ ${f}`);
	else {
		rouges++;
		console.log(`🔴 ${f}`);
		for (const e of ecarts) console.log(`     ${e}`);
	}
}
console.log(rouges === 0 ? `All ${fichiers.length} templates pass (grid: ${grille.length} routes).` : `${rouges} of ${fichiers.length} template(s) fail.`);
process.exit(rouges === 0 ? 0 : 1);
