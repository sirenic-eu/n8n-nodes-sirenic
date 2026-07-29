import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SirenicPayer, type PaymentSettings } from './x402';
import { RESSOURCES, trouverOperation, type Champ } from './operations';

/**
 * Sirenic — official French and European company data, paid per call.
 *
 * Les 41 routes payantes de BASE sont exposées, organisées en ressources (les
 * fiches dédiées par pays — BE, CH, NO… — passent par le profil européen
 * générique : même handler côté API). Elles ne sont PAS décrites ici : tout
 * vient du catalogue `operations.ts`, seule source de vérité. L'interface et
 * le routage ne peuvent donc pas diverger — un tel écart ne se verrait qu'en
 * production, une fois le client débité.
 */

/** Un champ apparaît UNE fois, visible pour toutes les opérations qui l'utilisent. */
function champsDeRessource(ressource: (typeof RESSOURCES)[number]): INodeProperties[] {
	const parNom = new Map<string, { champ: Champ; operations: string[] }>();
	for (const op of ressource.operations) {
		for (const champ of op.champs ?? []) {
			const entree = parNom.get(champ.nom);
			if (entree) entree.operations.push(op.valeur);
			else parNom.set(champ.nom, { champ, operations: [op.valeur] });
		}
	}

	return [...parNom.values()].map(({ champ, operations }) => ({
		displayName: champ.libelle,
		name: champ.nom,
		type: champ.type,
		default: champ.defaut ?? (champ.type === 'number' ? 0 : ''),
		...(champ.requis ? { required: true } : {}),
		...(champ.placeholder ? { placeholder: champ.placeholder } : {}),
		...(champ.options ? { options: champ.options } : {}),
		displayOptions: { show: { resource: [ressource.valeur], operation: operations } },
		description: champ.description,
	})) as INodeProperties[];
}

/**
 * Opération par défaut de chaque ressource, en LITTÉRAL.
 *
 * Le linter n8n exige que `default` soit une valeur littérale : il analyse
 * l'AST et ne suit pas `RESSOURCES[0].operations[0].valeur`. On l'écrit donc à
 * la main — et un test vérifie que chaque valeur correspond bien à la première
 * opération de sa ressource, pour que ce doublon ne puisse pas diverger.
 */
export const OPERATION_PAR_DEFAUT: Record<string, string> = {
	frenchCompany: 'search',
	dueDiligence: 'getKyb',
	financials: 'getFinancials',
	compliance: 'screenSanctions',
	procurement: 'getFrench',
	europeanCompany: 'search',
	invoicing: 'getFrenchPack',
	people: 'searchDirectors',
	monitoring: 'watch',
};

/** Options d'opération d'une ressource, dérivées du catalogue. */
function optionsDe(ressource: string) {
	const r = RESSOURCES.find((x) => x.valeur === ressource);
	return (r?.operations ?? []).map((o) => ({
		name: o.nom,
		value: o.valeur,
		action: o.action,
		description: o.description,
	}));
}

const PROPRIETES: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		default: 'frenchCompany',
		options: RESSOURCES.map((r) => ({ name: r.nom, value: r.valeur })),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'search',
		displayOptions: { show: { resource: ['frenchCompany'] } },
		options: optionsDe('frenchCompany'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getKyb',
		displayOptions: { show: { resource: ['dueDiligence'] } },
		options: optionsDe('dueDiligence'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFinancials',
		displayOptions: { show: { resource: ['financials'] } },
		options: optionsDe('financials'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'screenSanctions',
		displayOptions: { show: { resource: ['compliance'] } },
		options: optionsDe('compliance'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFrench',
		displayOptions: { show: { resource: ['procurement'] } },
		options: optionsDe('procurement'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'search',
		displayOptions: { show: { resource: ['europeanCompany'] } },
		options: optionsDe('europeanCompany'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFrenchPack',
		displayOptions: { show: { resource: ['invoicing'] } },
		options: optionsDe('invoicing'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'searchDirectors',
		displayOptions: { show: { resource: ['people'] } },
		options: optionsDe('people'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'watch',
		displayOptions: { show: { resource: ['monitoring'] } },
		options: optionsDe('monitoring'),
	},
	...RESSOURCES.flatMap(champsDeRessource),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Dry Run',
				name: 'dryRun',
				type: 'boolean',
				default: false,
				description:
					'Whether to check the price and stop without paying. Returns what the call would cost.',
			},
			{
				displayName: 'Timeout (Ms)',
				name: 'timeout',
				type: 'number',
				default: 120000,
				description: 'How long to wait for a paid response',
			},
		],
	},
];

export class Sirenic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sirenic',
		name: 'sirenic',
		icon: { light: 'file:sirenic.light.svg', dark: 'file:sirenic.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Official French and European company data, paid per call — no API key',
		defaults: { name: 'Sirenic' },
		// An AI agent asked to vet a supplier should be able to reach this
		// directly; the spending caps in the credential are what make that safe.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sirenicApi', required: true }],
		// Métadonnées de découverte. Les `alias` alimentent la recherche du
		// panneau de nœuds — l'endroit où un utilisateur cherche vraiment, bien
		// avant npm. Quelqu'un qui tape « KYB », « SIREN » ou « due diligence »
		// doit nous trouver, alors que le nom « Sirenic » ne lui dit rien.
		codex: {
			categories: ['Data & Storage', 'Finance & Accounting', 'Sales'],
			resources: {
				primaryDocumentation: [{ url: 'https://api.sirenic.eu' }],
				credentialDocumentation: [{ url: 'https://api.sirenic.eu/llms.txt' }],
			},
			alias: [
				'KYB', 'KYC', 'AML', 'compliance', 'due diligence', 'sanctions', 'screening',
				'company', 'business', 'registry', 'company data', 'company lookup',
				'SIREN', 'SIRET', 'VAT', 'TVA', 'LEI', 'IBAN', 'enterprise number',
				'supplier', 'vendor', 'onboarding', 'enrichment', 'B2B', 'prospecting',
				'France', 'French', 'Europe', 'European', 'INSEE', 'INPI', 'BODACC',
				'insolvency', 'bankruptcy', 'credit risk', 'financials', 'annual accounts',
				'patents', 'trademarks', 'public procurement', 'lobbying', 'e-invoicing',
				'x402', 'pay per call', 'USDC',
			],
		},
		properties: PROPRIETES,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('sirenicApi');

		const settings: PaymentSettings = {
			privateKey: String(credentials.privateKey ?? ''),
			baseUrl: String(credentials.baseUrl ?? 'https://api.sirenic.eu'),
			payTo: String(credentials.payTo ?? ''),
			maxPerCall: Number(credentials.maxAmountPerCall ?? 0),
			maxPerExecution: Number(credentials.maxAmountPerExecution ?? 0),
		};
		if (!settings.privateKey.startsWith('0x') || settings.privateKey.length !== 66) {
			throw new NodeOperationError(
				this.getNode(),
				'The wallet private key must be a 0x-prefixed 32-byte hex string.',
			);
		}
		if (!(settings.maxPerCall > 0) || !(settings.maxPerExecution > 0)) {
			throw new NodeOperationError(
				this.getNode(),
				'Both spending caps must be greater than zero. They are what keeps a runaway workflow from draining the wallet.',
			);
		}

		// One payer per execution: the per-execution cap spans every item.
		const payer = new SirenicPayer(settings);
		const output: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					dryRun?: boolean;
					timeout?: number;
				};

				const definition = trouverOperation(resource, operation);
				if (!definition) {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}.${operation}`,
						{ itemIndex: i },
					);
				}
				// Un paramètre absent vaut chaîne vide : les champs facultatifs du
				// catalogue s'en servent pour décider s'ils entrent dans l'URL.
				const lire = (nom: string) => String(this.getNodeParameter(nom, i, '') ?? '').trim();
				const path = definition.chemin(lire);

				const result = await payer.call(path, options.timeout ?? 120_000, options.dryRun === true);

				output.push({
					json: {
						...(typeof result.body === 'object' && result.body !== null && !Array.isArray(result.body)
							? (result.body as Record<string, unknown>)
							: { result: result.body }),
						_sirenic: {
							resource,
							operation,
							status: result.status,
							paid_usd: result.paid,
							execution_total_usd: payer.totalPaid,
						},
					},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				// Never re-throw a raw error: a refused payment must reach the user
				// as an n8n error carrying the node and the item, not an opaque
				// stack trace. Wrapping unconditionally also satisfies n8n's
				// `require-node-api-error` rule, which forbids bare re-throws.
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error.message : String(error),
					{ itemIndex: i },
				);
			}
		}

		return [output];
	}
}
