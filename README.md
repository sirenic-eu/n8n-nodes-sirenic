# n8n-nodes-sirenic

**Can you safely invoice or pay this company?** One n8n node answers it, for France and
Europe, from official registers — **no API key, no account, no contract**. Company lookup
by name or SIREN, full company profiles, KYB due-diligence files, AML sanctions screening,
annual accounts and financial data, default-risk scoring and company monitoring — straight
from the official French company registry (INSEE Sirene, INPI RNE) and official European
registers.

Sirenic is paid per call over [x402](https://x402.org): each request settles a small USDC
payment on Base. You bring a wallet, you set a spending cap, you are done. Prices run from
**$0.001** to **$2.00** per call, and you only pay for calls that succeed.

## The node in use

![Verifying a French supplier from n8n](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/media/demo-sirenic-node.gif)

Sixteen seconds, no commentary: open the Sirenic node, pick *Supplier Verification
& Invoicing → Verify French Supplier*, enter a SIREN, run it. This is a real paid
call against the live API — the output is the actual verification file for Danone:
legal name and status, the computed intra-EU VAT number checked live against VIES,
the head office and its nineteen establishments. It cost $0.03, settled in USDC on
Base, with no account and no API key.

Not sure what a call will cost? Switch on the **Dry Run** option: the node fetches
the quote, reports `would_pay_usd`, and settles nothing. It states the price before
it spends.

Full video: [demo-sirenic-node.mp4](https://github.com/sirenic-eu/n8n-nodes-sirenic/blob/main/media/demo-sirenic-node.mp4?raw=1).

## Use case #1 — Verify a supplier before payment

The deadline is not ours: from **1 September 2026** every French company subject to VAT must
be able to **receive** electronic invoices. Issuance is phased — large and mid-size companies
from that same date, SMEs and micro-businesses from **1 September 2027**. Belgium's B2B
mandate has been live since **1 January 2026**.

*Supplier Verification & Invoicing → **Verify a supplier before payment*** ($0.03) answers in
a single call:

| What comes back | Where it comes from |
|---|---|
| Legal identity, status, e-invoicing obligation dates | INSEE Sirene, INPI RNE |
| The intra-EU VAT number, checked **live** | VIES (European Commission) |
| IBAN structure check, then the bank identified | Official bank registries (ACPR/REGAFI, NBB, GLEIF BIC-to-LEI…) |
| A deterministic verdict, `pret_a_facturer` true/false | Computed by Sirenic — reasons from a **closed list**, each tagged blocking or informational |

A VIES outage yields an honest non-blocking reason, never a false invalid.

For a counterparty outside France, ***Verify a European supplier before payment*** ($0.03)
returns the same verdict, plus Peppol reachability for Belgium and — uniquely in Poland —
whether the IBAN is **declared by that taxpayer** in the official White List (*wykaz
podatników VAT*). Paying more than **15,000 PLN** into an undeclared account costs the buyer
the VAT deduction and creates joint liability for the VAT.

Two limits, carried by the responses themselves and worth repeating here:

- **This is not a payee verification.** The account holder's name is never checked
  (`verification_titulaire: "non_disponible"`).
- **Sirenic is not an accredited platform (PDP).** It has no access to the central directory,
  and it never issues, transmits, converts or routes invoices. It verifies and prepares —
  nothing else.

The pieces are also sold on their own: *Prepare E-Invoicing* ($0.02), *Verify IBAN* ($0.005),
*Verify VAT Number* ($0.003).

## What else you can do

| Operation | What it answers | Price |
|---|---|---:|
| **Suggest Names** | "I have a name, what is its SIREN?" — up to 5 matches with city and activity code | **free** |
| **Search Company** | "Which company is this, exactly?" — by name, with a confidence score, and it forgives typos | $0.001 |
| **Get Company Profile** | Legal name, form, head office, activity, workforce, officers, VAT number | $0.005 |
| **Get Company File** | Several things about one company without chaining calls — you pick the blocks | $0.005 + per block, max $0.35 |
| **Get KYB File** | Everything to onboard a supplier in one call, including sanctions screening | $0.15 |
| **Screen Sanctions** | A name against 6 official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO) | $0.02 |
| **Get European Company** | 12 countries under one schema — every live register also has its own dedicated route | $0.01 |
| **Sirenic Trigger** | Starts a workflow when a watched company changes — 1 to 100 of them | $0.05 per target |

Every paid answer carries its source, its freshness date and an Ed25519 signature, so an
audit trail comes for free.

## The workflows this node was built for

### Accounts payable — check the supplier, then release the payment

```
[New supplier, or a new invoice] ──▶ [Sirenic: Verify a supplier before payment]
                                                    │
              pret_a_facturer = true  ──▶ [Approve the payment run]
              pret_a_facturer = false ──▶ [Human review, with the blocking reason]
```

The verdict is deterministic and its reasons come from a closed list, so the *false* branch
can be routed on the reason itself (ceased company, VAT invalid at VIES, invalid IBAN) rather
than on free text. The signed response is the audit trail your accountant will ask for.

### Supplier monitoring — one node

The **Sirenic Trigger** owns the watch from end to end. Give it 1 to 100 SIRENs and
activate the workflow: it registers them with Sirenic against its own URL, receives the
signed events, and renews the watch before it runs out.

```
[Sirenic Trigger] ──▶ [Filter: insolvency] ──▶ [Slack]
      ▲
      └── fires whenever an officer changes, an insolvency is published,
          or a company is struck off.
```

Activating the workflow **pays** for the watch: $0.05 per target for 30 days, so $5.00 for
the maximum of 100 — raise *Max Amount Per Call* on the credential accordingly. Nothing
else spends anything: re-activating re-uses the watch it already bought, a test listen
refuses to create one, and deactivating keeps the days you have paid for.

Sirenic only calls a **public HTTPS URL on port 443**. A self-hosted n8n the internet
cannot reach must set **Delivery** to *Polling*: the watch is then created with no webhook
channel and the node reads its events back for free.

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
**e-invoicing**, **IBAN**, **VAT**, **supplier**, **onboarding**, **KYB**,
**SIREN**, **SIRET**, **sanctions**, **due diligence**, **company lookup** —
not just to the name "Sirenic", which tells you nothing until you already know
us. It sits under **Data & Storage**, **Finance & Accounting** and **Sales**.

## Compatibility

Requires n8n with Node.js ≥ 22.22. No runtime dependencies: everything is bundled.

## Resources

- API documentation: <https://api.sirenic.eu>
- Machine-readable tool list: <https://api.sirenic.eu/llms.txt>
- x402 protocol: <https://x402.org>

## License

MIT
