# Ready-to-import n8n workflows

Six ready-to-import workflows built on official French and European company-registry data
(INSEE Sirene, INPI, BODACC, sanctions lists, national registers across Europe).
Import them via **Workflows → Import from file** in n8n. Errors are never billed.

Since 23 September 2026 all six use **native n8n nodes only** (HTTP Request, MCP Client Tool)
and a **Sirenic API key**: they run on **n8n Cloud** as well as on self-hosted n8n, and they
do not need this community node.

| File | What it does | Cost per run |
|---|---|---|
| [T10-chat-french-registry-mcp.json](T10-chat-french-registry-mcp.json) | Chat with the French company registry through an AI Agent connected to the Sirenic MCP server (more than 100 tools). | free tool listing; data calls from $0.002 |
| [T01-verify-french-suppliers.json](T01-verify-french-suppliers.json) | Verify a French supplier before paying an invoice: identity, VAT live against VIES, IBAN + bank identification, deterministic ready-to-invoice verdict. Blocked suppliers alert Slack with closed-list reasons. | $0.03 per supplier |
| [T02-enrich-hubspot-companies.json](T02-enrich-hubspot-companies.json) | Enrich every new HubSpot company with official registry data (SIREN, legal form, NAF, workforce, status), with a confidence-score guard and human review on homonyms. | $0.007 per company |
| [T03-kyb-client-onboarding.json](T03-kyb-client-onboarding.json) | Run a full KYB check when a client signs up: identity, officers, insolvency, financials and sanctions in one call, then route to auto-approve, human review or hard stop. | $0.15 per applicant |
| [T07-score-customer-credit-risk.json](T07-score-customer-credit-risk.json) | Score your French customers' default risk weekly and post a Slack digest of the classes that CHANGED (no noise on a stable book). | $0.10 per customer per run |
| [T08-einvoicing-readiness-2026.json](T08-einvoicing-readiness-2026.json) | Audit every customer's readiness for the French e-invoicing mandate: invoicing identity, computed VAT number, indicative obligation dates. | $0.02 per customer |

## Setup, once for all six

1. Create a Sirenic API key at <https://api.sirenic.eu/compte> (e-mail and magic link).
2. In n8n, add a **Header Auth** credential: name `X-Api-Key`, value your `srn_live_…` key.
3. Select it on every HTTP Request node (T01 to T08) or on the MCP Client Tool node (T10,
   endpoint `https://api.sirenic.eu/mcp/connecteur`, the one that reads the key).
4. Add the app credentials each workflow uses (Google Sheets, Slack, HubSpot or Gmail).

## Requirements

- **T01, T02, T03, T07, T08**: any n8n, Cloud or self-hosted, plus the Header Auth credential above.
- **T10**: n8n ≥ 1.104 (MCP Client Tool, Streamable HTTP), a chat-model credential and the same
  Header Auth credential.

Test SIREN: 552032534 (Danone). Docs: <https://api.sirenic.eu> (OpenAPI, MCP, pricing).
Pay-per-call on prepaid credits, no subscription; a verified account gets 150 free calls a
month on routes at $0.05 or less; failed requests are never billed. Twelve more workflows,
also on native nodes, are served at <https://api.sirenic.eu/workflows>.

## Checks before publishing

```bash
node templates/verifier-templates.mjs            # reads the live price grid (free GET of /openapi.json)
node templates/verifier-templates.mjs --morsure  # proves every check can fail
node templates/generer-soumission.mjs            # regenerates SUBMISSION.md from the stickies
```

`verifier-templates.mjs` refuses a node of this package, an HTTP Request node without Header
Auth, a URL that is not a route of the price grid, a grid price missing from the main sticky,
an MCP client on the anonymous `/mcp` endpoint (which ignores the key), an embedded
credential, a missing section, a stale "self-hosted only" disclaimer and any em dash.
