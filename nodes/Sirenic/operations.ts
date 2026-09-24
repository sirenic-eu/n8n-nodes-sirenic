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
 * `entreprise`, `pays`…) are the upstream Sirenic API's own names.
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

const RNA: Field = {
	name: 'rna',
	label: 'RNA Number',
	type: 'string',
	required: true,
	placeholder: 'W751004076',
	description:
		'French association identifier: W followed by nine characters. Use Search Associations when you only have a name.',
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
					'Verify a European supplier before payment, by country and national identifier: registry identity, VAT checked against VIES, Peppol reachability for Belgium (B2B mandate live since 1 January 2026) and, in Poland, whether the IBAN is declared by that taxpayer in the official White List (paying more than 15,000 PLN into an undeclared account costs the buyer the VAT deduction and creates joint liability for the VAT). Same deterministic verdict, closed-list reasons. ($0.03).',
				path: (p) =>
					`/v1/eu/facturation/dossier?pays=${enc(p('country'))}&id=${enc(p('companyId'))}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				fields: [
					{
						name: 'country',
						label: 'Country',
						type: 'options',
						default: 'BE',
						description:
							'Country covered by this verification pack. Belgium and Poland only: the other registers do not expose what an invoicing check needs.',
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
							'Belgium: the ten-digit enterprise number. Poland: the NIP (ten-digit tax number), NOT the KRS, which would silently produce a wrong blocking verdict because VAT and the White List are keyed on the NIP.',
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
					'Preparation data for the French e-invoicing mandate of 1 September 2026 (reception obligatory for every company; issuance phased, large and mid-size companies from 2026, SMEs from 1 September 2027): identity, computed intra-EU VAT number, establishments, indicative obligation dates. Preparation only: Sirenic is not an accredited platform (PDP), never accesses the central directory and never issues or routes invoices. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/facturation-prep`,
				fields: [SIREN],
			},
			{
				value: 'verifyVat',
				name: 'Verify VAT Number',
				action: 'Verify an EU VAT number before invoicing',
				description:
					'Check an intra-EU VAT number against the official VIES service: the tax half of verifying a supplier before payment, and a required check under the French e-invoicing mandate of 1 September 2026. Valid, invalid or unavailable, with the VIES consultation identifier as proof. ($0.003).',
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
					'IBAN check against official registries, to verify a supplier before payment: ISO 13616 and mod-97 structure check, then bank identification from official sources. Explicitly NOT a payee verification: the account holder name is never checked. ($0.005).',
				// Same normalisation: IBANs are usually copied in groups of four.
				path: (p) => {
					const iban = p('iban').replace(/[\s.-]/g, '').toUpperCase();
					if (!iban) {
						throw new Error('Verify IBAN needs an IBAN: the field is optional on the verification packs, but required here.');
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
					/**
			 * Deterministic cross-check of what an invoice prints — neither a tax-compliance opinion nor a
			 * Verification of Payee: the bank leg checks IBAN form and identifies the bank, never the
			 * account's existence nor the holder's name, so a valid-but-substituted IBAN is not detectable
			 * here. A VIES outage yields the verdict `inverifiable`, never a false `incoherent` — an
			 * unavailable check is not a failed one, and `non_verifie` names what was never checked. A 404
			 * means no diffusible company for this SIREN: a non-diffusible record is absent from the
			 * answer without being absent from the register, so the absence is not a measured absence. No
			 * personal data beyond what the public filings state. Source: INSEE Sirene (Licence Ouverte /
			 * Etalab 2.0), VIES (European Commission) and official bank registries.
			 */
			{
				value: 'verifyInvoice',
				name: 'Verify Invoice',
				action: 'Verify the identifiers printed on an invoice',
				description:
					'Cross-checks the identifiers printed on a French invoice in one call: the SIREN against INSEE Sirene (existence, status, live), the invoice VAT number against the one computed from the SIREN and live against VIES, and the IBAN form with its bank, for a coherent/incoherent/inverifiable verdict. ($0.02).',
				path: (p) => `/v1/facture/verifier?siren=${enc(p('siren'))}${p('tva') ? `&tva=${enc(p('tva'))}` : ''}${p('iban') ? `&iban=${enc(p('iban'))}` : ''}`,
				fields: [
					SIREN,
					{
						name: 'tva',
						label: 'VAT Number on the Invoice',
						type: 'string',
						default: '',
						placeholder: 'FR27552032534',
						description: 'VAT number printed on the invoice, cross-checked against the one computed from the SIREN and live against VIES; give this and/or an IBAN, the API refuses a call with neither.',
					},
					{
						name: 'iban',
						label: 'IBAN',
						type: 'string',
						default: '',
						placeholder: 'FR7630006000011234567890189',
						description: 'The supplier\'s bank account: optional on the verification packs and on Verify Invoice, where it adds the form and bank check, required by Verify IBAN; on this operation give it and/or a VAT number.',
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
				value: 'suggest',
				name: 'Suggest Names (Free)',
				action: 'Suggest company names for free',
				description:
					'FREE, no payment at all: type the start of a French company name and get up to five matches with SIREN, city, postcode, activity code and active/ceased status. Use it to turn a name into the SIREN every other operation needs. Matches the start of the registered name, then whole words; no typo tolerance and no confidence score; for those, use Search ($0.002). (Free).',
				path: (p) => `/v1/suggestions?q=${enc(p('query'))}`,
				fields: [
					{
						name: 'query',
						label: 'Company Name',
						type: 'string',
						required: true,
						placeholder: 'carrefour',
						description:
							'Start of the company name (at least three characters), or a nine-digit SIREN.',
					},
				],
			},
			{
				value: 'search',
				name: 'Search',
				action: 'Search companies by name',
				description:
					'French company search when you do not have the SIREN: company lookup by name in the official French company registry (INSEE Sirene). Returns the top matches with a 0-1 confidence score. Tolerates typos, unlike the free Suggest Names operation. ($0.002).',
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
					'New BODACC announcements published about this company since a given date: insolvency proceedings, removals from the register, sales and transfers, account filings. Poll it on a schedule to monitor a portfolio: an empty list is a normal answer, not an error. ($0.01).',
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
					'Shareholders extracted by AI from the latest public articles of association: share capital, legal form, corporate holders named with role and percentage, natural persons counted with their percentage but never named (GDPR). From filed deeds only, never from an ownership register. ($0.35).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/capital`,
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
					/**
			 * Snapshot computed on demand from France Travail, under 24 hours old, nothing stored.
			 * Postings are counted from the SIREN-keyed employer page when one exists, otherwise by strict
			 * name matching over the company's known locations: in that fallback the count is a floor,
			 * `methode.couverture_complete` is false and `recrute_activement` comes back null — absence
			 * that cannot be proved, not a measured absence of hiring. Aggregated signals only: never
			 * posting texts, recruiter contacts or posting ids, and no natural-person data. Sole
			 * proprietorships and restricted-diffusion companies are not covered (400); France Travail
			 * being unavailable answers 503 instead of an empty result.
			 */
			{
				value: 'getHiringSignals',
				name: 'Get Hiring Signals',
				action: 'Get hiring signals for a company',
				description:
					'Hiring signals for a French company derived on demand from France Travail data: actively-hiring flag, active-postings count, top ROME occupation families, contract-type mix, share of postings showing a pay amount, plus the Egapro equality index and the INSEE workforce bracket. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/emploi`,
				fields: [SIREN],
			},
		],
	},

	{
		value: 'dueDiligence',
		name: 'Due Diligence',
		operations: [
			{
				value: 'searchBodacc',
				name: 'Search BODACC Announcements',
				action: 'Search BODACC announcements by criteria',
				description:
					'The other direction: not "is THIS company in trouble" but "WHICH companies are". Search the BODACC legal gazette by family (insolvency proceedings, deregistrations, sales, incorporations, accounts filings...), date window and optionally a French department: up to 100 announcements, newest first, each with its SIREN, court and town. Built for scheduled monitoring: run it daily on your department and route what comes out. Two caveats carried by the response: announcements about SOLE TRADERS are excluded (their name is personal data) and counted, and the judgment is served STRUCTURED (its free text is removed everywhere because it names court-appointed administrators with their address). ($0.03).',
				path: (p) =>
					`/v1/bodacc/recherche?famille=${enc(p('famille'))}&depuis=${enc(p('depuis'))}` +
					`${p('jusquA') ? `&jusqu_a=${enc(p('jusquA'))}` : ''}` +
					`${p('departementBodacc') ? `&departement=${enc(p('departementBodacc'))}` : ''}`,
				fields: [
					{
						name: 'famille',
						label: 'Family',
						type: 'options',
						required: true,
						default: 'collective',
						description:
							'Announcement family. These are the upstream BODACC codes, not translations.',
						options: [
							{ name: 'Insolvency Proceedings (Collective)', value: 'collective' },
							{ name: 'Accounts Filings (Largest Family)', value: 'dpc' },
							{ name: 'Deregistrations', value: 'radiation' },
							{ name: 'Sales and Transfers', value: 'vente' },
							{ name: 'Incorporations', value: 'creation' },
							{ name: 'Registrations', value: 'immatriculation' },
							{ name: 'Miscellaneous Changes', value: 'modification' },
							{ name: 'Conciliation Proceedings', value: 'conciliation' },
							{ name: 'Professional Recovery (Sole Traders Only)', value: 'retablissement_professionnel' },
						],
					},
					{
						name: 'depuis',
						label: 'Published Since',
						type: 'string',
						required: true,
						default: '',
						placeholder: '2026-08-04',
						description:
							'Start of the publication window, YYYY-MM-DD. Required: there is no unbounded search. The window may not exceed 366 days.',
					},
					{
						name: 'jusquA',
						label: 'Published Until',
						type: 'string',
						default: '',
						placeholder: '2026-08-11',
						description: 'Optional end of the publication window, YYYY-MM-DD.',
					},
					{
						name: 'departementBodacc',
						label: 'Department',
						type: 'string',
						default: '',
						placeholder: '59',
						description:
							'Optional French department code: 01-95 except 20, 2A, 2B, 971-978. The Corsican 20 is refused (it is 2A/2B, and carries no announcement).',
					},
				],
			},
			{
				value: 'getFile',
				name: 'Get Company File (Pick Blocks)',
				action: 'Get a company file with chosen blocks',
				description:
					'One call instead of ten: the identity base plus only the blocks you ask for. Available blocks: etablissements, alertes_bodacc, finances, marches_publics, marches_publics_ue, lobbying, risques_industriels, agrements, pi, documents, facturation_prep, score. Each block costs exactly what its own operation costs, so grouping never costs more than calling separately, and the total is capped at $0.35. A block that cannot be served is named with its reason. ($0.005 base + per block, max $0.35).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/dossier?blocs=${enc(p('blocs'))}`,
				fields: [
					SIREN,
					{
						name: 'blocs',
						label: 'Blocks',
						type: 'string',
						required: true,
						default: 'finances,score',
						placeholder: 'finances,pi,score',
						description:
							'Comma-separated blocks to add to the identity base. An unknown name returns 400 and nothing is charged.',
					},
				],
			},
			{
				value: 'getKyb',
				name: 'Get KYB File',
				action: 'Get a full KYB file',
				description:
					'KYB (Know Your Business) due diligence, everything needed to onboard a supplier in one call: identity, officers, insolvency alerts, filed financials, sanctions screening, computed VAT number. ($0.15).',
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
					/**
			 * Source: Cour de cassation, Judilibre open data (source juritcom), Licence Ouverte 2.0 —
			 * reuse must keep the attribution. Decisions are linked to the company by RCS/SIREN identifier
			 * and the coverage is partial and measured: 61.8% of decisions carry a usable identifier, so
			 * an empty list is an absence of match, never proof that the company has no litigation. The
			 * response carries the same warning (`exhaustivite`, `avertissement`) and the stock update
			 * date; a stock older than seven days answers 503 rather than a silent under-count. Insolvency
			 * judgments already served by Get Legal Alerts are flagged `redondante_bodacc`. No
			 * natural-person data: sole proprietorships and restricted-diffusion companies are refused
			 * with 400, since a decision is never attached to a natural person.
			 */
			{
				value: 'getLitigation',
				name: 'Get Commercial Court Rulings',
				action: 'Get commercial court rulings',
				description:
					'Commercial-court decisions linked to this SIREN from the Cour de cassation Judilibre open data: court, date, docket number, closed-list nature and role, the other legal entities involved, and the official decision URL. Never a text, a natural person\'s name or an amount. ($0.01).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/contentieux`,
				fields: [SIREN],
			},
			/**
			 * Coverage reserve. A missing ranking is not a tie: the nine rankings (risk, revenue, net
			 * result, EBITDA margin, lowest debt, liquidity, revenue growth, cash vs short-term debt,
			 * seniority) each carry a status in eligibilite_classements, and one forbidden because the
			 * batch is not comparable — amounts across different fiscal years, ratios also across sectors
			 * or sizes, a holding in the batch — is omitted with its reasons rather than computed; the
			 * evaluative risk ranking is served only when the batch is comparable and the ranked scores
			 * rest on the same axes. No overall ranking is ever returned. Accounts are the statutory
			 * (social) scope, so a group compared here is not its consolidated figures. Sanctions
			 * screening targets the legal name only: a match is a name match, not an identification. An
			 * unknown SIREN comes back with trouve=false and still counts as one lookup — it means not
			 * found in the register, not a company without activity. If any company cannot be built the
			 * whole batch returns 503 and the payment is not settled.
			 */
			{
				value: 'compareCompanies',
				name: 'Compare French Companies',
				action: 'Compare two to five french companies side by side',
				description:
					'Compare two to five French companies side by side on official data: identity, deterministic default-risk score, latest filed accounts (statutory scope) and BODACC alerts, with per-axis rankings only, never an overall winner, and a comparabilite block naming why the batch may not be comparable. ($0.12).',
				path: (p) => `/v1/comparer?sirens=${enc(p('sirens'))}`,
				fields: [
					{
						name: 'sirens',
						label: 'SIRENs',
						type: 'string',
						required: true,
						placeholder: '552032534,542065479',
						description: 'Two to five comma-separated nine-digit SIRENs, Luhn-validated and deduplicated before the call.',
					},
				],
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
					/**
			 * Source: Légifrance ACCO fund, company-level texts only — branch-level conventions
			 * collectives are not in scope. An empty list means no text published for the SIRETs searched
			 * (`couverture` states which), not that the company has no agreement: the absence is not a
			 * measured zero. Sole proprietorships (`entreprise_individuelle_non_couverte`) and partially
			 * diffusible companies (`diffusion_partielle_non_couverte`) are refused with a 400 and never
			 * charged, because an agreement is never attached to a natural person; titles that name a
			 * person are masked. Results are capped at 100 texts, `tronque` beyond. A 503
			 * (`legifrance_non_configure`) means Légifrance itself is unavailable, not that there is
			 * nothing to find.
			 */
			{
				value: 'getCollectiveAgreements',
				name: 'Get Collective Agreements',
				action: 'Get company collective agreements',
				description:
					'Company-level collective agreements, amendments and decisions published on Légifrance (ACCO fund): nature, title, DILA themes, signature, effect and end dates, IDCC, signatory unions and official link, with counts and the establishments searched. Metadata only, never the text. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/accords-collectifs`,
				fields: [SIREN],
			},
		],
	},

	{
		value: 'association',
		name: 'Associations (Nonprofits)',
		operations: [
			{
				value: 'searchAssociations',
				name: 'Search Associations',
				action: 'Search French associations by name',
				description:
					'Start here when you only have a name. Trigram search over the French national register of associations (RNA), with optional postal-code, department and position filters. Returns up to 20 matches with a confidence score and the RNA number to feed the two operations below. Covers associations that have no SIREN at all. ($0.002).',
				path: (p) => {
					const q = new URLSearchParams({ q: p('associationQuery') });
					for (const [nom, champ] of [['code_postal', 'associationPostalCode'], ['departement', 'associationDepartment'], ['position', 'associationPosition']] as const) {
						const valeur = p(champ);
						if (valeur) q.set(nom, valeur);
					}
					return `/v1/associations/recherche?${q.toString()}`;
				},
				fields: [
					{
						name: 'associationQuery',
						label: 'Name',
						type: 'string',
						required: true,
						placeholder: 'croix rouge',
						description:
							'Association title, or an RNA number (resolved directly). Unsupported characters are stripped, not rejected.',
					},
					{
						name: 'associationPostalCode',
						label: 'Postal Code',
						type: 'string',
						placeholder: '75014',
						description: 'Optional postal code or prefix (two to five digits) of the registered office.',
					},
					{
						name: 'associationDepartment',
						label: 'Department',
						type: 'string',
						placeholder: '75',
						description: 'Optional department: 01 to 95, 2A, 2B, or 971 to 989. Ignored when a postal code is given.',
					},
					{
						name: 'associationPosition',
						label: 'Position',
						type: 'options',
						default: '',
						description: 'Optional filter on the association position.',
						options: [
							{ name: 'Any', value: '' },
							{ name: 'Active', value: 'active' },
							{ name: 'Dissolved', value: 'dissoute' },
							{ name: 'Deleted', value: 'supprimee' },
						],
					},
				],
			},
			{
				value: 'getAssociationProfile',
				name: 'Get Association Profile',
				action: 'Get an association profile by RNA number',
				description:
					'Official profile of a French association (loi 1901) from the national register: title, purpose, position, creation and declaration dates, registered office, website, RUP number as declared, and the SIREN when the business register confirms it. No officer or declarant data; Alsace-Moselle is out of the register by law. ($0.005).',
				path: (p) => `/v1/association/${enc(p('rna'))}`,
				fields: [RNA],
			},
			{
				value: 'getAssociationNotices',
				name: 'Get Association Official-Journal Notices',
				action: 'Get the official-journal notices of an association',
				description:
					'Creations, changes of title, purpose or registered office, and dissolutions published in the official journal of associations (JOAFE), the association equivalent of the commercial gazette. Carries the loaded coverage window: no notice inside it is a fact, not a gap. ($0.01).',
				path: (p) => `/v1/association/${enc(p('rna'))}/annonces`,
				fields: [RNA],
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
					/**
			 * Coverage: built on the published DECP, where contracts below EUR 40,000 excl. VAT are not
			 * declared — an empty or short competitor list is a gap in publication, not a measured absence
			 * of competition. Segments and rivals are legal persons identified by SIREN; no natural-person
			 * data is returned. A 404 means no diffusible company for this SIREN, and a 503 with code
			 * collecte_en_cours means the anticipation stock is not loaded yet, which is a state of the
			 * service and not an answer about the company.
			 */
			{
				value: 'getCompetitors',
				name: 'Get Procurement Competitors',
				action: 'Get rival contractors on the same procurement segments',
				description:
					'The five main CPV segments of a French company over the last five years and the fifteen largest rival contractors on those segments over the last three years, with contract counts, total amounts and shared segments, from the official French procurement data. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/concurrents-marches`,
				fields: [SIREN],
			},
			/**
			 * Coverage and method: the end date is an estimate, computed from the notification date plus
			 * the duration initially declared, because duration amendments are absent from the DECP source
			 * — a contract may already have been extended. Contracts below EUR 40,000 excl. VAT are not
			 * published at all, so an empty page means nothing published in that window, not nothing
			 * expiring. Incumbent holders are legal persons identified by SIREN; no natural-person data is
			 * returned. A 503 with code collecte_en_cours means the extended DECP re-ingestion has not
			 * completed, nothing is charged, and an immediate retry will not help.
			 */
			{
				value: 'getExpiringContracts',
				name: 'Get Expiring Public Contracts',
				action: 'Get french public contracts expiring within a window',
				description:
					'French public contracts whose estimated end date falls inside a window of up to 24 months, filterable by CPV prefix and department: buyer, incumbent holders, amount, framework-agreement flag, CPV. End dates are estimated from notification plus the duration first declared. ($0.05).',
				path: (p) => `/v1/marches/expirations?fenetre_mois=${enc(p('fenetre_mois'))}&page=${enc(p('page'))}${p('cpv') ? `&cpv=${enc(p('cpv'))}` : ''}${p('departement') ? `&departement=${enc(p('departement'))}` : ''}`,
				fields: [
					{
						name: 'cpv',
						label: 'CPV Prefix',
						type: 'string',
						default: '',
						placeholder: '45',
						description: 'CPV prefix of two to eight digits, 45 being construction works. Leave empty to cover every segment.',
					},
					{
						name: 'departement',
						label: 'Department',
						type: 'string',
						default: '',
						placeholder: '69',
						description: 'French department code: 01 to 95, 2A, 2B, 971 to 978, or 984 to 988. Leave empty to cover the whole country.',
					},
					{
						name: 'fenetre_mois',
						label: 'Window (Months)',
						type: 'number',
						default: 12,
						placeholder: '12',
						description: 'Number of months ahead, from 1 to 24, inside which the estimated end date must fall.',
					},
					{
						name: 'page',
						label: 'Page',
						type: 'number',
						default: 1,
						placeholder: '1',
						description: 'Result page, from 1 to 500, of 50 contracts each; the response carries the total count and page count.',
					},
				],
			},
			/**
			 * Source: CORDIS (European Commission), CC BY 4.0 — attribution required when the data is
			 * republished. Coverage is Horizon 2020 (2014-2020) and Horizon Europe (2021-2027) only;
			 * `couverture` states the programmes and the publication date. Companies are matched through
			 * the VAT number CORDIS publishes, about 90 % of French participations, so `aucun_financement:
			 * true` is a NON-conclusive absence, not a measured zero. Results are capped at 100 projects,
			 * `tronque` when cut. A 503 means the CORDIS stock is missing or older than 75 days
			 * (fail-closed) and nothing is charged.
			 */
			{
				value: 'getEuFunding',
				name: 'Get EU Research Funding',
				action: 'Get eu research funding received',
				description:
					'EU research and innovation funding received, from CORDIS (European Commission): every Horizon 2020 and Horizon Europe project the company appears in, with role, EU contribution, total cost, dates, status and the official CORDIS link, plus totals. Facts, never a score. ($0.02).',
				path: (p) => `/v1/entreprise/${enc(p('siren'))}/financements-ue`,
				fields: [SIREN],
			},
			/**
			 * Data under Licence Ouverte / Open License Etalab 2.0. Coverage is the DECP publication duty,
			 * not the buyer's whole spending: contracts under EUR 40k excl. VAT are never published, so
			 * counts and amounts are a floor. The 18-month expiry list rests on ESTIMATED end dates
			 * (notification plus the duration declared at the time; duration amendments are absent from
			 * the source). A 503 `collecte_en_cours` means the anticipation stock is not loaded yet — a
			 * measure that is missing, not a buyer without contracts — and nothing is charged. Incumbent
			 * suppliers are returned as legal persons only.
			 */
			{
				value: 'getBuyerProfile',
				name: 'Get Public Buyer Profile',
				action: 'Get the procurement profile of a french public buyer',
				description:
					'Procurement profile of a French public buyer from the official DECP data: contract counts and amounts, five-year activity, top CPV segments, buying habits and incumbents whose contracts expire within 18 months. Contracts under EUR 40k excl. VAT are unpublished, so counts are a floor. ($0.02).',
				path: (p) => `/v1/acheteur/${enc(p('siret'))}/profil`,
				fields: [
					{
						name: 'siret',
						label: 'SIRET',
						type: 'string',
						required: true,
						placeholder: '26310012500016',
						description: 'Fourteen-digit identifier of the buyer\'s establishment; a nine-digit SIREN is not accepted here.',
					},
				],
			},
			/**
			 * Coverage and licences differ per country and an empty answer is never a measured absence: GB
			 * Cabinet Office OCDS under OGL v3, Find a Tender since 2021 and Contracts Finder since 2023,
			 * only half of suppliers carry a company number (aucune_attribution NON-conclusive;
			 * aucun_marche + existence_verifiee is the only bounded 'nothing' answer). PT Portal BASE /
			 * IMPIC via dados.gov.pt, public domain, every contract since 2012, winners without a
			 * published NIF are never named, provenance[] flags partial coverage. PL BZP / e-Zamowienia
			 * (UZP, CC0), national below-EU-threshold notices since 2021, winners served only when proven
			 * legal persons (sole traders never), classification still in progress returns 404. ES PLACSP
			 * CODICE feeds since 2012, reuse under the Ministry of Finance conditions, never a
			 * natural-person winner. LV IUB daily open data (CC0), e-forms since 2023-10-25, about 3% of
			 * winners published without an identifier. A 404 means no award and no notice for that
			 * identifier and is not conclusive; a 503 is a fail-closed stale stock (7 days, 21 for PT),
			 * not an absence of contracts. Natural-person winners are never returned; a natural-person
			 * NIF/NIP is rejected with a 400.
			 */
			{
				value: 'getEuropeanNational',
				name: 'Get National Public Contracts',
				action: 'Get national public contracts won by a european company',
				description:
					'Public contracts won and notices issued as a buyer by a company in Spain (PLACSP), the United Kingdom (Find a Tender and Contracts Finder), Latvia (IUB), Poland (BZP) or Portugal (Portal BASE), matched by national identifier; an empty result is not proof of absence. ($0.02).',
				path: (p) => `/v1/eu/entreprise/${enc(p('nationalProcurementCountry'))}/${enc(p('nationalProcurementId'))}/marches-publics`,
				fields: [
					{
						name: 'nationalProcurementCountry',
						label: 'Country',
						type: 'options',
						default: 'GB',
						description: 'National procurement register to query, one fixed route per country in the API: ES (PLACSP), GB (Find a Tender + Contracts Finder), LV (IUB), PL (BZP), PT (Portal BASE).',
						options: [
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Poland', value: 'PL' },
							{ name: 'Portugal', value: 'PT' },
							{ name: 'Spain', value: 'ES' },
							{ name: 'United Kingdom', value: 'GB' },
						],
					},
					{
						name: 'nationalProcurementId',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: '10868035',
						description: 'National identifier in that register\'s own format (the path parameter of each route): ES nif (letter, seven digits, check character; DNI and NIE refused) · GB company_number (eight characters, leading zeros included) · LV regnr (eleven digits) · PL nip (ten digits) · PT nipc (nine digits with check digit).',
					},
				],
				notFoundIsEmpty: true,
			},
			/**
			 * Source TED (Tenders Electronic Daily), Publications Office of the EU, free reuse, © European
			 * Union; live query cached 24 h. Coverage reserve to state, never to hide: matching is
			 * identifier-based over every published form of the identifier (variantes_identifiant lists
			 * the forms searched), eForms winner identifiers exist only since 2023-10-25, and 40 to 86% of
			 * award notices carry a readable winner identifier depending on the country — nombre_avis: 0
			 * is a NON-conclusive absence, not a company without European contracts. A country outside the
			 * served list answers 404 pays_non_couvert; a 404 on a served country means the national
			 * register does not know the entity. Amounts are notice-level (all lots and all winners),
			 * never the share won by this company.
			 */
			{
				value: 'getEuropeanByNationalId',
				name: 'Get European Contracts by National ID',
				action: 'Get european award notices for a european company',
				description:
					'European public-procurement award notices from TED won by a company of Latvia, Norway, Belgium, Denmark, Finland, Sweden, Czechia, Slovakia or Estonia, matched by national identifier; 40 to 86% of award notices carry a readable winner identifier, so zero is non-conclusive. ($0.02).',
				path: (p) => `/v1/eu/entreprise/${enc(p('pays'))}/${enc(p('id'))}/marches-publics-ue`,
				fields: [
					{
						name: 'pays',
						label: 'Country',
						type: 'options',
						default: 'LV',
						description: 'Country served by TED extended, matched on the national identifier.',
						options: [
							{ name: 'Belgium', value: 'BE' },
							{ name: 'Czechia', value: 'CZ' },
							{ name: 'Denmark', value: 'DK' },
							{ name: 'Estonia', value: 'EE' },
							{ name: 'Finland', value: 'FI' },
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Norway', value: 'NO' },
							{ name: 'Slovakia', value: 'SK' },
							{ name: 'Sweden', value: 'SE' },
						],
					},
					{
						name: 'id',
						label: 'National Identifier',
						type: 'string',
						required: true,
						placeholder: '40003242722',
						description: 'National register identifier: 11-digit regnr for LV, 9-digit orgnr for NO, KBO for BE, CVR for DK, Y-tunnus for FI, orgnr for SE, IČO for CZ and SK, registrikood for EE.',
					},
				],
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
							'Restrict the search to one national register. Leave empty to search the pre-loaded registers plus worldwide LEI. Note that Czechia, Switzerland, Denmark, Finland, Poland, Slovakia and the United Kingdom are queried LIVE and are only searched by name when their country is selected here.',
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
					'Published annual accounts for a European company. Belgium and Finland return the list of filings to fetch one by one; Norway, Latvia, Estonia and Sweden return the figures directly; Denmark, Slovakia and the United Kingdom return the available financial years. Czechia, Poland and Switzerland are NOT covered by this route. Price depends on the country: $0.01 (BE, FI, DK, SK, GB), $0.02 (EE, NO), $0.03 (LV, SE); on the wallet rail, set Max Amount Per Call to at least $0.03.',
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
							`${p('country')} does not serve filings one by one. Countries covered: ${servis.join(', ')}. For the others, List Annual Filings already returns the figures.`,
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
							'Reference returned by List Annual Filings: a filing reference for Belgium, Finland and Slovakia, a closing date (YYYY-MM-DD) for Denmark and the United Kingdom.',
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
					/**
			 * // Coverage and licence, said before the call rather than after. // Eight registers only
			 * (CH, CZ, GB, HR, IE, LT, LV, RO): a country absent from // the list above has no route here
			 * — that is not an empty record. // An absence of proceeding is a measured fact on a complete
			 * register in GB, LV, // HR, LT, IE, RO and CZ (publication being compulsory there), but NOT
			 * in CH: // the SOGC/SHAB online archive only starts in 2021, so a bankruptcy older than //
			 * that is outside the window, not absent. // Freshness differs by country: GB and CH are live,
			 * LV, HR, LT and IE are daily // snapshots, RO is a monthly snapshot, CZ is an incremental
			 * ISIR stock dated by // collecte_le. The routes fail closed (503) rather than answer on a
			 * stale stock. // CZ serves legal persons only: a natural person's IČO (sole trader, farmer)
			 * is // refused with 404 entreprise_individuelle_non_servie and is never cleared. //
			 * Natural-person debtors are excluded at ingestion (GDPR minimisation), and the //
			 * practitioners reported carry name and role only, never an address; HR returns // the facts
			 * extracted from court decisions, never the decision text. // Licences: GB Open Government
			 * Licence v3.0 (Companies House) · LV Uzņēmumu // reģistrs, CC0 · HR Sudski registar (Ministry
			 * of Justice), attribution // required · LT data.gov.lt CC BY 4.0 · IE CRO CC BY 4.0 · RO ONRC
			 * // data.gov.ro CC BY 4.0 · CZ ISIR (Ministerstvo spravedlnosti ČR) · // CH SOGC/SHAB (SECO).
			 */
			{
				value: 'getInsolvency',
				name: 'Get Insolvency Record',
				action: 'Get a company insolvency record',
				description:
					'Insolvency proceedings for a company, from the official register of each country covered (CH, CZ, GB, HR, IE, LT, LV, RO): dates, court and case reference. No proceeding is an explicit measured answer, except Switzerland (archive since 2021) and Czechia (legal persons only). ($0.02).',
				path: (p) => `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/insolvabilite`,
				fields: [
					{
						name: 'country',
						label: 'Country',
						type: 'options',
						required: true,
						default: 'GB',
						description: 'National insolvency register to query.',
						options: [
							{ name: 'Croatia', value: 'HR' },
							{ name: 'Czechia', value: 'CZ' },
							{ name: 'Ireland', value: 'IE' },
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Lithuania', value: 'LT' },
							{ name: 'Romania', value: 'RO' },
							{ name: 'Switzerland', value: 'CH' },
							{ name: 'United Kingdom', value: 'GB' },
						],
					},
					{
						name: 'companyId',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: 'NI017460',
						description: 'The register\'s own identifier, under its own name in the API: CH the UID CHE-138.657.350 (id) · CZ an eight-digit IČO (ico) · GB the Companies House company number (company_number) · HR an eleven-digit OIB, an 8- or 9-digit MBS also accepted (oib) · IE a CRO number of one to seven digits (numero) · LT a nine-digit JAR code (kodas) · LV an eleven-digit registration number (regnr) · RO the CUI, RO prefix accepted (cui).',
					},
				],
			},
			/**
			 * Coverage, licence and person-data reserve — an absence of result here is not always a
			 * measured absence. Licences and attribution, kept in every response: NO Brønnøysundregistrene
			 * / Enhetsregisteret, NLOD 2.0; LV Uzņēmumu reģistrs / VID (data.gov.lv), CC0 1.0; EE
			 * e-äriregister (RIK), CC BY 4.0; FI PRH open data, CC BY 4.0; HR Sudski registar daily
			 * snapshot; CH SOGC/SHAB via the SECO public API; SE Bolagsverket weekly national file; PL
			 * Krajowy Rejestr Sądowy daily bulletin (Ministerstwo Sprawiedliwości). Measured absence vs.
			 * silence: NO, LV, EE and SE serve an explicit positive answer (aucun_evenement /
			 * aucune_ordonnance / procedure_en_cours: false), and NO asserts it only on a live-verified
			 * record with a current journal, EE only on a fresh dated photo of a still-registered entity;
			 * CH answers aucune_publication. PL is the exception: aucun_evenement: true means 'nothing
			 * published inside the collected window' only, the route never checks that the KRS exists, and
			 * an unknown number returns exactly the same empty answer — settle existence with Get Profile
			 * (/v1/eu/entreprise/PL/{krs}). Bounded windows: NO three years, the source's own
			 * republication limit (a still-open procedure's opening event is always served) and undated
			 * events carry an upper-bound date (date_au_plus_tard); CH since July 2018; FI since late
			 * 2014; PL the contiguous collected window, with its age in retard_jours; EE and HR a daily
			 * photo, dated. A struck-off Estonian entity leaves the open data entirely, so its silence is
			 * not a fact; fail-closed 503 when a stock or photo is too old to assert an absence. No
			 * natural-person data beyond what the public acts say: NO serves legal persons only and never
			 * individuals (natural-person legal forms ENK, PERS, TVAM and estates KBO, BO are refused); HR
			 * serves published text only for a closed list of entry types without natural persons
			 * (texte_retenu otherwise); CH withholds free text because it names persons; PL never serves
			 * an officer, a shareholder, a PESEL or the register's free-text wording. Granularity: NO is
			 * coarser than France's BODACC — no ruling text, no court.
			 */
			{
				value: 'getEvents',
				name: 'Get Registry Events',
				action: 'Get company registry events',
				description:
					'Company legal and registry events from each country\'s official register (insolvency, liquidation, mergers, strike-off, statutory entries) for Croatia, Estonia, Finland, Latvia, Norway, Poland, Sweden and Switzerland; coverage window and event vocabulary differ by register. ($0.02).',
				path: (p) => `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}/evenements`,
				fields: [
					{
						name: 'country',
						label: 'Country',
						type: 'options',
						required: true,
						default: 'NO',
						description: 'National register to read events from; only these eight registers publish an event feed on this route.',
						options: [
							{ name: 'Croatia', value: 'HR' },
							{ name: 'Estonia', value: 'EE' },
							{ name: 'Finland', value: 'FI' },
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Norway', value: 'NO' },
							{ name: 'Poland', value: 'PL' },
							{ name: 'Sweden', value: 'SE' },
							{ name: 'Switzerland', value: 'CH' },
						],
					},
					{
						name: 'companyId',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: '926455249',
						description: 'National identifier in that register\'s own format and under its own OpenAPI name: HR oib, eleven-digit OIB (an 8- or 9-digit MBS is accepted and resolved to the OIB) · EE registrikood, eight digits · FI id, business ID NNNNNNN-N (0112038-9) · LV regnr, eleven digits · NO id, nine-digit organisasjonsnummer without spaces · PL krs, ten digits with leading zeros · SE orgnr, ten-digit organisationsnummer with or without hyphen · CH id, UID CHE-xxx.xxx.xxx.',
					},
				],
			},
			/**
			 * Coverage: seven registers only (CY, DK, EE, GB, LV, NO, RO). The country list above is
			 * deliberately its own field, not the shared COUNTRY/NATIONAL_ID constants of this resource:
			 * those offer BE, CH, CZ, FI, PL and SE, which have no officers route, and omit CY and RO,
			 * which do. Freshness and what an empty answer means: GB and DK are queried live; EE, LV and
			 * NO come from a daily national bulk; CY and RO from a monthly snapshot. A company with no
			 * officer answers 200 with aucun_mandat_publie / aucun_mandat_inscrit — an absence measured on
			 * the loaded snapshot, and the counts served alongside are always the exact registered ones. A
			 * 404 is therefore an unknown identifier, never an absence of officers, and a stale or missing
			 * snapshot fails closed with a 503 rather than answering on an outdated photo — CY over 45
			 * days, RO over 70 days, EE and NO over 7 days. Listings are capped for Denmark (300 current,
			 * 200 ended mandates, flag tronque), while the counts stay exact. Licence and attribution, to
			 * be carried through to any re-publication: GB Companies House under the Open Government
			 * Licence v3.0, NO Brønnøysundregistrene under NLOD 2.0, LV Uzņēmumu reģistrs CC0, EE
			 * e-Business Register (RIK), CY DRCOR and RO ONRC under CC BY 4.0; each response carries its
			 * own source and licence fields. GDPR: published acts only — name and role, never an address,
			 * never a national identity number or identifier hash; no birth date for NO, EE, CY and RO,
			 * month and year only where GB and LV publish it. Danish beneficial owners and the ownership
			 * register are not served by this route.
			 */
			{
				value: 'getOfficers',
				name: 'Get Company Officers',
				action: 'Get company officers from a national register',
				description:
					'Officers and board members from official national registers, one schema for all: body, role, mandate dates where published, exact current and past counts. Covers Cyprus, Denmark, Estonia, Latvia, Norway, Romania and the United Kingdom only, no other country. ($0.01).',
				// `p()` returns a STRING: a two-value options list yields "false",
				// which is truthy in JavaScript. Test the value, not the presence —
				// otherwise choosing "No" still appended `?inclure_anciens=true`.
				path: (p) =>
					`/v1/eu/entreprise/${enc(p('officersCountry'))}/${enc(p('officersCompanyId'))}/dirigeants` +
					`${p('inclure_anciens') === 'true' ? '?inclure_anciens=true' : ''}`,
				fields: [
					{
						name: 'officersCountry',
						label: 'Officers Register',
						type: 'options',
						required: true,
						default: 'GB',
						description: 'National register to query for officers; only these seven registers serve this route, the other countries of the European Company dropdown have no officers route at all.',
						options: [
							{ name: 'Cyprus', value: 'CY' },
							{ name: 'Denmark', value: 'DK' },
							{ name: 'Estonia', value: 'EE' },
							{ name: 'Latvia', value: 'LV' },
							{ name: 'Norway', value: 'NO' },
							{ name: 'Romania', value: 'RO' },
							{ name: 'United Kingdom', value: 'GB' },
						],
					},
					{
						name: 'officersCompanyId',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: '00102498',
						description: 'National registration number in that register\'s own format: CY the HE or AE number (HE165) · DK the CVR eight digits · EE the registrikood eight digits, legal persons only · GB the Companies House number (00102498, SC123456) · LV eleven digits · NO the orgnr nine digits · RO the CUI, the RO prefix is accepted.',
					},
					{
						name: 'inclure_anciens',
						label: 'Include Former Mandates',
						type: 'options',
						default: '',
						description: 'Add the ended (deregistered) mandates to the current ones, each with its end date; Denmark and Norway only, where the API accepts inclure_anciens=true, and without effect on the other five registers.',
						options: [
							{ name: 'Current Mandates Only', value: '' },
							{ name: 'Current and Former Mandates', value: 'true' },
						],
					},
				],
			},
			/**
			 * Served for EE (registrikood, e-äriregister / RIK, CC BY 4.0, daily photo) and LV (regnr,
			 * Uzņēmumu reģistrs / VID via data.gov.lv, CC0 1.0) only; any other country on this path
			 * answers 404 pays_non_couvert, free. Attribution of the source register is required by both
			 * licences. Natural-person holders are COUNTED, never named (GDPR): a holder count here is not
			 * a name list, and `detenu_par_personnes_physiques_pct` is the only view of that share. EE
			 * serves legal persons only; a sole proprietorship (FIE) is a 404, not an empty share
			 * register. `aucun_associe_inscrit: true` is a measured positive answer (known company with no
			 * filed member); a 503 means the national stock is not yet ingested or is older than 7 days
			 * (fail-closed) and must NOT be read as an absence of shareholders.
			 */
			{
				value: 'getShareholders',
				name: 'Get Shareholders',
				action: 'Get european company shareholders',
				description:
					'Registered members and shareholders from the national share register, Estonia (e-äriregister, RIK) and Latvia (Uzņēmumu reģistrs) only: holdings, nominal value, currency and start date, corporate holders named with their registration number, natural persons counted but never named. ($0.02).',
				path: (p) => `/v1/eu/entreprise/${enc(p('pays'))}/${enc(p('id'))}/associes`,
				fields: [
					{
						name: 'pays',
						label: 'Country',
						type: 'options',
						required: true,
						default: 'EE',
						description: 'National share register to query; only Estonia and Latvia serve members and shareholders on this path.',
						options: [
							{ name: 'Estonia', value: 'EE' },
							{ name: 'Latvia', value: 'LV' },
						],
					},
					{
						name: 'id',
						label: 'Company Identifier',
						type: 'string',
						required: true,
						placeholder: '10060701',
						description: 'National registration number in that register\'s own format: Estonia the 8-digit registrikood of a legal person (sole proprietorships are refused), Latvia the 11-digit regnr.',
					},
				],
			},
			/**
			 * Norway only: no other national register serves local units on this path, and another country
			 * answers 404 pays_non_couvert, free. Data from Brønnøysundregistrene — Enhetsregisteret
			 * underenheter, NLOD 2.0: the licence requires naming the source. `aucune_unite_locale: true`
			 * is a measured positive answer for a known legal person absent from the day's bulk; a 503
			 * means the bulk is not yet ingested or is older than 7 days (fail-closed) and is NOT an
			 * absence of local units. Headcount is only what the register publishes: `effectif_publie`
			 * false with a null `effectif` means unrecorded, not zero.
			 */
			{
				value: 'getLocalUnits',
				name: 'Get Local Units',
				action: 'Get norwegian company local units',
				description:
					'Norwegian local units (underenheter, the SIRET-like establishments) from Enhetsregisteret (Brønnøysundregistrene), daily national bulk: each unit\'s own orgnr, NACE-NO activity, published headcount and addresses, plus unit count and cumulative headcount. Norway only on this path. ($0.01).',
				path: (p) => `/v1/eu/entreprise/NO/${enc(p('id'))}/etablissements`,
				fields: [
					{
						name: 'id',
						label: 'Organisation Number',
						type: 'string',
						required: true,
						placeholder: '923609016',
						description: '9-digit Norwegian organisasjonsnummer of the company, no spaces.',
					},
				],
			},
			/**
			 * Coverage is PARTIAL and says so in the response: the served stock starts at `stock.depuis`
			 * and stops at `stock.dernier_jour_collecte`, and `stock.avis_en_attente_de_rattachement`
			 * counts notices whose company number is not yet attached. `aucune_annonce: true` is therefore
			 * a measured absence only when `existence_verifiee` is true, i.e. the company was confirmed at
			 * Companies House; otherwise it is an unread answer, not a clean bill of health. A stock not
			 * collected yet or older than 7 days fails closed with a 503 instead of answering empty, and a
			 * 404 means the company number is unknown to Companies House, not that there is no notice.
			 * Source: The Gazette (London, Edinburgh and Belfast), corporate insolvency feed, category 24
			 * — public sector information licensed under the Open Government Licence v3.0 (TSO under
			 * HMSO); attribution required and personal data excluded from re-use, so only the published
			 * company denomination is served.
			 */
			{
				value: 'getGazetteNotices',
				name: 'Get UK Insolvency Notices',
				action: 'Get uk insolvency notices',
				description:
					'United Kingdom only: company insolvency notices from The Gazette, the official journal, newest first (winding-up resolutions and petitions, liquidator and administrator appointments, creditors\' notices and dividends), each with its official notice code, type, date and link. ($0.02).',
				path: (p) => `/v1/eu/entreprise/GB/${enc(p('company_number'))}/annonces`,
				fields: [
					{
						name: 'company_number',
						label: 'Company Number',
						type: 'string',
						required: true,
						placeholder: 'SC540982',
						description: 'Companies House company number, 8 characters including leading zeros (00102498, SC540982, NI017460).',
					},
				],
			},
			/**
			 * The flow of daily filings starts in 2009: a 404 means no act published since 2009 for that
			 * hoja, which is not the same as a company that does not exist, and the BORME (sección A)
			 * never publishes the NIF — the response carries `rattachement_nif: "non disponible"` and the
			 * hoja registral is the only key this route accepts. The list is capped at 100 acts, newest
			 * first, with `actes_tronques` and a total count saying when acts were left out. Personal
			 * data: Spanish personal IDs (DNI/NIE) and natural-person sole-shareholder names are redacted
			 * at ingestion and marked « […] » as the BOE licence requires; officer names are served
			 * exactly as the gazette publishes them, and nothing beyond the published act is added.
			 * Attribution: « Basado en datos de la Agencia Estatal Boletín Oficial del Estado
			 * (https://www.boe.es) ».
			 */
			{
				value: 'getSpanishActs',
				name: 'Get Spanish Registry Acts',
				action: 'Get spanish registry acts',
				description:
					'Spain only: company acts published in the BORME gazette (Registro Mercantil, section A) for one hoja registral, newest first (incorporations, officer appointments and dismissals, capital changes, mergers, dissolutions and insolvency), 100 acts maximum with the total count. ($0.02).',
				path: (p) => `/v1/eu/entreprise/ES/${enc(p('hoja'))}/actes`,
				fields: [
					{
						name: 'hoja',
						label: 'Hoja Registral',
						type: 'string',
						required: true,
						placeholder: 'VI-23141',
						description: 'Register-sheet key of the Spanish company, e.g. VI-23141; get it from European Company > Search with the country filter set to Spain, since the BORME does not publish the NIF.',
					},
				],
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
];

/** Looks up an operation. Returns null rather than throwing: the caller decides. */
export function findOperation(resource: string, operation: string): Operation | null {
	return (
		RESOURCES.find((r) => r.value === resource)?.operations.find((o) => o.value === operation) ??
		null
	);
}
