# Ready-to-import n8n workflows

Two ready-to-import workflows built on official French company-registry data (INSEE Sirene,
filed accounts). Import them via **Workflows → Import from file** in n8n. Errors are never billed.

Both use **native n8n nodes only** (HTTP Request) and a **Sirenic API key**: they run on
**n8n Cloud** as well as on self-hosted n8n, and they do not need this community node.

| File | What it does | Cost per run |
|---|---|---|
| [T07-score-customer-credit-risk.json](T07-score-customer-credit-risk.json) | Score your French customers' default risk weekly and post a Slack digest of the classes that CHANGED (no noise on a stable book). | $0.10 per customer per run |
| [T08-einvoicing-readiness-2026.json](T08-einvoicing-readiness-2026.json) | Audit every customer's readiness for the French e-invoicing mandate: invoicing identity, computed VAT number, indicative obligation dates. | $0.02 per customer |

The other ready-made workflows live in the gallery at <https://api.sirenic.eu/workflows>
(twelve n8n workflows on native nodes, eleven of them also as a Make blueprint). The four that
used to sit in this folder are there, on the same routes and kept up to date with the price
grid: verify a supplier before paying it (W4, formerly T01), enrich a CRM record from the
official register (W2, formerly T02), build a KYB file at onboarding (W6, formerly T03) and chat
with the registers in an n8n agent through the Sirenic MCP server (W12, formerly T10).

## Setup, once for both

1. Create a Sirenic API key at <https://api.sirenic.eu/compte> (e-mail and magic link).
2. In n8n, add a **Header Auth** credential: name `X-Api-Key`, value your `srn_live_…` key.
3. Select it on the HTTP Request node of each workflow.
4. Add the app credentials each workflow uses (Google Sheets, Slack or Gmail), then pick your
   sheet in both Google Sheets nodes: the columns to create are listed in the main sticky note.

## Requirements

Any n8n, Cloud or self-hosted, plus the Header Auth credential above.

Test SIREN: 552032534 (Danone). Docs: <https://api.sirenic.eu> (OpenAPI, MCP, pricing).
Pay-per-call on prepaid credits, no subscription; a verified account gets 150 free calls a
month on routes at $0.05 or less; failed requests are never billed.

## Checks before publishing

```bash
node templates/verifier-templates.mjs            # reads the live price grid (free GET of /openapi.json)
node templates/verifier-templates.mjs --morsure  # proves every check can fail
node templates/generer-soumission.mjs            # regenerates SUBMISSION.md from the stickies
```

`verifier-templates.mjs` refuses a node of this package, an HTTP Request node without Header
Auth, a URL that is not a route of the price grid, a grid price missing from the main sticky,
an MCP client on the anonymous `/mcp` endpoint (which ignores the key), an embedded
credential, a missing section, a stale "self-hosted only" disclaimer, any em dash, a Google
Sheets write whose column schema is empty or differs from its values or whose cells are not
RAW (a SIREN keeps its leading zeros), and a canvas where a node is not framed by exactly one
section note or a section note frames nothing.
