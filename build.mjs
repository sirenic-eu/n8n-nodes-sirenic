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
import { copyFileSync, mkdirSync } from 'node:fs';

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
	entryPoints: ['credentials/SirenicApi.credentials.ts'],
	outfile: 'dist/credentials/SirenicApi.credentials.js',
});

mkdirSync('dist/nodes/Sirenic', { recursive: true });
copyFileSync('nodes/Sirenic/sirenic.light.svg', 'dist/nodes/Sirenic/sirenic.light.svg');
copyFileSync('nodes/Sirenic/sirenic.dark.svg', 'dist/nodes/Sirenic/sirenic.dark.svg');
