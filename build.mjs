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
 * The manifest promises, `dist/` delivers — and we CHECK it.
 *
 * The entry points above are written by hand: in 0.13.0 a new credential was
 * declared in `package.json` and forgotten here. The package would have been
 * published advertising a missing file, and n8n would have failed to load the
 * credential on the user's side — not on ours. A build that succeeds does not
 * prove that what it promises exists.
 */
const manifeste = JSON.parse(readFileSync('package.json', 'utf8')).n8n;
const promis = [...(manifeste.credentials ?? []), ...(manifeste.nodes ?? [])];
const absents = promis.filter((chemin) => !existsSync(chemin));
if (absents.length) {
	console.error(`\nThe n8n manifest declares ${absents.length} file(s) the build did not produce:`);
	for (const chemin of absents) console.error(`  ${chemin}`);
	console.error('Add its entry point in build.mjs.');
	process.exit(1);
}
console.log(`Manifest checked: ${promis.length} files declared, ${promis.length} present in dist/.`);
