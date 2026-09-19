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

import { SirenicPayer, type AppelantSirenic, type PaymentSettings } from './x402';
import { SirenicKeyCaller } from './cle-api';
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
	// 0.10.0 — the BODACC gazette search leads, ahead of the pick-your-blocks
	// company file that took the lead in 0.8.0: both answer in a single call,
	// which is what an n8n integrator reaches for, and the full KYB file stays
	// right below.
	dueDiligence: 'searchBodacc',
	financials: 'getFinancials',
	compliance: 'screenSanctions',
	procurement: 'getFrench',
	europeanCompany: 'search',
	invoicing: 'getFrenchPack',
	people: 'searchDirectors',
	// 0.11.0 — associations (loi 1901): the FREE-form name search leads, like on
	// the company resource. An integrator who has an RNA number goes straight to
	// the profile; one who has a name needs the search first.
	association: 'searchAssociations',
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
		/**
		 * Le choix du rail, en 0.13.0.
		 *
		 * `apiKey` est le DÉFAUT : le rail wallet demandait à une équipe finance
		 * ou CRM de détenir une clé privée Base approvisionnée en USDC avant de
		 * pouvoir consulter un SIREN. Changer un défaut casserait les workflows
		 * enregistrés qui n'ont pas ce paramètre — mesuré le 17/08/2026, les
		 * téléchargements npm sont des bots à 97 % et l'adoption humaine réelle
		 * tient entre zéro et deux installations, donc le risque est nul et il
		 * est écrit ici plutôt que caché. Un workflow qui tenait au wallet
		 * repasse le sélecteur sur « x402 » : rien d'autre ne change.
		 */
		displayName: 'Authentication',
		name: 'authentication',
		type: 'options',
		noDataExpression: true,
		default: 'apiKey',
		options: [
			{
				name: 'API Key (Prepaid Credits)',
				value: 'apiKey',
				description: 'A key created at api.sirenic.eu/compte, charged against prepaid credits. No wallet, no crypto.',
			},
			{
				name: 'Wallet — USDC on Base',
				value: 'x402',
				// « x402 » s'écrit en minuscules : c'est un nom de protocole. La
				// règle de casse des libellés le transformait en « X402 », d'où
				// le libellé sans le mot et la mention dans la description.
				description: 'A Base private key that signs a USDC payment per call over x402. No account needed.',
			},
		],
	},
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
		// ⚠️ 0.8.0 — THIS literal is the dropdown's real default. In 0.7.0 only
		// `DEFAULT_OPERATION` was changed, and nothing reads that table: the
		// published package still opened on the PAID operation, contrary to what
		// its changelog announced. The test now checks THESE literals.
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
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'searchAssociations',
		displayOptions: { show: { resource: ['association'] } },
		options: operationOptions('association'),
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

/**
 * L'appelant du rail CLÉ D'API. Rien n'est signé : la clé part en en-tête et le
 * compte est débité en euros.
 */
async function appelantParCle(this: IExecuteFunctions): Promise<AppelantSirenic> {
	const credentials = await this.getCredentials('sirenicApiKeyApi');
	const apiKey = String(credentials.apiKey ?? '');
	if (!apiKey.startsWith('srn_')) {
		throw new NodeOperationError(
			this.getNode(),
			'The Sirenic API key must start with "srn_". Create one at https://api.sirenic.eu/compte.',
		);
	}
	return new SirenicKeyCaller({
		apiKey,
		baseUrl: String(credentials.baseUrl ?? 'https://api.sirenic.eu'),
		maxSpendPerExecution: Number(credentials.maxSpendPerExecution ?? 0),
	});
}

/**
 * L'appelant du rail WALLET. Les plafonds y sont obligatoires : un node capable
 * de signer un paiement sans plafond est un passif.
 */
async function appelantParWallet(this: IExecuteFunctions): Promise<AppelantSirenic> {
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
	return new SirenicPayer(settings);
}

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
		credentials: [
			{
				name: 'sirenicApiKeyApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'sirenicApi',
				required: true,
				displayOptions: { show: { authentication: ['x402'] } },
			},
		],
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
		// Le rail se lit sur l'item 0 : un sélecteur d'authentification ne
		// s'exprime pas par item, et un appelant par exécution est ce qui rend le
		// plafond de dépense opposable à TOUS les items.
		const rail = this.getNodeParameter('authentication', 0, 'apiKey') as 'apiKey' | 'x402';

		const payer: AppelantSirenic =
			rail === 'apiKey' ? await appelantParCle.call(this) : await appelantParWallet.call(this);
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
