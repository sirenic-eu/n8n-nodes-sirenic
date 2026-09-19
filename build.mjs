/**
 * Bundles the node and its credential into `dist/`, dependencies included.
 *
 * n8n's verification rule `no-runtime-dependencies` requires `dependencies` to
 * be empty, and states the way out verbatim: "Move shared libraries to
 * peerDependencies **or bundle them into your build artifact**." So viem and
 * the x402 client are devDependencies, inlined here. Only `n8n-workflow` stays
 * external — it is the peer dependency n8n itself provides.
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const common = {
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'cjs',
	minify: false, // reviewers read this code; a minified bundle reads as evasion
	sourcemap: false,
	external: ['n8n-workflow'],
	logLevel: 'info',
};

await build({
	...common,
	entryPoints: ['nodes/Sirenic/Sirenic.node.ts'],
	outfile: 'dist/nodes/Sirenic/Sirenic.node.js',
});

await build({
	...common,
	entryPoints: ['nodes/SirenicTrigger/SirenicTrigger.node.ts'],
	outfile: 'dist/nodes/SirenicTrigger/SirenicTrigger.node.js',
});

await build({
	...common,
	entryPoints: ['credentials/SirenicApi.credentials.ts'],
	outfile: 'dist/credentials/SirenicApi.credentials.js',
});

await build({
	...common,
	entryPoints: ['credentials/SirenicApiKeyApi.credentials.ts'],
	outfile: 'dist/credentials/SirenicApiKeyApi.credentials.js',
});

mkdirSync('dist/nodes/Sirenic', { recursive: true });
copyFileSync('nodes/Sirenic/sirenic.light.svg', 'dist/nodes/Sirenic/sirenic.light.svg');
copyFileSync('nodes/Sirenic/sirenic.dark.svg', 'dist/nodes/Sirenic/sirenic.dark.svg');
mkdirSync('dist/nodes/SirenicTrigger', { recursive: true });
copyFileSync('nodes/SirenicTrigger/sirenic.light.svg', 'dist/nodes/SirenicTrigger/sirenic.light.svg');
copyFileSync('nodes/SirenicTrigger/sirenic.dark.svg', 'dist/nodes/SirenicTrigger/sirenic.dark.svg');

/**
 * Le manifeste promet, `dist/` livre — et on le VÉRIFIE.
 *
 * Les points d'entrée ci-dessus sont écrits à la main : en 0.13.0, une
 * credential neuve a été déclarée dans `package.json` et oubliée ici. Le paquet
 * se serait publié en annonçant un fichier absent, et n8n aurait échoué à
 * charger la credential chez l'utilisateur — pas chez nous. Un build qui réussit
 * ne prouve pas que ce qu'il promet existe.
 */
const manifeste = JSON.parse(readFileSync('package.json', 'utf8')).n8n;
const promis = [...(manifeste.credentials ?? []), ...(manifeste.nodes ?? [])];
const absents = promis.filter((chemin) => !existsSync(chemin));
if (absents.length) {
	console.error(`\nLe manifeste n8n annonce ${absents.length} fichier(s) que le build n'a pas produits :`);
	for (const chemin of absents) console.error(`  ${chemin}`);
	console.error("Ajouter son point d'entrée dans build.mjs.");
	process.exit(1);
}
console.log(`Manifeste vérifié : ${promis.length} fichiers annoncés, ${promis.length} présents dans dist/.`);
