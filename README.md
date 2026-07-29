# n8n-nodes-sirenic

Official French and European company data in n8n — **no API key, no account, no contract**.

Sirenic is paid per call over [x402](https://x402.org): each request settles a small USDC
payment on Base. You bring a wallet, you set a spending cap, you are done. Prices run from
**$0.001** to **$2.00** per call, and you only pay for calls that succeed.

## What you can do

| Operation | What it answers | Price |
|---|---|---:|
| **Search Company** | "Which company is this, exactly?" — by name, with a confidence score | $0.001 |
| **Get Company Profile** | Legal name, form, head office, activity, workforce, officers, VAT number | $0.005 |
| **Get KYB File** | Everything to onboard a supplier in one call, including sanctions screening | $0.15 |
| **Screen Sanctions** | A name against 6 official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO) | $0.02 |
| **Verify VAT Number** | An intra-EU VAT number, checked against VIES | $0.003 |
| **Get European Company** | 12 countries under one schema — every live register also has its own dedicated route | $0.01 |
| **Watch Companies** | 1 to 100 companies, notified when something changes | $0.05 |

Every paid answer carries its source, its freshness date and an Ed25519 signature, so an
audit trail comes for free.

## The workflow this node was built for

**Watch Companies** takes a webhook URL. Point it at an n8n **Webhook** node and you have
supplier monitoring in three nodes:

```
[Sirenic: Watch Companies] ──▶ (registers 1-100 suppliers, once)

[Webhook] ──▶ [Filter: insolvency] ──▶ [Slack]
      ▲
      └── Sirenic calls this whenever an officer changes, an insolvency
          is published, or a company is struck off.
```

Detection runs **daily**, aligned on how often the official sources publish — the BODACC
issues one edition a day. Nobody can honestly offer real time on registry data.

## Setup

1. Install the node: **Settings → Community Nodes → Install** → `n8n-nodes-sirenic`
2. Create a **Sirenic API** credential.

### Funding a wallet

You need a Base (mainnet) wallet holding USDC.

1. Create a **dedicated** wallet — never reuse your main one.
2. Fund it with USDC on Base. $5 covers thousands of calls.
3. Paste its private key into the credential.

The key never leaves your n8n instance: payments are signed locally, and only the resulting
signature travels to Sirenic.

### Spending caps are not optional

| Setting | Default | What it does |
|---|---|---|
| **Max Amount Per Call** | $0.20 | The node refuses to sign a quote above this, whatever the API asks |
| **Max Amount Per Execution** | $5.00 | Ceiling across every item of one execution — your protection against a loop over 10 000 rows |
| **Expected Payment Address** | Sirenic's address | The node refuses to pay anyone else, so a spoofed endpoint cannot redirect funds |

Turn on **Dry Run** in Options to see what a call would cost without paying for it.

## Coverage

**France** in depth (INSEE Sirene, INPI RNE, BODACC, filed accounts, procurement,
intellectual property, regulatory authorisations, industrial risks, lobbying).

**Europe — one operation, per-country official registers.** *Get European Company*
takes a country code and the national ID. Each live register is also exposed by the
API as its own dedicated route (e.g. `/v1/eu/entreprise/CH/CHE-107.480.920`), so
agents searching for one country find a dedicated, documented endpoint:

| Country | Official register | National ID |
|---|---|---|
| Belgium | KBO/BCE — plus NACEBEL activities, establishment units, NBB annual accounts, FSMA insider transactions | 10-digit enterprise number |
| Switzerland | Zefix (Central Business Name Index) | UID `CHE-…` |
| Norway | Brønnøysundregistrene | 9-digit organisasjonsnummer |
| Czechia | ARES | 8-digit IČO |
| Slovakia | RPO | 8-digit IČO |
| Finland | PRH / YTJ | Business ID (Y-tunnus) |
| Poland | KRS | KRS number |
| Estonia | e-Business Register (Äriregister) | 8-digit registrikood |
| Latvia | Uzņēmumu reģistrs | 11-digit registration number |
| United Kingdom | Companies House | company number |
| Denmark | CVR — coming soon | CVR number |

Anywhere else, entities carrying an LEI are served from GLEIF (worldwide).

**No beneficial ownership, ever.** The CJEU closed public UBO registers in 2022 and French
law excludes them from public dissemination. Sirenic does not reconstruct control chains —
which is precisely what keeps the data defensible under GDPR.

## Finding this node

In the n8n nodes panel, this node answers to what you would actually type —
**KYB**, **SIREN**, **SIRET**, **VAT**, **sanctions**, **due diligence**,
**supplier onboarding**, **company lookup** — not just to the name "Sirenic",
which tells you nothing until you already know us. It sits under **Data &
Storage**, **Finance & Accounting** and **Sales**.

## Compatibility

Requires n8n with Node.js ≥ 22.22. No runtime dependencies: everything is bundled.

## Resources

- API documentation: <https://api.sirenic.eu>
- Machine-readable tool list: <https://api.sirenic.eu/llms.txt>
- x402 protocol: <https://x402.org>

## License

MIT
