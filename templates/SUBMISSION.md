# Kit de soumission des templates au portail n8n

**Régénéré le 2026-09-23**, après le passage des six templates au rail clé d'API (nœuds
natifs seulement, donc n8n Cloud), depuis les workflows eux-mêmes : la description à coller
EST le contenu du sticky jaune de chaque template, comme n8n l'exige (« include the entire
description in it »). Si tu modifies un sticky, régénère ce fichier plutôt que de recopier
à la main : c'est la seule façon d'éviter que les deux divergent.

Règles appliquées, tirées des deux pages officielles :
[Template submission guidelines](https://n8n.notion.site/Template-submission-guidelines-9959894476734da3b402c90b124b1f77)
et [description template](https://n8n.notion.site/n8n-workflow-template-description-template-b4c008b47eb74846b48c37c652ec2650).

| Règle n8n | État |
|---|---|
| Titre « verbe d'action + objet + où », capitalisation de phrase, sans emoji | ✅ les 6 |
| Description en Markdown, sans balise HTML | ✅ les 6 |
| Sections Who's it for / How it works / How to set up / Requirements / How to customize | ✅ les 6 |
| Phrase d'accroche 1-2 lignes en tête (qui / quoi / pourquoi) | ✅ ajoutée ici |
| Un sticky jaune portant TOUTE la description | ✅ les 6 |
| Stickies neutres pour les étapes | ✅ les 6 (couleur 7) |
| Nœuds natifs seulement : aucun disclaimer « self-hosted only », aperçu du canevas rendu par n8n.io | ✅ les 6 depuis le 23/09/2026 |
| Pas de clé API en dur, pas d'identifiant personnel (Sheet ID, canal Slack, e-mail) | ✅ vérifié par `verifier-templates.mjs` |
| Nœuds renommés pour dire ce qu'ils font | ✅ les 6 |
| Zéro tiret long dans un texte publié (règle interne du 23/09/2026) | ✅ vérifié par `verifier-templates.mjs` |

n8n vise « ~200 mots » ; le compte de chaque description figure ci-dessous. La densité vient
de ce qu'on refuse d'enlever : le prix de chaque appel, le disclaimer « Sirenic n'est pas une
plateforme agréée (PDP) », le rappel que les correspondances de sanctions ne sont jamais une
décision automatique, et les dates du mandat.

Deux points **facultatifs** non appliqués, à décider :
- n8n conseille un nœud **Set Fields** regroupant les variables à configurer. Aucun des 6 n'en a
  (la config vit dans les nœuds Google Sheets / HubSpot).
- n8n encourage une **vidéo Loom** de mise en route.

## Comment soumettre

1. Portail créateur → **Templates** → soumettre, un template à la fois (le portail n'en admet
   qu'UN en revue à la fois, relevé du 23/09/2026).
2. Coller le **titre** puis la **description** ci-dessous, et le **JSON du workflow**
   (`templates/<fichier>.json`).
3. Ne pas retoucher le texte après collage : il est identique au sticky du workflow.

Pour régénérer ce fichier après avoir modifié un sticky : `node templates/generer-soumission.mjs`
depuis la racine du dépôt.

---

## T01 : `T01-verify-french-suppliers.json`

**Titre à coller**

Verify French suppliers before paying invoices with Sirenic and Slack

**Description à coller** (263 mots)

~~~markdown
Every new supplier row in your sheet is checked against the official French registries before you pay it: legal identity, VAT live against VIES, IBAN with bank identification, and a deterministic ready-to-invoice verdict. Wire-transfer fraud and deregistered companies are caught before the payment run, not after it.

### Who's it for
Finance and accounts-payable teams paying French suppliers, and anyone exposed to wire-transfer fraud.

### How it works
Each new supplier row in your Google Sheet triggers one Sirenic call ($0.03) that checks official registries: legal identity and status, the intra-EU VAT number live against VIES, IBAN structure with bank identification. It returns a deterministic ready-to-invoice verdict (pret_a_facturer) with closed-list reasons. Verified suppliers are appended to your log; blocked ones alert your purchasing channel on Slack with the exact reasons. Note: not a payee verification, the account holder name is never checked. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on the HTTP Request node.
3. Point both Google Sheets nodes to your payment sheet (columns SIREN, optional IBAN).
4. Pick your Slack channel. Test with SIREN 552032534.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · Google Sheets and Slack credentials.

### How to customize
Add a call to the default risk score (/v1/score/defaillance/{siren}, $0.10) before granting payment terms; swap Sheets for Airtable or your ERP; route alerts to Teams or email.
~~~

---

## T02 : `T02-enrich-hubspot-companies.json`

**Titre à coller**

Enrich new HubSpot companies with official French registry data (SIREN)

**Description à coller** (276 mots)

~~~markdown
New HubSpot companies are filled in from the official French registry (SIREN, legal form, NAF activity code, workforce, administrative status), and the SIREN becomes a dedup key your CRM can trust. Homonyms go to a ten-second human review instead of a confident wrong guess.

### Who's it for
Sales ops teams whose reps only type a company name, and whose CRM fills up with duplicates, dead companies and empty fields.

### How it works
When a company is created in HubSpot, Sirenic searches the official French registry (INSEE Sirene) by name ($0.002) and returns candidates with a 0-1 confidence score. On a confident match, the full official profile ($0.005) is written back to HubSpot (SIREN, legal form, NAF activity code, workforce bracket, administrative status), with the SIREN stored as a reliable dedup key. On homonyms, a Slack message asks for a 10-second human review instead of guessing. Total: $0.007 per enriched company; failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on both HTTP Request nodes.
3. Connect HubSpot (developer credential for the trigger, app token for the actions).
4. Create a custom company property named siren (Settings → Properties).
5. Pick your Slack review channel.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · HubSpot and Slack credentials.

### How to customize
Map more fields in the update node; chain the default risk score (/v1/score/defaillance/{siren}) for lead scoring; the same pattern fits Pipedrive, Salesforce or Zoho.
~~~

---

## T03 : `T03-kyb-client-onboarding.json`

**Titre à coller**

Automate French company KYB checks for client onboarding with Sirenic

**Description à coller** (293 mots)

~~~markdown
Your onboarding form posts a SIREN and gets a full KYB file back in one call: legal identity, officers, insolvency proceedings, financials and sanctions screening, signed so it can be kept as audit evidence. The applicant is then auto-approved, queued for human review, or hard-stopped.

### Who's it for
Fintechs, payment providers, neobanks and B2B marketplaces that must run know-your-business checks before opening an account (EU AML obligations).

### How it works
Your onboarding form posts a SIREN to the webhook. One Sirenic call ($0.15) returns a complete KYB file from official registries: legal identity, officers, BODACC insolvency proceedings, financials and sanctions screening, with an Ed25519-signed response you can keep as audit evidence. A Switch then routes the applicant: an open insolvency proceeding or an inactive company is a hard stop; a sanctions status of correspondances_a_verifier goes to a human (these are candidate matches on names, often homonyms, never an automatic refusal); everything else is auto-approved and logged. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on the HTTP Request node.
3. Point your onboarding form at the webhook URL (POST, JSON body with a `siren` field).
4. Pick your Slack compliance channel and your audit Google Sheet.
5. Test with SIREN 552032534.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · Slack and Google Sheets credentials.

### How to customize
Tighten or loosen the Switch rules to match your risk appetite; archive the signed response in your document vault; replace Slack with a Jira or Linear ticket for a formal review queue.
~~~

---

## T07 : `T07-score-customer-credit-risk.json`

**Titre à coller**

Score French customer credit risk weekly with Sirenic and Google Sheets

**Description à coller** (291 mots)

~~~markdown
Every Monday your customer book is scored for default risk against official French financials, and Slack receives a digest of the customers whose risk class actually changed. A stable portfolio produces no noise at all.

### Who's it for
Credit managers and finance teams carrying receivables on French customers.

### How it works
Every Monday the workflow reads your customer sheet, calls Sirenic's default risk score for each SIREN ($0.10) and writes back the score (0-100), its class, the 12-month risk wording and the reference financial year. The score is deterministic: it comes with its component axes (liquidity, profitability, structure) and its model version, so any decision you take on it stays explainable. A Slack digest reports only the customers whose class CHANGED since the previous run, so nobody gets spammed with a stable portfolio. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on the HTTP Request node.
3. Prepare a Google Sheet with columns: `SIREN`, `Company`, `Class` (left empty on first run), `Score`, `Checked at`.
4. Select that sheet in both Google Sheets nodes and pick your Slack channel.
5. Run once manually to fill the baseline, then let the schedule take over.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · Google Sheets and Slack credentials. Budget: $0.10 per customer per run; keep the sheet to customers with real exposure.

### How to customize
Drive credit limits directly from the class; switch the schedule to monthly for a large book; push the score into your ERP instead of Sheets.
~~~

---

## T08 : `T08-einvoicing-readiness-2026.json`

**Titre à coller**

Check French e-invoicing readiness for all your customers with Sirenic

**Description à coller** (333 mots)

~~~markdown
From 1 September 2026 every French company must be able to receive electronic invoices. This audit walks your customer list and tells you, customer by customer, the invoicing identity, the computed intra-EU VAT number and the indicative obligation dates, so you know who to chase.

### Who's it for
Invoicing software vendors, accountants and any French B2B company that has to send compliant electronic invoices. From 1 September 2026 every French company must be able to RECEIVE electronic invoices; issuing is phased (large and mid-size companies 2026, SMEs from 1 September 2027).

### How it works
The workflow walks your customer sheet and calls Sirenic's e-invoicing preparation endpoint for each SIREN ($0.02). For every customer you get the invoicing identity (legal name, status, establishments with their SIRET), the computed intra-EU VAT number, and the indicative obligation dates derived from the company's INSEE size category. Results are written back to the sheet and a single summary email tells you who is ready and who needs chasing. Preparation only: Sirenic is not an accredited platform (PDP) and never issues or routes invoices. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on the HTTP Request node.
3. Prepare a Google Sheet with a `SIREN` column (plus `Company`, `VAT`, `Reception since`, `Issuing since`, `Warnings`, filled by the workflow).
4. Select the sheet in both Google Sheets nodes and set your recipient address in the Gmail node.
5. Run manually once for the full audit, then keep the monthly schedule for new customers.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · Google Sheets and Gmail credentials.

### How to customize
Filter the sheet to customers you actually invoice; add a live VIES check of the VAT number (/v1/tva/verifier/{numero}, $0.003); send the summary to Slack instead of email.
~~~

---

## T10 : `T10-chat-french-registry-mcp.json`

**Titre à coller**

Chat with the French company registry using an AI Agent and Sirenic MCP

**Description à coller** (210 mots)

~~~markdown
### Who's it for
Analysts, sales, compliance and founders who want answers about French or European companies in plain language.

### How it works
A chat trigger feeds an AI Agent connected to the Sirenic MCP server: more than 100 tools over official sources (INSEE Sirene, INPI, BODACC, six sanctions lists, national registers across Europe). The agent picks the right tool: ask « Is Danone financially healthy? », « Screen ACME SAS against sanctions lists », « Who runs SIREN 552032534? ». Listing tools is free; data calls are pay-per-call from $0.002, billed to your API key, with no subscription. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. On the MCP Client Tool node (endpoint https://api.sirenic.eu/mcp/connecteur), add a Header Auth credential: name X-Api-Key, value your srn_live_ key.
3. Add credentials for your chat model (OpenAI or any other), then open the chat and ask a question.

### Requirements
n8n 1.104+ (MCP Client Tool, Streamable HTTP), so it works on n8n Cloud. A chat-model credential and a Sirenic API key.

### How to customize
Swap the chat model; restrict the tool list in the MCP Client node to the routes your team is allowed to buy.
~~~

