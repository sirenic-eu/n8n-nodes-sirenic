import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SirenicPayer, type PaymentSettings } from './x402';
import { RESOURCES, findOperation, type Field } from './operations';

/**
 * Sirenic — official French and European company data, paid per call.
 *
 * The 41 paid BASE routes are exposed, grouped into resources (the dedicated
 * per-country routes — BE, CH, NO… — go through the generic European profile:
 * the same handler on the API side). They are NOT described here: everything
 * comes from the `operations.ts` catalogue, the single source of truth. The
 * interface and the routing therefore cannot drift apart — such a gap would
 * only show up in production, once the customer has been charged.
 */

/** A field appears ONCE, shown for every operation that uses it. */
function resourceFields(resource: (typeof RESOURCES)[number]): INodeProperties[] {
	const byName = new Map<string, { field: Field; operations: string[] }>();
	for (const op of resource.operations) {
		for (const field of op.fields ?? []) {
			const entry = byName.get(field.name);
			if (entry) entry.operations.push(op.value);
			else byName.set(field.name, { field, operations: [op.value] });
		}
	}

	return [...byName.values()].map(({ field, operations }) => ({
		displayName: field.label,
		name: field.name,
		type: field.type,
		default: field.default ?? (field.type === 'number' ? 0 : ''),
		...(field.required ? { required: true } : {}),
		...(field.placeholder ? { placeholder: field.placeholder } : {}),
		...(field.options ? { options: field.options } : {}),
		...(field.typeOptions ? { typeOptions: field.typeOptions } : {}),
		displayOptions: { show: { resource: [resource.value], operation: operations } },
		description: field.description,
	})) as INodeProperties[];
}

/**
 * Default operation of each resource, as a LITERAL.
 *
 * The n8n linter requires `default` to be a literal value: it analyses the AST
 * and does not follow `RESOURCES[0].operations[0].value`. So it is written out
 * by hand — and a test checks that each value really is the first operation of
 * its resource, so this duplication cannot drift.
 */
export const DEFAULT_OPERATION: Record<string, string> = {
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

/** Operation options of a resource, derived from the catalogue. */
function operationOptions(resource: string) {
	const r = RESOURCES.find((x) => x.value === resource);
	return (r?.operations ?? []).map((o) => ({
		name: o.name,
		value: o.value,
		action: o.action,
		description: o.description,
	}));
}

const PROPERTIES: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		default: 'frenchCompany',
		options: RESOURCES.map((r) => ({ name: r.name, value: r.value })),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'search',
		displayOptions: { show: { resource: ['frenchCompany'] } },
		options: operationOptions('frenchCompany'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getKyb',
		displayOptions: { show: { resource: ['dueDiligence'] } },
		options: operationOptions('dueDiligence'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFinancials',
		displayOptions: { show: { resource: ['financials'] } },
		options: operationOptions('financials'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'screenSanctions',
		displayOptions: { show: { resource: ['compliance'] } },
		options: operationOptions('compliance'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFrench',
		displayOptions: { show: { resource: ['procurement'] } },
		options: operationOptions('procurement'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'search',
		displayOptions: { show: { resource: ['europeanCompany'] } },
		options: operationOptions('europeanCompany'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFrenchPack',
		displayOptions: { show: { resource: ['invoicing'] } },
		options: operationOptions('invoicing'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'searchDirectors',
		displayOptions: { show: { resource: ['people'] } },
		options: operationOptions('people'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'watch',
		displayOptions: { show: { resource: ['monitoring'] } },
		options: operationOptions('monitoring'),
	},
	...RESOURCES.flatMap(resourceFields),
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
		// Discovery metadata. The `alias` entries feed the search box of the
		// nodes panel — where users actually look, long before npm. Someone
		// typing "KYB", "SIREN" or "due diligence" has to find us, given that
		// the name "Sirenic" means nothing to them.
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
		properties: PROPERTIES,
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

				const definition = findOperation(resource, operation);
				if (!definition) {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}.${operation}`,
						{ itemIndex: i },
					);
				}
				// A missing parameter reads as an empty string: the catalogue's
				// optional fields use that to decide whether they enter the URL.
				const read = (name: string) => String(this.getNodeParameter(name, i, '') ?? '').trim();
				const path = definition.path(read);

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
