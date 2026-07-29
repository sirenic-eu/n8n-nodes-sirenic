/**
 * Catalogue des opérations — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Les propriétés du node (ressources, opérations, champs) ET la construction
 * des URL sont dérivées de cette table. Ajouter une route se fait donc à un
 * seul endroit, sans risque de voir l'interface et le routage diverger — le
 * genre d'écart qui ne se voit qu'en production.
 *
 * Le PRIX figure dans chaque description parce qu'un node qui dépense l'argent
 * de l'utilisateur doit le dire avant qu'il clique, pas après.
 */

/** Un paramètre saisi par l'utilisateur. */
export interface Champ {
	nom: string;
	libelle: string;
	type: 'string' | 'number' | 'options';
	requis?: boolean;
	defaut?: string | number;
	placeholder?: string;
	description: string;
	options?: Array<{ name: string; value: string }>;
}

export interface Operation {
	valeur: string;
	nom: string;
	action: string;
	description: string;
	/** Fonction de chemin : reçoit un lecteur de paramètre, rend le chemin API. */
	chemin: (p: (nom: string) => string) => string;
	champs?: Champ[];
}

export interface Ressource {
	valeur: string;
	nom: string;
	operations: Operation[];
}

const enc = encodeURIComponent;

/** Champ SIREN, réutilisé par la vingtaine d'opérations françaises. */
const SIREN: Champ = {
	nom: 'siren',
	libelle: 'SIREN',
	type: 'string',
	requis: true,
	placeholder: '552032534',
	description: 'Nine-digit French company identifier.',
};

const PAYS: Champ = {
	nom: 'country',
	libelle: 'Country',
	type: 'options',
	defaut: 'BE',
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
		{ name: 'Switzerland', value: 'CH' },
		{ name: 'United Kingdom', value: 'GB' },
	],
};

const ID_NATIONAL: Champ = {
	nom: 'companyId',
	libelle: 'Company Identifier',
	type: 'string',
	requis: true,
	description: 'National registration number, as used by that country register.',
};

export const RESSOURCES: Ressource[] = [
	{
		valeur: 'frenchCompany',
		nom: 'French Company',
		operations: [
			{
				valeur: 'search',
				nom: 'Search',
				action: 'Search companies by name',
				description:
					'Find a company by name when you do not have its SIREN. Returns the top matches with a 0-1 confidence score. ($0.001).',
				chemin: (p) => `/v1/recherche?q=${enc(p('query'))}`,
				champs: [
					{
						nom: 'query',
						libelle: 'Company Name',
						type: 'string',
						requis: true,
						description: 'Company name, or a nine-digit SIREN.',
					},
				],
			},
			{
				valeur: 'getProfile',
				nom: 'Get Profile',
				action: 'Get a company profile',
				description:
					'Official profile by SIREN: legal name, form, head office, activity code, workforce, officers, VAT number. ($0.005).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}`,
				champs: [SIREN],
			},
			{
				valeur: 'getEstablishments',
				nom: 'Get Establishments',
				action: 'List the establishments of a company',
				description: 'Every establishment (SIRET) with address and status. ($0.003).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/etablissements`,
				champs: [SIREN],
			},
			{
				valeur: 'getChanges',
				nom: 'Get Changes',
				action: 'Get recent changes of a company',
				description: 'Recent registry changes: name, address, officers, activity. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/changements`,
				champs: [SIREN],
			},
			{
				valeur: 'getCapital',
				nom: 'Get Capital Structure',
				action: 'Get the shareholders of a company',
				description:
					'Shareholders extracted by AI from the public articles of association. Legal entities and individuals as filed — never a beneficial-ownership register. ($0.35).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/capital`,
				champs: [SIREN],
			},
			{
				valeur: 'getCapitalLinks',
				nom: 'Get Capital Links',
				action: 'Get one level of capital links',
				description:
					'Single-level capital links between legal entities, both upstream and downstream. ($2.00).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/liens-capitalistiques`,
				champs: [SIREN],
			},
			{
				valeur: 'getIntellectualProperty',
				nom: 'Get Intellectual Property',
				action: 'Get patents and trademarks',
				description:
					'Patents, trademarks, designs and models from the INPI registry. Inventor names are never returned. ($0.03).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/pi`,
				champs: [SIREN],
			},
			{
				valeur: 'listDocuments',
				nom: 'List Documents',
				action: 'List the filed documents of a company',
				description: 'Deeds and annual accounts filed with the registry, with their references. ($0.02).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/documents`,
				champs: [SIREN],
			},
			{
				valeur: 'downloadDocument',
				nom: 'Download Document',
				action: 'Download a filed document',
				description: 'One filed document as a PDF, by type and identifier. ($0.10).',
				chemin: (p) => `/v1/documents/${enc(p('documentType'))}/${enc(p('documentId'))}`,
				champs: [
					{
						nom: 'documentType',
						libelle: 'Document Type',
						type: 'options',
						defaut: 'actes',
						description: 'Kind of document to download.',
						options: [
							{ name: 'Deeds', value: 'actes' },
							{ name: 'Annual Accounts', value: 'bilans' },
						],
					},
					{
						nom: 'documentId',
						libelle: 'Document ID',
						type: 'string',
						requis: true,
						description: 'Identifier returned by List Documents.',
					},
				],
			},
		],
	},

	{
		valeur: 'dueDiligence',
		nom: 'Due Diligence',
		operations: [
			{
				valeur: 'getKyb',
				nom: 'Get KYB File',
				action: 'Get a full KYB file',
				description:
					'Everything needed to onboard a supplier in one call: identity, officers, insolvency alerts, filed financials, sanctions screening, computed VAT number. ($0.15).',
				chemin: (p) => `/v1/kyb/${enc(p('siren'))}`,
				champs: [SIREN],
			},
			{
				valeur: 'getKybBatch',
				nom: 'Get KYB Batch',
				action: 'Get KYB files for a list of companies',
				description:
					'Two to 100 KYB files in one call, billed per company at 30% off the unit price. Built for onboarding a supplier catalogue. ($0.105 per company).',
				chemin: (p) => `/v1/kyb/batch?sirens=${enc(p('sirens'))}`,
				champs: [
					{
						nom: 'sirens',
						libelle: 'SIRENs',
						type: 'string',
						requis: true,
						placeholder: '552032534,542065479',
						description: 'Two to 100 comma-separated nine-digit SIRENs.',
					},
				],
			},
			{
				valeur: 'getIntelligence',
				nom: 'Get Intelligence Report',
				action: 'Get a go or no go intelligence report',
				description:
					'The flagship due-diligence call: every block cross-referenced, closed-list signals traced to their register, and a deterministic verdict. Use it for a credit, investment or partnership decision. ($1.00).',
				chemin: (p) => `/v1/intelligence/${enc(p('siren'))}`,
				champs: [SIREN],
			},
			{
				valeur: 'getReport',
				nom: 'Get PDF Report',
				action: 'Get a company report as a PDF',
				description: 'A readable company report as a PDF document. ($0.50).',
				chemin: (p) => `/v1/rapport/${enc(p('siren'))}`,
				champs: [SIREN],
			},
			{
				valeur: 'getFailureScore',
				nom: 'Get Failure Score',
				action: 'Get the failure risk score',
				description:
					'Deterministic 12-month failure-risk score with every component shown: no AI, no black box. ($0.10).',
				chemin: (p) => `/v1/score/defaillance/${enc(p('siren'))}`,
				champs: [SIREN],
			},
			{
				valeur: 'getLegalAlerts',
				nom: 'Get Legal Alerts',
				action: 'Get insolvency and legal alerts',
				description:
					'Official gazette announcements: insolvency proceedings, deregistrations, sales and transfers. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/alertes`,
				champs: [SIREN],
			},
			{
				valeur: 'getHealthSummary',
				nom: 'Get Health Summary',
				action: 'Get an AI business health summary',
				description:
					'Plain-language business-health summary written by AI from official data only: strengths, warning signs, activity trend. Cached seven days. ($0.15).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/sante`,
				champs: [SIREN],
			},
		],
	},

	{
		valeur: 'financials',
		nom: 'Financials',
		operations: [
			{
				valeur: 'getFinancials',
				nom: 'Get Financials',
				action: 'Get filed annual financials',
				description:
					'Filed annual figures and ratios, one entry per fiscal year. Each response states whether the figures are statutory or consolidated accounts, and flags series where the official source conflates the two. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/finances`,
				champs: [SIREN],
			},
			{
				valeur: 'getAccountsPdf',
				nom: 'Get Accounts Annexe',
				action: 'Get the annexe notes of the annual accounts',
				description:
					'Structured annexe notes extracted by AI from the filed accounts document. Cached permanently. ($2.00).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/comptes-pdf`,
				champs: [SIREN],
			},
			{
				valeur: 'getSectorBenchmarks',
				nom: 'Get Sector Benchmarks',
				action: 'Get benchmarks for an activity code',
				description:
					'Sector aggregates for a French activity code: company count, median age, workforce spread, and median revenue and margins when enough companies file accounts. Place a company against its peers. ($0.05).',
				chemin: (p) => `/v1/secteur/${enc(p('nafCode'))}/benchmarks`,
				champs: [
					{
						nom: 'nafCode',
						libelle: 'Activity Code (NAF)',
						type: 'string',
						requis: true,
						placeholder: '68.20B',
						description: 'French activity code at any level: 68, 68.2, 68.20 or 68.20B.',
					},
				],
			},
		],
	},

	{
		valeur: 'compliance',
		nom: 'Compliance',
		operations: [
			{
				valeur: 'screenSanctions',
				nom: 'Screen Sanctions',
				action: 'Screen a name against sanctions lists',
				description:
					'Screen a person or company name against six official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO). Scored matches, never a bare yes or no. ($0.02).',
				chemin: (p) =>
					`/v1/sanctions/check?name=${enc(p('name'))}${p('birthYear') ? `&birth_year=${enc(p('birthYear'))}` : ''}`,
				champs: [
					{
						nom: 'name',
						libelle: 'Name to Screen',
						type: 'string',
						requis: true,
						description: 'Person or company name to screen.',
					},
					{
						nom: 'birthYear',
						libelle: 'Birth Year',
						type: 'string',
						description: 'Optional birth year, to narrow down homonyms on individuals.',
					},
				],
			},
			{
				valeur: 'getLicences',
				nom: 'Get Regulatory Licences',
				action: 'Check whether a company is licensed',
				description:
					'Is this counterparty actually authorised to do what it claims? Payment institution, e-money, account information, insurer or telecom operator, from the EBA, EIOPA and ARCEP registers. Not authorised is a paid answer too. ($0.02).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/agrements`,
				champs: [SIREN],
			},
			{
				valeur: 'getEuAuthorisations',
				nom: 'Search EU Financial Authorisations',
				action: 'Search EU financial authorisations',
				description:
					'Around 14,000 MiFID-regulated entities across the EEA from the ESMA registers, by name or LEI. ($0.01).',
				chemin: (p) => `/v1/eu/agrements?q=${enc(p('query'))}`,
				champs: [
					{
						nom: 'query',
						libelle: 'Name or LEI',
						type: 'string',
						requis: true,
						description: 'Entity name or Legal Entity Identifier.',
					},
				],
			},
			{
				valeur: 'getRegulatorAlerts',
				nom: 'Get French Regulator Alerts',
				action: 'Screen a name against regulator blacklists',
				description:
					'French market-authority blacklists (unauthorised investment sites, scams, impersonation) plus crypto-provider and asset-manager registrations. ($0.01).',
				chemin: (p) => `/v1/regulateurs/fr/alertes?q=${enc(p('query'))}`,
				champs: [
					{
						nom: 'query',
						libelle: 'Name or SIREN',
						type: 'string',
						requis: true,
						description: 'Name or nine-digit SIREN to screen.',
					},
				],
			},
			{
				valeur: 'getIndustrialRisks',
				nom: 'Get Industrial Risks',
				action: 'Get the industrial risk profile',
				description:
					'Classified facilities from the official register, with Seveso status and a risk synthesis. No classified facility is still a paid, meaningful answer. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/risques-industriels`,
				champs: [SIREN],
			},
			{
				valeur: 'getLobbying',
				nom: 'Get Lobbying Profile',
				action: 'Get the lobbying profile',
				description:
					'Registration with the official register of interest representatives: status, expense brackets, subjects, clients. Organisation-level only, no personal data. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/lobbying`,
				champs: [SIREN],
			},
		],
	},

	{
		valeur: 'procurement',
		nom: 'Public Procurement',
		operations: [
			{
				valeur: 'getFrench',
				nom: 'Get French Contracts',
				action: 'Get French public contracts won',
				description:
					'Public contracts won, from the official French procurement data: buyers, amounts, dates, procedures. ($0.01).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/marches-publics`,
				champs: [SIREN],
			},
			{
				valeur: 'getEuropean',
				nom: 'Get European Contracts',
				action: 'Get European public contracts won',
				description:
					'Award notices from the EU procurement journal: buyer, country, subject, amount, co-winners. Identifier-based matching only, so an empty list is not proof of absence. ($0.02).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/marches-publics-ue`,
				champs: [SIREN],
			},
		],
	},

	{
		valeur: 'europeanCompany',
		nom: 'European Company',
		operations: [
			{
				valeur: 'search',
				nom: 'Search',
				action: 'Search European registers by name',
				description:
					'Search official registers across Europe under one schema, plus worldwide LEI coverage. ($0.003).',
				chemin: (p) => `/v1/eu/recherche?q=${enc(p('query'))}`,
				champs: [
					{
						nom: 'query',
						libelle: 'Company Name',
						type: 'string',
						requis: true,
						description: 'Company name to search across European registers.',
					},
				],
			},
			{
				valeur: 'get',
				nom: 'Get Profile',
				action: 'Get a company from a national register',
				description:
					'Company profile from an official register, same JSON schema for every country. ($0.01).',
				chemin: (p) => `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}`,
				champs: [PAYS, ID_NATIONAL],
			},
			{
				valeur: 'listFilings',
				nom: 'List Annual Filings',
				action: 'List the annual account filings',
				description:
					'Every published annual-account filing with its reference and metadata. Belgium only, ten-digit enterprise number. ($0.01).',
				chemin: (p) => `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/comptes`,
				champs: [PAYS, ID_NATIONAL],
			},
			{
				valeur: 'getFiling',
				nom: 'Get Annual Filing',
				action: 'Get one annual account filing',
				description:
					'One annual-account filing in full, as structured data or as the original document. ($0.15).',
				chemin: (p) =>
					`/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/comptes/${enc(p('filingReference'))}`,
				champs: [
					PAYS,
					ID_NATIONAL,
					{
						nom: 'filingReference',
						libelle: 'Filing Reference',
						type: 'string',
						requis: true,
						description: 'Reference returned by List Annual Filings.',
					},
				],
			},
			{
				valeur: 'getInsiderTransactions',
				nom: 'Get Insider Transactions',
				action: 'Get insider dealing at a listed company',
				description:
					'Are the managers of this listed company buying or selling? Issuer-level aggregate over 12 rolling months. No individual is ever named. Belgium only. ($0.02).',
				chemin: (p) =>
					`/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/transactions-dirigeants`,
				champs: [PAYS, ID_NATIONAL],
			},
		],
	},

	{
		valeur: 'invoicing',
		nom: 'Invoicing',
		operations: [
			{
				valeur: 'getFrenchPack',
				nom: 'Get French Invoicing Pack',
				action: 'Get everything needed to invoice a French company',
				description:
					'E-invoicing preparation plus a live VAT check, an IBAN and bank check, and a deterministic ready-to-invoice verdict. ($0.03).',
				chemin: (p) =>
					`/v1/facturation/dossier?siren=${enc(p('siren'))}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				champs: [
					SIREN,
					{
						nom: 'iban',
						libelle: 'IBAN',
						type: 'string',
						description: 'Optional IBAN to check alongside the company.',
					},
				],
			},
			{
				valeur: 'getEuPack',
				nom: 'Get European Invoicing Pack',
				action: 'Get everything needed to invoice a European company',
				description:
					'The same invoicing pack for a European counterparty, by country and national identifier. ($0.03).',
				chemin: (p) =>
					`/v1/eu/facturation/dossier?pays=${enc(p('country'))}&id=${enc(p('companyId'))}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				champs: [
					PAYS,
					ID_NATIONAL,
					{
						nom: 'iban',
						libelle: 'IBAN',
						type: 'string',
						description: 'Optional IBAN to check alongside the company.',
					},
				],
			},
			{
				valeur: 'prepareEInvoicing',
				nom: 'Prepare E-Invoicing',
				action: 'Prepare e invoicing data for a company',
				description:
					'Preparation data for the French e-invoicing mandate: identity, computed VAT number, establishments, indicative obligation dates. Preparation only — Sirenic is not an accredited platform and never routes invoices. ($0.02).',
				chemin: (p) => `/v1/entreprise/${enc(p('siren'))}/facturation-prep`,
				champs: [SIREN],
			},
			{
				valeur: 'verifyVat',
				nom: 'Verify VAT Number',
				action: 'Verify an EU VAT number',
				description: 'Check an intra-EU VAT number against the European VIES service. ($0.003).',
				chemin: (p) => `/v1/tva/verifier/${enc(p('vatNumber'))}`,
				champs: [
					{
						nom: 'vatNumber',
						libelle: 'VAT Number',
						type: 'string',
						requis: true,
						placeholder: 'FR12345678901',
						description: 'Intra-EU VAT number, country prefix included.',
					},
				],
			},
			{
				valeur: 'verifyIban',
				nom: 'Verify IBAN',
				action: 'Verify an IBAN and identify the bank',
				description:
					'Structure check plus bank identification. Not a Verification of Payee. ($0.005).',
				chemin: (p) => `/v1/iban/verifier/${enc(p('iban'))}`,
				champs: [
					{
						nom: 'iban',
						libelle: 'IBAN',
						type: 'string',
						requis: true,
						placeholder: 'FR7630006000011234567890189',
						description: 'IBAN to check.',
					},
				],
			},
		],
	},

	{
		valeur: 'people',
		nom: 'Officers and Prospecting',
		operations: [
			{
				valeur: 'searchDirectors',
				nom: 'Search Officers',
				action: 'Search company officers by name',
				description:
					'Find the mandates held by a company officer, by name. ($0.02).',
				chemin: (p) => `/v1/dirigeant/recherche?nom=${enc(p('name'))}`,
				champs: [
					{
						nom: 'name',
						libelle: 'Officer Name',
						type: 'string',
						requis: true,
						description: 'Family name of the officer to look up.',
					},
				],
			},
			{
				valeur: 'prospect',
				nom: 'Prospect Companies',
				action: 'Build a prospect list',
				description:
					'Build a list of companies by activity code, location, size and age. ($0.02).',
				chemin: (p) => {
					const q = new URLSearchParams();
					for (const [cle, champ] of [
						['naf', 'nafCode'],
						['departement', 'department'],
						['tranche_effectif', 'workforce'],
					] as const) {
						const v = p(champ);
						if (v) q.set(cle, v);
					}
					return `/v1/prospection?${q.toString()}`;
				},
				champs: [
					{
						nom: 'nafCode',
						libelle: 'Activity Code (NAF)',
						type: 'string',
						placeholder: '62.01Z',
						description: 'French activity code to filter on.',
					},
					{
						nom: 'department',
						libelle: 'Department',
						type: 'string',
						placeholder: '69',
						description: 'French department number to filter on.',
					},
					{
						nom: 'workforce',
						libelle: 'Workforce Bracket',
						type: 'string',
						description: 'Official workforce bracket code to filter on.',
					},
				],
			},
		],
	},

	{
		valeur: 'monitoring',
		nom: 'Monitoring',
		operations: [
			{
				valeur: 'watch',
				nom: 'Watch Companies',
				action: 'Watch companies for changes',
				description:
					'Monitor one to 100 companies and get notified when something changes: officers, insolvency, deregistration. Point the webhook at an n8n Webhook node to trigger a workflow. Detection is daily, aligned on how often the official sources publish. ($0.05).',
				chemin: (p) => {
					const q = new URLSearchParams({ cibles: p('targets') });
					if (p('webhook')) q.set('webhook', p('webhook'));
					if (p('email')) q.set('email', p('email'));
					return `/v1/surveillance/creer?${q.toString()}`;
				},
				champs: [
					{
						nom: 'targets',
						libelle: 'Targets',
						type: 'string',
						requis: true,
						placeholder: '552032534,542065479',
						description:
							'One to 100 comma-separated entries: nine-digit SIRENs, or "dirigeant:Name" to follow the mandates of a person.',
					},
					{
						nom: 'webhook',
						libelle: 'Webhook URL',
						type: 'string',
						description:
							'Public HTTPS URL notified when something changes. Paste the Production URL of an n8n Webhook node to trigger a workflow.',
					},
					{
						nom: 'email',
						libelle: 'Email',
						type: 'string',
						placeholder: 'name@email.com',
						description: 'Optional address for digest emails.',
					},
				],
			},
			{
				valeur: 'renew',
				nom: 'Renew Watch',
				action: 'Renew an existing watch',
				description:
					'Extend a watchlist for another period. Grace period of seven days after expiry. ($0.05 per target).',
				chemin: (p) => `/v1/surveillance/${enc(p('watchToken'))}/renouveler`,
				champs: [
					{
						nom: 'watchToken',
						libelle: 'Watch Token',
						type: 'string',
						requis: true,
						description: 'Token returned when the watch was created.',
					},
				],
			},
		],
	},
];

/** Retrouve une opération. Renvoie null plutôt que de lever : l'appelant décide. */
export function trouverOperation(ressource: string, operation: string): Operation | null {
	return (
		RESSOURCES.find((r) => r.valeur === ressource)?.operations.find(
			(o) => o.valeur === operation,
		) ?? null
	);
}
