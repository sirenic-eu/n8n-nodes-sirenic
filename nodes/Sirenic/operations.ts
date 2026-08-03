/**
 * Operation catalogue — THE SINGLE SOURCE OF TRUTH.
 *
 * The node properties (resources, operations, fields) AND the URL construction
 * are both derived from this table. Adding a route therefore happens in one
 * place only, with no risk of the interface and the routing drifting apart —
 * the kind of gap that only shows up in production.
 *
 * The PRICE appears in every description because a node that spends the user's
 * money must say so before they click, not after.
 *
 * Note on the URLs below: path segments and query-string keys (`recherche`,
 * `entreprise`, `cibles`, `pays`…) are the upstream Sirenic API's own names.
 * They are the remote contract, not identifiers of this package, so they are
 * reproduced verbatim.
 */

/** A parameter entered by the user. */
export interface Field {
	name: string;
	label: string;
	type: 'string' | 'number' | 'options';
	required?: boolean;
	default?: string | number;
	placeholder?: string;
	description: string;
	options?: Array<{ name: string; value: string }>;
	/** Passed through to the generated node property; masks secrets in the UI. */
	typeOptions?: { password?: boolean };
}

export interface Operation {
	value: string;
	name: string;
	action: string;
	description: string;
	/** Path function: takes a parameter reader, returns the API path. */
	path: (p: (name: string) => string) => string;
	fields?: Field[];
	/**
	 * True when a 404 is a legitimate answer meaning "no data for this key"
	 * rather than a failure — an insider-transaction filing that does not exist,
	 * a company absent from a national register. Those must reach the workflow
	 * as an item, not abort it.
	 */
	notFoundIsEmpty?: true;
}

export interface Resource {
	value: string;
	name: string;
	operations: Operation[];
}

const enc = encodeURIComponent;

/** SIREN field, reused by the twenty-odd French operations. */
const SIREN: Field = {
	name: 'siren',
	label: 'SIREN',
	type: 'string',
	required: true,
	placeholder: '552032534',
	description: 'Nine-digit French company identifier.',
};

const COUNTRY: Field = {
	name: 'country',
	label: 'Country',
	type: 'options',
	default: 'BE',
	description: 'National register to query.',
	options: [
		{ name: 'Belgium', value: 'BE' },
		{ name: 'Czechia', value: 'CZ' },
		{ name: 'Denmark', value: 'DK' },
		{ name: 'Estonia', value: 'EE' },
		{ name: 'Finland', value: 'FI' },
		{ name: 'Latvia', value: 'LV' },
		{ name: 'Norway', value: 'NO' },
		{ name: 'Poland', value: 'PL' },
		{ name: 'Slovakia', value: 'SK' },
		{ name: 'Sweden', value: 'SE' },
		{ name: 'Switzerland', value: 'CH' },
		{ name: 'United Kingdom', value: 'GB' },
	],
};

const NATIONAL_ID: Field = {
	name: 'companyId',
	label: 'Company Identifier',
	type: 'string',
	required: true,
	placeholder: '0403170701',
	description:
		'National registration number, in that register\'s own format: BE ten digits (0403170701) · CH the UID (CHE-107.480.920) · CZ the IČO eight digits · DK the CVR eight digits · EE the registrikood eight digits · FI the business ID (0112038-9) · LV eleven digits · NO nine digits · PL the KRS ten digits · SE the org. number (5560401977) · GB the company number (00445790). A wrong format comes back as "not found", which is indistinguishable from a company that does not exist.',
};

export const RESOURCES: Resource[] = [
	// First on purpose: this array drives the order of the n8n dropdown, and
	// "can I safely invoice and pay this company?" is the one question with a
	// deadline — the French e-invoicing mandate starts on 1 September 2026.
	// The `value`s below (invoicing, getFrenchPack…) are frozen: they are stored
	// in the users' saved workflows, so renaming one would break them silently.
	{
		value: 'invoicing',
		name: 'Supplier Verification & Invoicing',
		operations: [
			{
				value: 'getFrenchPack',
				name: 'Verify French Supplier',
				action: 'Verify a supplier before payment',
				description:
					'Verify a supplier before payment, in one call: legal identity and obligation dates, the intra-EU VAT number checked live against VIES, an IBAN check against official registries with the bank identified, and a deterministic ready-to-invoice verdict (pret_a_facturer) with closed-list reasons. From 1 September 2026 every French company must be able to receive electronic invoices. Not a payee verification: the account holder name is never checked. ($0.03).',
				path: (p) =>
					`/v1/facturation/dossier?siren=${enc(p('siren'))}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				fields: [
					SIREN,
					{
						name: 'iban',
						label: 'IBAN',
						type: 'string',
						// One field per NAME is generated for the whole resource, so this
						// text is also what "Verify IBAN" shows — it must cover both.
						description:
							"The supplier's bank account. Optional on the verification packs, where it adds the bank check; required by Verify IBAN.",
					},
				],
			},
			{
				value: 'getEuPack',
				name: 'Verify European Supplier',
				action: 'Verify a European supplier before payment',
				description:
					'Verify a European supplier before payment, by country and national identifier: registry identity, VAT checked against VIES, Peppol reachability for Belgium (B2B mandate live since 1 January 2026) and, in Poland, whether the IBAN is declared by that taxpayer in the official White List — paying more than 15,000 PLN into an undeclared account costs the buyer the VAT deduction and creates joint liability for the VAT. Same deterministic verdict, closed-list reasons. ($0.03).',
				path: (p) =>
					`/v1/eu/facturation/dossier?pays=${enc(p('country'))}&id=${enc(p('companyId'))}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				fields: [
					{
						name: 'country',
						label: 'Country',
						type: 'options',
						default: 'BE',
						description:
							'Country covered by this verification pack. Belgium and Poland only — the other registers do not expose what an invoicing check needs.',
						options: [
							{ name: 'Belgium', value: 'BE' },
							{ name: 'Poland', value: 'PL' },
						],
					},
					{
						name: 'companyId',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: '0403170701',
						description:
							'Belgium: the ten-digit enterprise number. Poland: the NIP (ten-digit tax number) — NOT the KRS, which would silently produce a wrong blocking verdict because VAT and the White List are keyed on the NIP.',
					},
					{
						name: 'iban',
						label: 'IBAN',
						type: 'string',
						// One field per NAME is generated for the whole resource, so this
						// text is also what "Verify IBAN" shows — it must cover both.
						description:
							"The supplier's bank account. Optional on the verification packs, where it adds the bank check; required by Verify IBAN.",
					},
				],
			},
			{
				value: 'prepareEInvoicing',
				name: 'Prepare E-Invoicing',
				action: 'Prepare e invoicing data for a company',
				description:
					'Preparation data for the French e-invoicing mandate of 1 September 2026 (reception obligatory for every company; issuance phased, large and mid-size companies from 2026, SMEs from 1 September 2027): identity, computed intra-EU VAT number, establishments, indicative obligation dates. Preparation only — Sirenic is not an accredited platform (PDP), never accesses the central directory and never issues or routes invoices. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/facturation-prep`,
				fields: [SIREN],
			},
			{
				value: 'verifyVat',
				name: 'Verify VAT Number',
				action: 'Verify an EU VAT number before invoicing',
				description:
					'Check an intra-EU VAT number against the official VIES service — the tax half of verifying a supplier before payment, and a required check under the French e-invoicing mandate of 1 September 2026. Valid, invalid or unavailable, with the VIES consultation identifier as proof. ($0.003).',
				// Normalised before sending: the API validates the raw path segment,
				// so a number typed "FR 27 552032534" would arrive as %20 and 400.
				path: (p) => `/v1/tva/verifier/${enc(p('vatNumber').replace(/[\s.-]/g, '').toUpperCase())}`,
				fields: [
					{
						name: 'vatNumber',
						label: 'VAT Number',
						type: 'string',
						required: true,
						placeholder: 'FR27552032534',
						description:
							'Intra-EU VAT number, country prefix included. Spaces, dots and dashes are removed before the call.',
					},
				],
			},
			{
				value: 'verifyIban',
				name: 'Verify IBAN',
				action: 'Check an IBAN and identify the bank before payment',
				description:
					'IBAN check against official registries, to verify a supplier before payment: ISO 13616 and mod-97 structure check, then bank identification from official sources. Explicitly NOT a payee verification — the account holder name is never checked. ($0.005).',
				// Same normalisation: IBANs are usually copied in groups of four.
				path: (p) => {
					const iban = p('iban').replace(/[\s.-]/g, '').toUpperCase();
					if (!iban) {
						throw new Error('Verify IBAN needs an IBAN — the field is optional on the verification packs, but required here.');
					}
					return `/v1/iban/verifier/${enc(iban)}`;
				},
				fields: [
					{
						name: 'iban',
						label: 'IBAN',
						type: 'string',
						required: true,
						placeholder: 'FR7630006000011234567890189',
						description: 'IBAN to check.',
					},
				],
			},
		],
	},

	{
		value: 'frenchCompany',
		name: 'French Company',
		operations: [
			{
				value: 'search',
				name: 'Search',
				action: 'Search companies by name',
				description:
					'French company search when you do not have the SIREN: company lookup by name in the official French company registry (INSEE Sirene). Returns the top matches with a 0-1 confidence score. ($0.001).',
				path: (p) => `/v1/recherche?q=${enc(p('query'))}`,
				fields: [
					{
						name: 'query',
						label: 'Company Name',
						type: 'string',
						required: true,
						description: 'Company name, or a nine-digit SIREN.',
					},
				],
			},
			{
				value: 'getProfile',
				name: 'Get Profile',
				action: 'Get a company profile',
				description:
					'Full French company profile by SIREN, from the official company registry: legal name, form, head office, activity code, workforce, officers, VAT number. ($0.005).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}`,
				fields: [SIREN],
			},
			{
				value: 'getEstablishments',
				name: 'Get Establishments',
				action: 'List the establishments of a company',
				description: 'Every establishment (SIRET) with address and status. ($0.003).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/etablissements`,
				fields: [SIREN],
			},
			{
				value: 'getChanges',
				name: 'Get Changes',
				action: 'Get the new announcements published about a company',
				description:
					'New BODACC announcements published about this company since a given date: insolvency proceedings, removals from the register, sales and transfers, account filings. Poll it on a schedule to monitor a portfolio — an empty list is a normal answer, not an error. ($0.01).',
				path: (p) => {
					const since = p('since');
					if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
						throw new Error(
							'Get Changes needs "Since" as a YYYY-MM-DD date: the API lists the announcements published after it and refuses the call without one.',
						);
					}
					return `/v1/entreprise/${enc(p('siren'))}/changements?depuis=${enc(since)}`;
				},
				fields: [
					SIREN,
					{
						name: 'since',
						label: 'Since',
						type: 'string',
						required: true,
						placeholder: '2026-01-01',
						description:
							'List the announcements published from this date onwards, as YYYY-MM-DD. Required by the API. When polling, use the date of your previous run.',
					},
				],
			},
			{
				value: 'getCapital',
				name: 'Get Capital Structure',
				action: 'Get the shareholders of a company',
				description:
					'Shareholders extracted by AI from the public articles of association. Legal entities and individuals as filed — never a beneficial-ownership register. ($0.35).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/capital`,
				fields: [SIREN],
			},
			{
				value: 'getCapitalLinks',
				name: 'Get Capital Links',
				action: 'Get one level of capital links',
				description:
					'Single-level capital links between legal entities, both upstream and downstream. ($2.00).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/liens-capitalistiques`,
				fields: [SIREN],
			},
			{
				value: 'getIntellectualProperty',
				name: 'Get Intellectual Property',
				action: 'Get patents and trademarks',
				description:
					'Patents, trademarks, designs and models from the INPI registry. Inventor names are never returned. ($0.03).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/pi`,
				fields: [SIREN],
			},
			{
				value: 'listDocuments',
				name: 'List Documents',
				action: 'List the filed documents of a company',
				description: 'Deeds and annual accounts filed with the registry, with their references. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/documents`,
				fields: [SIREN],
			},
			{
				value: 'downloadDocument',
				name: 'Download Document',
				action: 'Download a filed document',
				description: 'One filed document as a PDF, by type and identifier. ($0.10).',
				path: (p) => `/v1/documents/${enc(p('documentType'))}/${enc(p('documentId').toLowerCase())}`,
				fields: [
					{
						name: 'documentType',
						label: 'Document Type',
						type: 'options',
						default: 'actes',
						description: 'Kind of document to download.',
						options: [
							{ name: 'Deeds', value: 'actes' },
							{ name: 'Annual Accounts', value: 'bilans' },
						],
					},
					{
						name: 'documentId',
						label: 'Document ID',
						type: 'string',
						required: true,
						description: 'Identifier returned by List Documents.',
					},
				],
				notFoundIsEmpty: true,
			},
		],
	},

	{
		value: 'dueDiligence',
		name: 'Due Diligence',
		operations: [
			{
				value: 'getKyb',
				name: 'Get KYB File',
				action: 'Get a full KYB file',
				description:
					'KYB (Know Your Business) due diligence — everything needed to onboard a supplier in one call: identity, officers, insolvency alerts, filed financials, sanctions screening, computed VAT number. ($0.15).',
				path: (p) => `/v1/kyb/${enc(p('siren'))}`,
				fields: [SIREN],
			},
			{
				value: 'getKybBatch',
				name: 'Get KYB Batch',
				action: 'Get KYB files for a list of companies',
				description:
					'Two to 100 KYB files in one call, billed per company at 30% off the unit price. Built for onboarding a supplier catalogue. ($0.105 per company).',
				path: (p) => `/v1/kyb/batch?sirens=${enc(p('sirens'))}`,
				fields: [
					{
						name: 'sirens',
						label: 'SIRENs',
						type: 'string',
						required: true,
						placeholder: '552032534,542065479',
						description: 'Two to 100 comma-separated nine-digit SIRENs.',
					},
				],
			},
			{
				value: 'getIntelligence',
				name: 'Get Intelligence Report',
				action: 'Get a go or no go intelligence report',
				description:
					'The flagship due-diligence call: every block cross-referenced, closed-list signals traced to their register, and a deterministic verdict. Use it for a credit, investment or partnership decision. ($1.00).',
				path: (p) => `/v1/intelligence/${enc(p('siren'))}`,
				fields: [SIREN],
			},
			{
				value: 'getReport',
				name: 'Get PDF Report',
				action: 'Get a company report as a PDF',
				description: 'A readable company report as a PDF document. ($0.50).',
				path: (p) => `/v1/rapport/${enc(p('siren'))}`,
				fields: [SIREN],
			},
			{
				value: 'getFailureScore',
				name: 'Get Failure Score',
				action: 'Get the failure risk score',
				description:
					'Deterministic 12-month default-risk score (credit risk) with every component shown: no AI, no black box. ($0.10).',
				path: (p) => `/v1/score/defaillance/${enc(p('siren'))}`,
				fields: [SIREN],
			},
			{
				value: 'getLegalAlerts',
				name: 'Get Legal Alerts',
				action: 'Get insolvency and legal alerts',
				description:
					'BODACC legal alerts, the official French gazette: insolvency proceedings, deregistrations, sales and transfers. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/alertes`,
				fields: [SIREN],
			},
			{
				value: 'getHealthSummary',
				name: 'Get Health Summary',
				action: 'Get an AI business health summary',
				description:
					'Plain-language business-health summary written by AI from official data only: strengths, warning signs, activity trend. Cached seven days. ($0.15).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/sante`,
				fields: [SIREN],
			},
		],
	},

	{
		value: 'financials',
		name: 'Financials',
		operations: [
			{
				value: 'getFinancials',
				name: 'Get Financials',
				action: 'Get filed annual financials',
				description:
					'Annual accounts and ratios from filed financial statements, one entry per fiscal year. Each response states whether the figures are statutory or consolidated accounts, and flags series where the official source conflates the two. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/finances`,
				fields: [SIREN],
			},
			{
				value: 'getSectorBenchmarks',
				name: 'Get Sector Benchmarks',
				action: 'Get benchmarks for an activity code',
				description:
					'Sector aggregates for a French activity code: company count, median age, workforce spread, and median revenue and margins when enough companies file accounts. Place a company against its peers. ($0.05).',
				path: (p) => `/v1/secteur/${enc(p('nafCode'))}/benchmarks`,
				fields: [
					{
						name: 'nafCode',
						label: 'Activity Code (NAF)',
						type: 'string',
						required: true,
						placeholder: '68.20B',
						description: 'French activity code at any level: 68, 68.2, 68.20 or 68.20B.',
					},
				],
			},
		],
	},

	{
		value: 'compliance',
		name: 'Compliance',
		operations: [
			{
				value: 'screenSanctions',
				name: 'Screen Sanctions',
				action: 'Screen a name against sanctions lists',
				description:
					'AML sanctions screening: screen a person or company name against six official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO). Scored matches, never a bare yes or no. ($0.02).',
				path: (p) =>
					`/v1/sanctions/check?name=${enc(p('name'))}${p('birthYear') ? `&birth_year=${enc(p('birthYear'))}` : ''}`,
				fields: [
					{
						name: 'name',
						label: 'Name to Screen',
						type: 'string',
						required: true,
						description: 'Person or company name to screen.',
					},
					{
						name: 'birthYear',
						label: 'Birth Year',
						type: 'string',
						description: 'Optional birth year, to narrow down homonyms on individuals.',
					},
				],
			},
			{
				value: 'getLicences',
				name: 'Get Regulatory Licences',
				action: 'Check whether a company is licensed',
				description:
					'Is this counterparty actually authorised to do what it claims? Payment institution, e-money, account information, insurer or telecom operator, from the EBA, EIOPA and ARCEP registers. Not authorised is a paid answer too. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/agrements`,
				fields: [SIREN],
			},
			{
				value: 'getEuAuthorisations',
				name: 'Search EU Financial Authorisations',
				action: 'Search EU financial authorisations',
				description:
					'Around 14,000 MiFID-regulated entities across the EEA from the ESMA registers, by name or LEI. ($0.01).',
				path: (p) => `/v1/eu/agrements?q=${enc(p('query'))}`,
				fields: [
					{
						name: 'query',
						label: 'Name or LEI',
						type: 'string',
						required: true,
						description: 'Entity name or Legal Entity Identifier.',
					},
				],
			},
			{
				value: 'getRegulatorAlerts',
				name: 'Get French Regulator Alerts',
				action: 'Screen a name against regulator blacklists',
				description:
					'French market-authority blacklists (unauthorised investment sites, scams, impersonation) plus crypto-provider and asset-manager registrations. ($0.01).',
				// The API takes `nom` and/or `siren`, never a single catch-all: at
				// least one is required. Two distinct fields are needed because
				// `resourceFields` keeps one property per NAME across the resource,
				// so a shared `query` would inherit another operation's label.
				path: (p) => {
					const q = new URLSearchParams();
					if (p('regulatorName')) q.set('nom', p('regulatorName'));
					if (p('regulatorSiren')) q.set('siren', p('regulatorSiren'));
					if (![...q.keys()].length) {
						throw new Error(
							'Get French Regulator Alerts needs a "Name to Screen" (2 to 100 characters) and/or a "SIREN to Screen" (nine digits).',
						);
					}
					return `/v1/regulateurs/fr/alertes?${q.toString()}`;
				},
				fields: [
					{
						name: 'regulatorName',
						label: 'Name to Screen',
						type: 'string',
						description:
							'Company or website name to screen against the blacklists, 2 to 100 characters. Give this and/or a SIREN.',
					},
					{
						name: 'regulatorSiren',
						label: 'SIREN to Screen',
						type: 'string',
						placeholder: '552032534',
						description:
							'Nine-digit SIREN to screen. Give this and/or a name.',
					},
				],
			},
			{
				value: 'getIndustrialRisks',
				name: 'Get Industrial Risks',
				action: 'Get the industrial risk profile',
				description:
					'Classified facilities from the official register, with Seveso status and a risk synthesis. No classified facility is still a paid, meaningful answer. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/risques-industriels`,
				fields: [SIREN],
			},
			{
				value: 'getLobbying',
				name: 'Get Lobbying Profile',
				action: 'Get the lobbying profile',
				description:
					'Registration with the official register of interest representatives: status, expense brackets, subjects, clients. Organisation-level only, no personal data. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/lobbying`,
				fields: [SIREN],
			},
		],
	},

	{
		value: 'procurement',
		name: 'Public Procurement',
		operations: [
			{
				value: 'getFrench',
				name: 'Get French Contracts',
				action: 'Get French public contracts won',
				description:
					'Public contracts won, from the official French procurement data: buyers, amounts, dates, procedures. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/marches-publics`,
				fields: [SIREN],
			},
			{
				value: 'getEuropean',
				name: 'Get European Contracts',
				action: 'Get European public contracts won',
				description:
					'Award notices from the EU procurement journal: buyer, country, subject, amount, co-winners. Identifier-based matching only, so an empty list is not proof of absence. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/marches-publics-ue`,
				fields: [SIREN],
			},
		],
	},

	{
		value: 'europeanCompany',
		name: 'European Company',
		operations: [
			{
				value: 'search',
				name: 'Search',
				action: 'Search European registers by name',
				description:
					'European company search: company lookup across official European company registers under one schema, plus worldwide LEI coverage. ($0.003).',
				path: (p) =>
					`/v1/eu/recherche?q=${enc(p('query'))}${p('searchCountry') ? `&pays=${enc(p('searchCountry'))}` : ''}`,
				fields: [
					{
						name: 'searchCountry',
						label: 'Country Filter',
						type: 'options',
						default: '',
						description:
							'Restrict the search to one national register. Leave empty to search the pre-loaded registers plus worldwide LEI — but note that Czechia, Switzerland, Denmark, Finland, Poland, Slovakia and the United Kingdom are queried LIVE and are only searched by name when their country is selected here.',
						options: [
							{ name: 'All (Pre-Loaded Registers + LEI)', value: '' },
							{ name: 'Belgium', value: 'BE' },
							{ name: 'Czechia', value: 'CZ' },
							{ name: 'Denmark', value: 'DK' },
							{ name: 'Estonia', value: 'EE' },
							{ name: 'Finland', value: 'FI' },
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Norway', value: 'NO' },
							{ name: 'Poland', value: 'PL' },
							{ name: 'Slovakia', value: 'SK' },
							{ name: 'Spain', value: 'ES' },
							{ name: 'Sweden', value: 'SE' },
							{ name: 'Switzerland', value: 'CH' },
							{ name: 'United Kingdom', value: 'GB' },
						],
					},
					{
						name: 'query',
						label: 'Company Name',
						type: 'string',
						required: true,
						description: 'Company name to search across European registers.',
					},
				],
			},
			{
				value: 'get',
				name: 'Get Profile',
				action: 'Get a company from a national register',
				description:
					'Company profile from an official register, same JSON schema for every country. ($0.01).',
				path: (p) => `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}`,
				fields: [COUNTRY, NATIONAL_ID],
				notFoundIsEmpty: true,
			},
			{
				value: 'listFilings',
				name: 'List Annual Filings',
				action: 'List the annual account filings',
				description:
					'Published annual accounts for a European company. Belgium and Finland return the list of filings to fetch one by one; Norway, Latvia, Estonia and Sweden return the figures directly; Denmark, Slovakia and the United Kingdom return the available financial years. Czechia, Poland and Switzerland are NOT covered by this route. Price depends on the country: $0.01 (BE, FI, DK, SK, GB), $0.02 (EE, NO), $0.03 (LV, SE) — set Max Amount Per Call to at least $0.03.',
				path: (p) => {
					const servis = ['BE', 'DK', 'EE', 'FI', 'LV', 'NO', 'SE', 'SK', 'GB'];
					if (!servis.includes(p('country'))) {
						throw new Error(
							`Annual accounts are not served for ${p('country')}. Countries covered: ${servis.join(', ')}.`,
						);
					}
					return `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/comptes`;
				},
				fields: [
					COUNTRY,
					NATIONAL_ID,
				],
			},
			{
				value: 'getFiling',
				name: 'Get Annual Filing',
				action: 'Get one annual account filing',
				description:
					'One annual-account filing in full. Only the countries that serve filings one by one have this route: Belgium and Finland (by filing reference, $0.15), Denmark and the United Kingdom (by closing date, $0.05), Slovakia (by reference, $0.03). For Norway, Latvia, Estonia and Sweden, List Annual Filings already returns the figures. A Belgian filing older than April 2022 comes back as the original PDF, attached as binary data.',
				path: (p) => {
					const servis = ['BE', 'DK', 'FI', 'SK', 'GB'];
					if (!servis.includes(p('country'))) {
						throw new Error(
							`${p('country')} does not serve filings one by one. Countries covered: ${servis.join(', ')} — for the others, List Annual Filings already returns the figures.`,
						);
					}
					return `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/comptes/${enc(p('filingReference'))}`;
				},
				fields: [
					COUNTRY,
					NATIONAL_ID,
					{
						name: 'filingReference',
						label: 'Filing Reference',
						type: 'string',
						required: true,
						description:
							'Reference returned by List Annual Filings — a filing reference for Belgium, Finland and Slovakia, a closing date (YYYY-MM-DD) for Denmark and the United Kingdom.',
					},
				],
			},
			{
				value: 'getInsiderTransactions',
				name: 'Get Insider Transactions',
				action: 'Get insider dealing at a listed company',
				description:
					'Are the managers of this listed company buying or selling? Issuer-level aggregate over 12 rolling months. No individual is ever named. Belgium only. ($0.02).',
				path: (p) => {
					if (p('country') !== 'BE') {
						throw new Error(
							'Get Insider Transactions covers Belgium only (FSMA filings by listed companies). Other countries have no such register on this route.',
						);
					}
					return `/v1/eu/entreprise/BE/${enc(p('companyId'))}/transactions-dirigeants`;
				},
				fields: [COUNTRY, NATIONAL_ID],
				notFoundIsEmpty: true,
			},
		],
	},

	{
		value: 'people',
		name: 'Officers and Prospecting',
		operations: [
			{
				value: 'searchDirectors',
				name: 'Search Officers',
				action: 'Search company officers by name',
				description:
					'Reverse search for company directors and officers in France: find the mandates held by a person, by name. ($0.02).',
				path: (p) => `/v1/dirigeant/recherche?nom=${enc(p('name'))}`,
				fields: [
					{
						name: 'name',
						label: 'Officer Name',
						type: 'string',
						required: true,
						description: 'Family name of the officer to look up.',
					},
				],
			},
			{
				value: 'prospect',
				name: 'Prospect Companies',
				action: 'Build a prospect list',
				description:
					'Build a list of companies by activity code, location and headcount, 100 per page. ($0.02 per page).',
				path: (p) => {
					const q = new URLSearchParams();
					// Left-hand values are the API's query-string keys, right-hand ones
					// are this node's field names.
					for (const [key, field] of [
						['naf', 'nafCode'],
						['departement', 'department'],
						['effectif_min', 'workforceMin'],
						['effectif_max', 'workforceMax'],
						['page', 'page'],
					] as const) {
						const v = p(field);
						if (v) q.set(key, v);
					}
					return `/v1/prospection?${q.toString()}`;
				},
				fields: [
					{
						name: 'nafCode',
						label: 'Activity Code (NAF)',
						type: 'string',
						placeholder: '62.01Z',
						description: 'French activity code to filter on.',
					},
					{
						name: 'department',
						label: 'Department',
						type: 'string',
						placeholder: '69',
						description: 'French department number to filter on.',
					},
					{
						name: 'workforceMin',
						label: 'Minimum Headcount',
						type: 'string',
						placeholder: '10',
						description:
							'Keep companies with at least this many employees. A plain number: the API maps it to the official brackets itself.',
					},
					{
						name: 'workforceMax',
						label: 'Maximum Headcount',
						type: 'string',
						placeholder: '250',
						description: 'Keep companies with at most this many employees.',
					},
					{
						// A string, not a number: a numeric field would default to 0,
						// which reads as non-empty and would be sent as page=0 (a 400).
						name: 'page',
						label: 'Page',
						type: 'string',
						placeholder: '2',
						description:
							'Page of results to fetch, 100 per page. The response says whether another page exists; each page is a separate paid call.',
					},
				],
			},
		],
	},

	{
		value: 'monitoring',
		name: 'Monitoring',
		operations: [
			{
				value: 'watch',
				name: 'Watch Companies',
				action: 'Watch companies for changes',
				description:
					'Company monitoring for France: watch one to 100 companies and get notified when something changes — officers, insolvency, deregistration. Point the webhook at an n8n Webhook node to trigger a workflow; the URL must be public HTTPS on port 443 (a localhost or private address is refused), so give an e-mail digest instead on a self-hosted instance. Detection is daily, aligned on how often the official sources publish. ($0.05 PER TARGET for 30 days, so $5.00 for 100 — set Max Amount Per Call accordingly).',
				path: (p) => {
					if (!p('webhook') && !p('email')) {
						throw new Error(
							'Watch Companies needs a Webhook URL or an Email address: without one there is no way to receive the events, and the watch is paid for nothing. On a self-hosted n8n the webhook must be public HTTPS on port 443 — use the e-mail digest instead.',
						);
					}
					const q = new URLSearchParams({ cibles: p('targets') });
					if (p('webhook')) q.set('webhook', p('webhook'));
					if (p('email')) q.set('email', p('email'));
					return `/v1/surveillance/creer?${q.toString()}`;
				},
				fields: [
					{
						name: 'targets',
						label: 'Targets',
						type: 'string',
						required: true,
						placeholder: '552032534,542065479',
						description:
							'One to 100 comma-separated entries: nine-digit SIRENs, or "dirigeant:Name" to follow the mandates of a person.',
					},
					{
						name: 'webhook',
						label: 'Webhook URL',
						type: 'string',
						description:
							'Public HTTPS URL notified when something changes. Paste the Production URL of an n8n Webhook node to trigger a workflow.',
					},
					{
						name: 'email',
						label: 'Email',
						type: 'string',
						placeholder: 'name@email.com',
						description: 'Optional address for digest emails.',
					},
				],
			},
			{
				value: 'getWatch',
				name: 'Get Watch',
				action: 'Read the state and events of a watch',
				description:
					'State of a watch and its 100 most recent events, by token. FREE — this route is not metered, so it costs nothing and needs no payment. Use it to pull the events when a webhook cannot reach your instance.',
				path: (p) => `/v1/surveillance/${enc(p('watchToken'))}`,
				fields: [
					{
						name: 'watchToken',
						label: 'Watch Token',
						type: 'string',
						required: true,
						typeOptions: { password: true },
						description: 'Token returned when the watch was created.',
					},
				],
			},
			{
				value: 'stopWatch',
				name: 'Stop Watch',
				action: 'Stop a watch',
				description: 'Stop a watch before its expiry. FREE — this route is not metered.',
				path: (p) => `/v1/surveillance/${enc(p('watchToken'))}/arreter`,
				fields: [
					{
						name: 'watchToken',
						label: 'Watch Token',
						type: 'string',
						required: true,
						typeOptions: { password: true },
						description: 'Token returned when the watch was created.',
					},
				],
			},
			{
				value: 'renew',
				name: 'Renew Watch',
				action: 'Renew an existing watch',
				description:
					'Extend a watchlist for another period. Grace period of seven days after expiry. ($0.05 per target).',
				// Renewal is priced per target like creation, so the API requires the
				// target list again — and it must be the SAME list, or the renewal
				// is refused. Sending only the token gets a 400 every time.
				path: (p) => {
					const targets = p('targets');
					if (!targets) {
						throw new Error(
							'Renew Watch needs the same "Targets" list the watch was created with (comma-separated) — the API prices the renewal per target and refuses a different list.',
						);
					}
					return `/v1/surveillance/${enc(p('watchToken'))}/renouveler?${new URLSearchParams({ cibles: targets }).toString()}`;
				},
				fields: [
					{
						name: 'watchToken',
						label: 'Watch Token',
						type: 'string',
						required: true,
						typeOptions: { password: true },
						description: 'Token returned when the watch was created.',
					},
					// Declared so the shared "Targets" field is also shown for this
					// operation; the definition above (Create Watch) is the one used.
					{
						name: 'targets',
						label: 'Targets',
						type: 'string',
						required: true,
						placeholder: '552032534,542065479',
						description:
							'The same comma-separated target list the watch was created with.',
					},
				],
			},
		],
	},
];

/** Looks up an operation. Returns null rather than throwing: the caller decides. */
export function findOperation(resource: string, operation: string): Operation | null {
	return (
		RESOURCES.find((r) => r.value === resource)?.operations.find((o) => o.value === operation) ??
		null
	);
}
