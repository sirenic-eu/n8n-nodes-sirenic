# Kit de soumission des templates au portail n8n

**Régénéré le 2026-11-20**, après le retrait de T01, T02, T03 et T10, que la galerie
https://api.sirenic.eu/workflows sert déjà (W4, W2, W6, W12 ; kopko13/sirenic#177) ; depuis le
2026-09-23, les templates passent par le rail clé d'API (nœuds natifs seulement, donc n8n Cloud).
Le texte vient des workflows eux-mêmes : la description à coller
EST le contenu du sticky jaune de chaque template, comme n8n l'exige (« include the entire
description in it »). Si tu modifies un sticky, régénère ce fichier plutôt que de recopier
à la main : c'est la seule façon d'éviter que les deux divergent.

Règles appliquées, tirées des deux pages officielles :
[Template submission guidelines](https://n8n.notion.site/Template-submission-guidelines-9959894476734da3b402c90b124b1f77)
et [description template](https://n8n.notion.site/n8n-workflow-template-description-template-b4c008b47eb74846b48c37c652ec2650).

| Règle n8n | État |
|---|---|
| Titre « verbe d'action + objet + où », capitalisation de phrase, sans emoji | ✅ les 2 |
| Description en Markdown, sans balise HTML | ✅ les 2 |
| Sections Who's it for / How it works / How to set up / Requirements / How to customize | ✅ les 2 |
| Phrase d'accroche 1-2 lignes en tête (qui / quoi / pourquoi) | ✅ ajoutée ici |
| Un sticky jaune portant TOUTE la description | ✅ les 2 |
| Stickies neutres pour les étapes | ✅ les 2 (couleur 7), qui encadrent chacune ses nœuds (contrôle 8 de `verifier-templates.mjs`) |
| Nœuds natifs seulement : aucun disclaimer « self-hosted only », aperçu du canevas rendu par n8n.io | ✅ les 2 depuis le 23/09/2026 |
| Pas de clé API en dur, pas d'identifiant personnel (Sheet ID, canal Slack, e-mail) | ✅ vérifié par `verifier-templates.mjs` |
| Nœuds renommés pour dire ce qu'ils font | ✅ les 2 |
| Zéro tiret long dans un texte publié (règle interne du 23/09/2026) | ✅ vérifié par `verifier-templates.mjs` |

n8n vise « ~200 mots » ; le compte de chaque description figure ci-dessous. La densité vient
de ce qu'on refuse d'enlever : le prix de chaque appel, le disclaimer « Sirenic n'est pas une
plateforme agréée (PDP) », le rappel que les correspondances de sanctions ne sont jamais une
décision automatique, et les dates du mandat.

Deux points **facultatifs** non appliqués, à décider :
- n8n conseille un nœud **Set Fields** regroupant les variables à configurer. Aucun des 2 n'en a
  (la config vit dans les nœuds Google Sheets).
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

## T07 : `T07-score-customer-credit-risk.json`

**Titre à coller**

Score French customer credit risk weekly with Sirenic and Google Sheets

**Description à coller** (283 mots)

~~~markdown
Every Monday your customer book is scored for default risk against official French financials, and Slack receives a digest of the customers whose risk class actually changed. A stable portfolio produces no noise at all.

### Who's it for
Credit managers and finance teams carrying receivables on French customers.

### How it works
Every Monday the workflow reads your customer sheet, calls Sirenic's default risk score for each SIREN ($0.10) and writes back the score (0-100) and its class. The score is deterministic: it comes with its component axes (liquidity, profitability, structure) and its model version, so any decision you take on it stays explainable. A Slack digest reports only the customers whose class CHANGED since the previous run, so nobody gets spammed with a stable portfolio. Failed requests are never billed.

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

**Description à coller** (336 mots)

~~~markdown
From 1 September 2026 every French company must be able to receive electronic invoices. This audit walks your customer list and tells you, customer by customer, the invoicing identity, the computed intra-EU VAT number and the indicative obligation dates, so you know who to chase.

### Who's it for
Invoicing software vendors, accountants and any French B2B company that has to send compliant electronic invoices. From 1 September 2026 every French company must be able to RECEIVE electronic invoices; issuing is phased (large and mid-size companies 2026, SMEs from 1 September 2027).

### How it works
The workflow walks your customer sheet and calls Sirenic's e-invoicing preparation endpoint for each SIREN ($0.02). For every customer you get the invoicing identity (legal name, status, establishments with their SIRET), the computed intra-EU VAT number, and the indicative obligation dates derived from the company's INSEE size category. Results are written back to the sheet and a single summary email tells you who is ready and who needs chasing. Preparation only: Sirenic is not an accredited platform (PDP) and never issues or routes invoices. Failed requests are never billed.

### How to set up
1. Create a Sirenic API key at https://api.sirenic.eu/compte (e-mail and magic link).
2. Add a Header Auth credential in n8n (name X-Api-Key, value your srn_live_ key) and select it on the HTTP Request node.
3. Prepare a Google Sheet with a `SIREN` column (plus `Company`, `VAT`, `Reception since`, `Issuing since`, `Establishments`, `Warnings`, `Checked at`, filled by the workflow).
4. Select the sheet in both Google Sheets nodes and set your recipient address in the Gmail node.
5. Run manually once for the full audit, then keep the monthly schedule for new customers.

### Requirements
n8n Cloud or self-hosted, native nodes only · a Sirenic API key (pay-per-call, no subscription) · Google Sheets and Gmail credentials.

### How to customize
Filter the sheet to customers you actually invoice; add a live VIES check of the VAT number (/v1/tva/verifier/{numero}, $0.003); send the summary to Slack instead of email.
~~~

