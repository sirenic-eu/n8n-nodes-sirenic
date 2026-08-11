import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SirenicPayer, type PaymentSettings } from './x402';
import { RESOURCES, findOperation, type Field } from './operations';

/**
 * Sirenic — official French and European company data, paid per call.
 *
 * The paid BASE routes are exposed, grouped into resources (the dedicated
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
 *
 * ⚠️ This table is DOCUMENTATION, not behaviour: the values the UI actually uses
 * are the `default:` literals of the Operation dropdowns in PROPERTIES below.
 * Changing this table alone changes NOTHING for the user — that mistake shipped
 * in 0.7.0. The test now checks all three copies agree.
 */
export const DEFAULT_OPERATION: Record<string, string> = {
	// 0.7.0 — the default is now the FREE name autocomplete: a node dropped into
	// a canvas and run once should not spend the user's money to show what it
	// does. Existing workflows are unaffected (they store their operation).
	frenchCompany: 'suggest',
	// 0.8.0 : la fiche à la carte passe devant, c'est le « un seul appel »
	// que cherche un intégrateur n8n (le KYB reste juste en dessous).
	dueDiligence: 'searchBodacc',
	financials: 'getFinancials',
	compliance: 'screenSanctions',
	procurement: 'getFrench',
	europeanCompany: 'search',
	invoicing: 'getFrenchPack',
	people: 'searchDirectors',
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
		// Matches the first entry of RESOURCES: a new node opens on the question
		// that has a deadline. Only affects NEW nodes — saved workflows keep the
		// resource they stored.
		default: 'invoicing',
		options: RESOURCES.map((r) => ({ name: r.name, value: r.value })),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		// ⚠️ 0.8.0 — CE littéral est le vrai défaut du menu déroulant. En 0.7.0 je
		// n'avais changé que `DEFAULT_OPERATION`, que RIEN ne lit : le paquet
		// publié ouvrait donc toujours sur l'opération PAYANTE, contrairement à ce
		// que son changelog annonçait. Le test vérifie désormais CES littéraux.
		default: 'suggest',
		displayOptions: { show: { resource: ['frenchCompany'] } },
		options: operationOptions('frenchCompany'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'searchBodacc',
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

				// The payment layer raises this floor to the window the API declared
				// in its quote: settlement happens after the handler, so aborting
				// early pays for a response that is thrown away.
				const result = await payer.call(
					path,
					options.timeout ?? 120_000,
					options.dryRun === true,
				);

				// An HTTP error is a failure, not a result: pushing it as a normal
				// item makes the workflow carry on with an error object in place of
				// the data. Payment is cancelled on any status >= 400, so nothing
				// was charged — but the user must be told.
				const notFoundIsData = result.status === 404 && definition.notFoundIsEmpty === true;
				if (result.status >= 400 && !result.dryRun && !notFoundIsData) {
					const detail =
						typeof result.body === 'object' && result.body !== null
							? ((result.body as Record<string, unknown>).message ??
								(result.body as Record<string, unknown>).error ??
								'')
							: '';
					throw new NodeApiError(
						this.getNode(),
						result.body as JsonObject,
						{
							message: `Sirenic returned ${result.status} for ${resource}.${operation}${detail ? `: ${String(detail)}` : ''}`,
							description: 'Nothing was charged: Sirenic cancels the payment on any error.',
							httpCode: String(result.status),
							itemIndex: i,
						},
					);
				}

				const item: INodeExecutionData = {
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
				};
				// A PDF is delivered as an n8n binary so it can be uploaded or
				// attached as-is. Handing it over as text would corrupt the file.
				if (result.binary) {
					item.binary = {
						data: await this.helpers.prepareBinaryData(
							result.binary.data,
							result.binary.fileName ?? `${operation}.pdf`,
							result.binary.contentType,
						),
					};
				}
				output.push(item);
			} catch (error) {
				if (this.continueOnFail()) {
					// Keep the API's own structured body: workflows branch on its
					// machine-readable `error` code, not on the prose message.
					const cause: unknown = error instanceof NodeApiError ? error.cause : undefined;
					const corps =
						cause && typeof cause === 'object' && !Array.isArray(cause)
							? (cause as IDataObject)
							: {};
					output.push({
						json: { ...corps, error: error instanceof Error ? error.message : String(error) },
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
