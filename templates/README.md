# Ready-to-import n8n workflows

Three workflows built on official French & European company-registry data
(INSEE Sirene, INPI, BODACC, sanctions lists, 11 EU national registers).
Import them via **Workflows → Import from file** in n8n. Errors are never billed.

| File | What it does | Cost per run |
|---|---|---|
| [T10-chat-french-registry-mcp.json](T10-chat-french-registry-mcp.json) | Chat with the French company registry through an AI Agent connected to the Sirenic MCP server (69 tools). Native n8n nodes only — **works on n8n Cloud**, no account, no API key. | free discovery; data calls from $0.001 |
| [T01-verify-french-suppliers.json](T01-verify-french-suppliers.json) | Verify a French supplier before paying an invoice: identity, VAT live against VIES, IBAN + bank identification, deterministic ready-to-invoice verdict. Blocked suppliers alert Slack with closed-list reasons. | $0.03 per supplier |
| [T02-enrich-hubspot-companies.json](T02-enrich-hubspot-companies.json) | Enrich every new HubSpot company with official registry data (SIREN, legal form, NAF, workforce, status), with a confidence-score guard and human review on homonyms. | $0.006 per company |

## Screenshots

**Verify French suppliers before paying invoices** ([T01](T01-verify-french-suppliers.json))

![Verify French suppliers workflow](T01-canvas.png)

**Enrich new HubSpot companies with official French registry data** ([T02](T02-enrich-hubspot-companies.json))

![HubSpot enrichment workflow](T02-canvas.png)

**Chat with the French company registry** ([T10](T10-chat-french-registry-mcp.json))

![MCP chat agent workflow](T10-canvas.png)

## Requirements

- **T10**: any n8n ≥ 1.88 (MCP Client Tool node) + chat-model credentials. Nothing else.
- **T01 / T02**: this community node installed (`n8n-nodes-sirenic`, self-hosted) +
  Sirenic credentials, plus Google Sheets / Slack / HubSpot credentials as relevant.

Test SIREN: 552032534 (Danone). Docs: https://api.sirenic.eu — OpenAPI, MCP and
payment details. The API is pay-per-call (x402): no subscription, no account; failed
requests are never charged.
