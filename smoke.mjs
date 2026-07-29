/**
 * Live smoke test — loads the BUILT bundle and drives it through a minimal
 * fake n8n execution context, against the real API with a real wallet.
 *
 * ⚠️ SPENDS REAL MONEY (about $0.006). Run with:
 *   TEST_WALLET_KEY=0x… node smoke.mjs
 *
 * Why this exists: a node that typechecks and passes unit tests still has
 * never proved it can actually settle a payment. The unit tests cover the
 * refusals; only this covers the acceptance.
 */
import { Sirenic } from './dist/nodes/Sirenic/Sirenic.node.js';

const key = process.env.TEST_WALLET_KEY;
if (!key) {
	console.error('TEST_WALLET_KEY missing — nothing was called.');
	process.exit(1);
}

/** Minimal stand-in for n8n's IExecuteFunctions. */
function context(params, itemCount = 1) {
	return {
		getInputData: () => Array.from({ length: itemCount }, () => ({ json: {} })),
		getCredentials: async () => ({
			privateKey: key,
			baseUrl: 'https://api.sirenic.eu',
			payTo: '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2',
			maxAmountPerCall: 0.2,
			maxAmountPerExecution: 5,
		}),
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'Sirenic' }),
		continueOnFail: () => false,
	};
}

async function run(label, params, itemCount = 1) {
	const node = new Sirenic();
	const [items] = await node.execute.call(context(params, itemCount));
	const meta = items[0].json._sirenic;
	console.log(
		`✓ ${label.padEnd(34)} status ${meta.status}  paid $${meta.paid_usd.toFixed(3)}  total $${meta.execution_total_usd.toFixed(3)}`,
	);
	return items;
}

console.log('Live smoke against https://api.sirenic.eu\n');

// 1. Dry run first: proves the quote is read and checked without paying.
const dry = await run('dry run (must not pay)', {
	resource: 'frenchCompany',
	operation: 'getProfile',
	siren: '552032534',
	options: { dryRun: true },
});
console.log('   would have paid:', dry[0].json.would_pay_usd, 'USD\n');

// 2. Real paid calls.
const search = await run('search company', {
	resource: 'frenchCompany',
	operation: 'search',
	query: 'DANONE',
	options: {},
});
console.log('   top match:', search[0].json.resultats?.[0]?.denomination ?? '(none)');

const profile = await run('get company profile', {
	resource: 'frenchCompany',
	operation: 'getProfile',
	siren: '552032534',
	options: {},
});
console.log('   name:', profile[0].json.denomination, '| state:', profile[0].json.etat_administratif);

// 3. The cap must actually refuse. A guard never exercised is a guard assumed.
console.log('\nChecking the refusals fire for real:');
try {
	const node = new Sirenic();
	const ctx = context({
		// getKyb vit dans la ressource dueDiligence depuis la refacto catalogue —
		// avec l'ancienne valeur, le refus venait du lookup (« Unknown operation »),
		// pas du plafond : le contrôle passait pour la MAUVAISE raison.
		resource: 'dueDiligence',
		operation: 'getKyb',
		siren: '552032534',
		options: {},
	});
	ctx.getCredentials = async () => ({
		privateKey: key,
		baseUrl: 'https://api.sirenic.eu',
		payTo: '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2',
		maxAmountPerCall: 0.01, // KYB costs $0.15 — must be refused
		maxAmountPerExecution: 5,
	});
	await node.execute.call(ctx);
	console.log('✗ per-call cap did NOT fire — that is a bug');
	process.exitCode = 1;
} catch (e) {
	console.log('✓ per-call cap refused as expected:', String(e.message).slice(0, 90), '…');
}

try {
	const node = new Sirenic();
	const ctx = context({
		resource: 'frenchCompany',
		operation: 'getProfile',
		siren: '552032534',
		options: {},
	});
	ctx.getCredentials = async () => ({
		privateKey: key,
		baseUrl: 'https://api.sirenic.eu',
		payTo: '0x0000000000000000000000000000000000000001', // wrong recipient
		maxAmountPerCall: 0.2,
		maxAmountPerExecution: 5,
	});
	await node.execute.call(ctx);
	console.log('✗ payment-address check did NOT fire — that is a bug');
	process.exitCode = 1;
} catch (e) {
	console.log('✓ wrong payTo refused as expected:', String(e.message).slice(0, 90), '…');
}
