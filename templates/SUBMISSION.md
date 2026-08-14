# Kit de soumission des templates au portail n8n

**Généré le 2026-08-06** depuis les workflows eux-mêmes : la description à coller EST le
contenu du sticky jaune de chaque template, comme n8n l'exige (« include the entire
description in it »). Si tu modifies un sticky, régénère ce fichier plutôt que de recopier
à la main — c'est la seule façon d'éviter que les deux divergent.

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
| Community node → disclaimer « self-hosted only » | ✅ les 5 concernés (T10 n'en a pas besoin) |
| Community node → image du workflow EN TÊTE de la description (l'aperçu ne s'affiche pas) | ✅ ajoutée ici |
| Pas de clé API en dur, pas d'identifiant personnel (Sheet ID, canal Slack, e-mail) | ✅ vérifié : aucun identifiant dans les 6 JSON |
| Nœuds renommés pour dire ce qu'ils font | ✅ les 6 |

**Un écart assumé :** n8n vise « ~200 mots » ; nos descriptions font 256 à 331 mots
(T08 est la plus longue). La densité vient de ce qu'on refuse d'enlever : le prix de chaque
appel, le disclaimer « Sirenic n'est pas une plateforme agréée (PDP) », le rappel que les
correspondances de sanctions ne sont jamais une décision automatique, et les dates du mandat.
Si un relecteur le demande, c'est T08 qu'il faut raccourcir en premier — et il faudra alors
refaire sa capture de canvas, puisque le sticky et la description doivent rester identiques.

Deux points **facultatifs** non appliqués, à décider :
- n8n conseille un nœud **Set Fields** regroupant les variables à configurer. Aucun des 6 n'en a
  (la config vit dans les nœuds Google Sheets / HubSpot). L'ajouter obligerait à refaire les
  captures de canvas.
- n8n encourage une **vidéo Loom** de mise en route. Il existe déjà une démo du node
  (`/home/ubuntu/n8n-local/demo-sirenic-node.mp4`), pas des templates.

## Comment soumettre

1. Portail créateur → **Templates** → soumettre, un template à la fois.
2. Coller le **titre** puis la **description** ci-dessous, et le **JSON du workflow**
   (`templates/<fichier>.json`).
3. Ne pas retoucher le texte après collage : il est identique au sticky du workflow.

Pour régénérer ce fichier après avoir modifié un sticky : `node templates/generer-soumission.mjs`
depuis la racine du dépôt.

---

## T01 — `T01-verify-french-suppliers.json`

**Titre à coller**

Verify French suppliers before paying invoices with Sirenic and Slack

**Description à coller** (256 mots, image comprise)

~~~markdown
![Verify French suppliers before paying invoices - n8n workflow](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates/T01-canvas.png)

Every new supplier row in your sheet is checked against the official French registries before you pay it: legal identity, VAT live against VIES, IBAN with bank identification, and a deterministic ready-to-invoice verdict. Wire-transfer fraud and deregistered companies are caught before the payment run, not after it.

**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**

### Who's it for
Finance and accounts-payable teams paying French suppliers, and anyone exposed to wire-transfer fraud.

### How it works
Each new supplier row in your Google Sheet triggers one Sirenic call ($0.03) that checks official registries: legal identity and status, the intra-EU VAT number live against VIES, IBAN structure with bank identification — and returns a deterministic ready-to-invoice verdict (pret_a_facturer) with closed-list reasons. Verified suppliers are appended to your log; blocked ones alert your purchasing channel on Slack with the exact reasons. Note: not a payee verification — the account holder name is never checked. Failed requests are never billed.

### How to set up
1. Install the n8n-nodes-sirenic community node and create Sirenic credentials.
2. Point both Google Sheets nodes to your payment sheet (columns SIREN, optional IBAN).
3. Pick your Slack channel. Test with SIREN 552032534.

### Requirements
Self-hosted n8n · Sirenic community node (pay-per-call, no subscription) · Google Sheets and Slack credentials.

### How to customize
Add the Default Risk Score operation ($0.10) before granting payment terms; swap Sheets for Airtable or your ERP; route alerts to Teams or email.
~~~

---

## T02 — `T02-enrich-hubspot-companies.json`

**Titre à coller**

Enrich new HubSpot companies with official French registry data (SIREN)

**Description à coller** (277 mots, image comprise)

~~~markdown
![Enrich new HubSpot companies with official French registry data - n8n workflow](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates/T02-canvas.png)

New HubSpot companies are filled in from the official French registry - SIREN, legal form, NAF activity code, workforce, administrative status - and the SIREN becomes a dedup key your CRM can trust. Homonyms go to a ten-second human review instead of a confident wrong guess.

**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**

### Who's it for
Sales ops teams whose reps only type a company name — and whose CRM fills up with duplicates, dead companies and empty fields.

### How it works
When a company is created in HubSpot, Sirenic searches the official French registry (INSEE Sirene) by name ($0.001) and returns candidates with a 0-1 confidence score. On a confident match, the full official profile ($0.005) — SIREN, legal form, NAF activity code, workforce bracket, administrative status — is written back to HubSpot, with the SIREN stored as a reliable dedup key. On homonyms, a Slack message asks for a 10-second human review instead of guessing. Total: $0.006 per enriched company; failed requests are never billed.

### How to set up
1. Install the n8n-nodes-sirenic community node and create Sirenic credentials.
2. Connect HubSpot (developer credential for the trigger, app token for the actions).
3. Create a custom company property named siren (Settings → Properties).
4. Pick your Slack review channel.

### Requirements
Self-hosted n8n · Sirenic community node (pay-per-call, no subscription) · HubSpot and Slack credentials.

### How to customize
Map more fields in the update node; chain the Default Risk Score for lead scoring; the same pattern fits Pipedrive, Salesforce or Zoho.
~~~

---

## T03 — `T03-kyb-client-onboarding.json`

**Titre à coller**

Automate French company KYB checks for client onboarding with Sirenic

**Description à coller** (291 mots, image comprise)

~~~markdown
![Automate French company KYB checks for client onboarding - n8n workflow](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates/T03-canvas.png)

Your onboarding form posts a SIREN and gets a full KYB file back in one call: legal identity, officers, insolvency proceedings, financials and sanctions screening, signed so it can be kept as audit evidence. The applicant is then auto-approved, queued for human review, or hard-stopped.

**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**

### Who's it for
Fintechs, payment providers, neobanks and B2B marketplaces that must run know-your-business checks before opening an account (EU AML obligations).

### How it works
Your onboarding form posts a SIREN to the webhook. One Sirenic call ($0.15) returns a complete KYB file from official registries: legal identity, officers, BODACC insolvency proceedings, financials and sanctions screening — with an Ed25519-signed response you can keep as audit evidence. A Switch then routes the applicant: an open insolvency proceeding or an inactive company is a hard stop; a sanctions status of correspondances_a_verifier goes to a human (these are candidate matches on names, often homonyms — never an automatic refusal); everything else is auto-approved and logged. Failed requests are never billed.

### How to set up
1. Install the n8n-nodes-sirenic community node and create Sirenic credentials.
2. Point your onboarding form at the webhook URL (POST, JSON body with a `siren` field).
3. Pick your Slack compliance channel and your audit Google Sheet.
4. Test with SIREN 552032534.

### Requirements
Self-hosted n8n · Sirenic community node (pay-per-call, no subscription) · Slack and Google Sheets credentials.

### How to customize
Tighten or loosen the Switch rules to match your risk appetite; archive the signed response in your document vault; replace Slack with a Jira or Linear ticket for a formal review queue.
~~~

---

## T07 — `T07-score-customer-credit-risk.json`

**Titre à coller**

Score French customer credit risk weekly with Sirenic and Google Sheets

**Description à coller** (287 mots, image comprise)

~~~markdown
![Score French customer credit risk weekly - n8n workflow](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates/T07-canvas.png)

Every Monday your customer book is scored for default risk against official French financials, and Slack receives a digest of the customers whose risk class actually changed. A stable portfolio produces no noise at all.

**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**

### Who's it for
Credit managers and finance teams carrying receivables on French customers.

### How it works
Every Monday the workflow reads your customer sheet, calls Sirenic's default risk score for each SIREN ($0.10) and writes back the score (0-100), its class, the 12-month risk wording and the reference financial year. The score is deterministic — it comes with its component axes (liquidity, profitability, structure) and its model version, so any decision you take on it stays explainable. A Slack digest reports only the customers whose class CHANGED since the previous run, so nobody gets spammed with a stable portfolio. Failed requests are never billed.

### How to set up
1. Install the n8n-nodes-sirenic community node and create Sirenic credentials.
2. Prepare a Google Sheet with columns: `SIREN`, `Company`, `Class` (left empty on first run), `Score`, `Checked at`.
3. Select that sheet in both Google Sheets nodes and pick your Slack channel.
4. Run once manually to fill the baseline, then let the schedule take over.

### Requirements
Self-hosted n8n · Sirenic community node (pay-per-call, no subscription) · Google Sheets and Slack credentials. Budget: $0.10 per customer per run — keep the sheet to customers with real exposure.

### How to customize
Drive credit limits directly from the class; switch the schedule to monthly for a large book; push the score into your ERP instead of Sheets.
~~~

---

## T08 — `T08-einvoicing-readiness-2026.json`

**Titre à coller**

Check French e-invoicing readiness for all your customers with Sirenic

**Description à coller** (331 mots, image comprise)

~~~markdown
![Check French e-invoicing readiness for all your customers - n8n workflow](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates/T08-canvas.png)

From 1 September 2026 every French company must be able to receive electronic invoices. This audit walks your customer list and tells you, customer by customer, the invoicing identity, the computed intra-EU VAT number and the indicative obligation dates - so you know who to chase.

**Disclaimer: this template uses the Sirenic community node, so it runs on self-hosted n8n only.**

### Who's it for
Invoicing software vendors, accountants and any French B2B company that has to send compliant electronic invoices. From 1 September 2026 every French company must be able to RECEIVE electronic invoices; issuing is phased (large and mid-size companies 2026, SMEs from 1 September 2027).

### How it works
The workflow walks your customer sheet and calls Sirenic's e-invoicing preparation endpoint for each SIREN ($0.02). For every customer you get the invoicing identity (legal name, status, establishments with their SIRET), the computed intra-EU VAT number, and the indicative obligation dates derived from the company's INSEE size category. Results are written back to the sheet and a single summary email tells you who is ready and who needs chasing. Preparation only — Sirenic is not an accredited platform (PDP) and never issues or routes invoices. Failed requests are never billed.

### How to set up
1. Install the n8n-nodes-sirenic community node and create Sirenic credentials.
2. Prepare a Google Sheet with a `SIREN` column (plus `Company`, `VAT`, `Reception since`, `Issuing since`, `Warnings` — filled by the workflow).
3. Select the sheet in both Google Sheets nodes and set your recipient address in the Gmail node.
4. Run manually once for the full audit, then keep the monthly schedule for new customers.

### Requirements
Self-hosted n8n · Sirenic community node (pay-per-call, no subscription) · Google Sheets and Gmail credentials.

### How to customize
Filter the sheet to customers you actually invoice; add Verify VAT Number ($0.003) for a live VIES check; send the summary to Slack instead of email.
~~~

---

## T10 — `T10-chat-french-registry-mcp.json`

**Titre à coller**

Chat with the French company registry using an AI Agent and Sirenic MCP

**Description à coller** (205 mots)

~~~markdown
### Who's it for
Analysts, sales, compliance and founders who want answers about French or European companies in plain language.

### How it works
A chat trigger feeds an AI Agent connected to the Sirenic MCP server: 68 tools over official sources (INSEE Sirene, INPI, BODACC, six sanctions lists, eleven EU national registers). The agent picks the right tool: ask « Is Danone financially healthy? », « Screen ACME SAS against sanctions lists », « Who runs SIREN 552032534? ». Listing tools and getting exact price quotes is free; data calls are pay-per-call from $0.001 — no account, no API key, no subscription. When a tool requires payment, the agent reports the exact quote instead of charging blindly; failed requests are never billed.

### How to set up
1. Add credentials for your chat model (OpenAI or any other).
2. Open the chat and ask a question — the MCP endpoint needs no registration.

### Requirements
n8n 1.104+ (MCP Client Tool, Streamable HTTP) — works on n8n Cloud. A chat-model credential.

### How to customize
Swap the chat model; restrict the tool list in the MCP Client node; to execute paid lookups automatically, use the Sirenic community node (self-hosted), which signs x402 payments for you.
~~~

