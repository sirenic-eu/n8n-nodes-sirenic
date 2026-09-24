# n8n-nodes-sirenic

**Can you safely invoice or pay this company?** One n8n node answers it, for France and
Europe, from official registers, with **no subscription and no contract**. Company lookup
by name or SIREN, full company profiles, KYB due-diligence files, AML sanctions screening,
annual accounts and financial data, default-risk scoring and company monitoring, straight
from the official French company registry (INSEE Sirene, INPI RNE) and official European
registers.

Sirenic is paid per call, on either of two rails with the same routes and the same prices:
an **API key** charged against prepaid credits (the default: no wallet, no crypto), or
[x402](https://x402.org), where each request settles a small USDC payment on Base from your
own wallet, with no account at all. A single paid call costs **$0.002** to **$1.00**;
batch operations, prospect lists and watches are priced per company, per page or per
target. You only pay for calls that succeed.

## The node in use

![Verifying a French supplier from n8n](https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/media/demo-sirenic-node.gif)

Sixteen seconds, no commentary: open the Sirenic node, pick *Supplier Verification
& Invoicing → Verify French Supplier*, enter a SIREN, run it. This is a real paid
call against the live API, and the output is the actual verification file for Danone:
legal name and status, the computed intra-EU VAT number checked live against VIES,
the head office and its nineteen establishments. It cost $0.03, paid on the wallet
rail: settled in USDC on Base, with no account and no API key.

Not sure what a call will cost? Every operation states its price in its description.
On the wallet rail, the **Dry Run** option also fetches the quote, reports
`would_pay_usd`, and settles nothing: the node states the price before it spends. On
the API-key rail, a dry run confirms that the route exists and is billable, without
sending your key.

**Full demo (1 min 15, no sound, captions on screen):**
[demo-sirenic-node-full.mp4](https://github.com/sirenic-eu/n8n-nodes-sirenic/blob/main/media/demo-sirenic-node-full.mp4?raw=1)
walks through the whole thing on a self-hosted n8n 2.32.7: installing the package
from the npm registry, the wallet credential (a Base wallet with hard spending caps;
the video predates the API-key rail), the free *Suggest Names* operation answering live
from the French registry, a price read with **Dry Run** before any spend, and the
*Sirenic Trigger* panel.

The older sixteen-second clip is still there:
[demo-sirenic-node.mp4](https://github.com/sirenic-eu/n8n-nodes-sirenic/blob/main/media/demo-sirenic-node.mp4?raw=1).

## Verify a supplier before payment (use case #1)

The deadline is not ours: from **1 September 2026** every French company subject to VAT must
be able to **receive** electronic invoices. Issuance is phased: large and mid-size companies
from that same date, SMEs and micro-businesses from **1 September 2027**. Belgium's B2B
mandate has been live since **1 January 2026**.

*Supplier Verification & Invoicing → **Verify a supplier before payment*** ($0.03) answers in
a single call:

| What comes back | Where it comes from |
|---|---|
| Legal identity, status, e-invoicing obligation dates | INSEE Sirene, INPI RNE |
| The intra-EU VAT number, checked **live** | VIES (European Commission) |
| IBAN structure check, then the bank identified | Official bank registries (ACPR/REGAFI, NBB, GLEIF BIC-to-LEI…) |
| A deterministic verdict, `pret_a_facturer` true/false | Computed by Sirenic, with reasons from a **closed list**, each tagged blocking or informational |

A VIES outage yields an honest non-blocking reason, never a false invalid.

For a counterparty outside France, ***Verify a European supplier before payment*** ($0.03)
returns the same verdict, plus Peppol reachability for Belgium and, uniquely in Poland,
whether the IBAN is **declared by that taxpayer** in the official White List (*wykaz
podatników VAT*). Paying more than **15,000 PLN** into an undeclared account costs the buyer
the VAT deduction and creates joint liability for the VAT.

Two limits, carried by the responses themselves and worth repeating here:

- **This is not a payee verification.** The account holder's name is never checked
  (`verification_titulaire: "non_disponible"`).
- **Sirenic is not an accredited platform (PDP).** It has no access to the central directory,
  and it never issues, transmits, converts or routes invoices. It verifies and prepares,
  nothing else.

The pieces are also sold on their own: *Prepare E-Invoicing* ($0.02), *Verify IBAN* ($0.005),
*Verify VAT Number* ($0.003).

## What else you can do

| Operation | What it answers | Price |
|---|---|---:|
| **Suggest Names** | "I have a name, what is its SIREN?": up to 5 matches with city and activity code | **free** |
| **Search Company** | "Which company is this, exactly?": by name, with a confidence score, and it forgives typos | $0.002 |
| **Get Company Profile** | Legal name, form, head office, activity, workforce, officers, VAT number | $0.005 |
| **Get Company File** | Several things about one company without chaining calls: you pick the blocks | $0.005 + per block, max $0.35 |
| **Search BODACC Announcements** | The other direction: *which* companies entered insolvency in this department this week | $0.03 |
| **Get KYB File** | Everything to onboard a supplier in one call, including sanctions screening | $0.15 |
| **Screen Sanctions** | A name against 6 official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO) | $0.02 |
| **Get European Company** | One schema across the national registers listed under *Coverage*, each also served by the API on its own dedicated route | $0.01 |
| **Get Company Officers** (EU) | Officers and board members from seven national registers, one schema: CY, DK, EE, GB, LV, NO, RO | $0.01 |
| **Get Insolvency Record** (EU) | Insolvency proceedings from eight official registers: CH, CZ, GB, HR, IE, LT, LV, RO | $0.02 |
| **Verify Invoice** | The three identifiers printed on an invoice at once: SIREN against Sirene, VAT against VIES, IBAN form and bank | $0.02 |
| **Compare French Companies** | Two to five side by side: per-axis rankings only, never an overall winner | $0.12 per company |
| **Get Expiring Public Contracts** | Public contracts whose estimated end date falls in your window: buyers re-tender 4 to 9 months ahead | $0.05 |
| **Search Associations** | "I have the name of an association": the national register of associations (RNA), where **one association in two has no SIREN** | $0.002 |
| **Get Association Profile** | Title, purpose, position, dates, registered office, RUP number, by RNA number | $0.005 |
| **Get Association Official-Journal Notices** | Creations, modifications and dissolutions published in the JOAFE, the gazette of the nonprofit world | $0.01 |
| **Sirenic Trigger** | Starts a workflow when a watched company changes, 1 to 100 of them | $0.05 / $0.135 / $0.50 per target (30 / 90 / 365 days) |

Every paid answer carries its source, its freshness date and an Ed25519 signature, so an
audit trail comes for free.

## The workflows this node was built for

### Check the supplier, then release the payment (accounts payable)

```
[New supplier, or a new invoice] ──▶ [Sirenic: Verify a supplier before payment]
                                                    │
              pret_a_facturer = true  ──▶ [Approve the payment run]
              pret_a_facturer = false ──▶ [Human review, with the blocking reason]
```

The verdict is deterministic and its reasons come from a closed list, so the *false* branch
can be routed on the reason itself (ceased company, VAT invalid at VIES, invalid IBAN) rather
than on free text. The signed response is the audit trail your accountant will ask for.

### Supplier monitoring with one node

The **Sirenic Trigger** owns the watch from end to end. Give it 1 to 100 SIRENs and
activate the workflow: it registers them with Sirenic against its own URL, receives the
signed events, and renews the watch before it runs out.

```
[Sirenic Trigger] ──▶ [Filter: insolvency] ──▶ [Slack]
      ▲
      └── fires whenever an officer changes, an insolvency is published,
          or a company is struck off.
```

Activating the workflow **pays** for the watch, at the per-target price of the chosen
**Duration**:

| Duration | Per target | 100 targets | vs. paying monthly |
| --- | --- | --- | --- |
| 30 days | $0.05 | $5.00 | baseline |
| 90 days | $0.135 | $13.50 | −10 % |
| 365 days | $0.50 | $50.00 | −17.8 % |

On the wallet rail, raise *Max Amount Per Call* on the credential accordingly: a yearly
watch on 100 targets quotes at $50.00, well above the $1.00 default. On the API-key rail,
the watch is debited from your prepaid credits. Nothing else spends anything: re-activating
re-uses the watch it already bought, a test listen refuses to create one, and deactivating
keeps the days you have paid for. Payment is final: stopping a watch refunds nothing.

Changing **Duration** on a workflow that is already active charges nothing and does not
restart the watch: the new duration is what the next **renewal** buys.

Sirenic only calls a **public HTTPS URL on port 443**. A self-hosted n8n the internet
cannot reach must set **Delivery** to *Polling*: the watch is then created with no webhook
channel and the node reads its events back for free.

Detection runs **daily**, aligned on how often the official sources publish: the BODACC
issues one edition a day. Nobody can honestly offer real time on registry data.

## Setup

1. Install the node: **Settings → Community Nodes → Install** → `n8n-nodes-sirenic`
2. Pick a rail on the node's **Authentication** field, and create the matching credential.

### Two ways to pay, pick one

Same routes, same prices, same responses. Only the payment header differs.

| | **API Key** (default) | **Wallet** (x402) |
| --- | --- | --- |
| What you hold | A key from [api.sirenic.eu/compte](https://api.sirenic.eu/compte), created with an e-mail and a magic link | A Base private key funded with USDC |
| How you pay | Prepaid credits, in euros | A USDC payment signed per call |
| Account | Yes | None at all |
| Free tier | 150 calls a month on routes at $0.05 or less | None |
| Ceiling | Counts what the API reports it charged, stops before crossing | Refuses a quote above the cap, before signing |

**Which one?** If you are a finance, CRM or procurement team, take the API key:
there is nothing to fund and nothing to sign. The wallet exists for agents and for
anyone who would rather not open an account at all: it is the only rail that needs
no e-mail address.

Ready-made workflows take the API-key rail with n8n's native nodes (HTTP Request, MCP
Client Tool) instead of this community node, so they also run on n8n Cloud: the six in
the [`templates/`](https://github.com/sirenic-eu/n8n-nodes-sirenic/tree/main/templates)
folder of this repository, and twelve more at <https://api.sirenic.eu/workflows>.

### Funding a wallet

*Only for the wallet rail. Skip this if you took the API key.*

You need a Base (mainnet) wallet holding USDC.

1. Create a **dedicated** wallet, never your main one.
2. Fund it with USDC on Base. $5 covers thousands of calls.
3. Paste its private key into the credential.

The key never leaves your n8n instance: payments are signed locally, and only the resulting
signature travels to Sirenic.

### Spending caps are not optional

On the wallet rail, three settings of the credential stand between a workflow and your
funds:

| Setting | Default | What it does |
|---|---|---|
| **Max Amount Per Call** | $1.00 | The node refuses to sign a quote above this, whatever the API asks |
| **Max Amount Per Execution** | $5.00 | Ceiling across every item of one execution, your protection against a loop over 10 000 rows |
| **Expected Payment Address** | Sirenic's address | The node refuses to pay anyone else, so a spoofed endpoint cannot redirect funds |

On the API-key rail, **Max Spend Per Execution** (default $5.00) adds up what the API
reports it charged and stops before the next call once the ceiling is reached; 0 means no
ceiling.

On the wallet rail, turn on **Dry Run** in Options to see what a call would cost without
paying for it.

## Coverage

**France** in depth (INSEE Sirene, INPI RNE, BODACC, filed accounts, procurement,
intellectual property, regulatory authorisations, industrial risks, lobbying).

**Europe: one operation, per-country official registers.** *Get European Company*
takes a country code and the national ID. Each live register is also exposed by the
API as its own dedicated route (e.g. `/v1/eu/entreprise/CH/CHE-107.480.920`), so
agents searching for one country find a dedicated, documented endpoint:

| Country | Official register | National ID |
|---|---|---|
| Belgium | KBO/BCE, plus NACEBEL activities, establishment units, NBB annual accounts, FSMA insider transactions | 10-digit enterprise number |
| Switzerland | Zefix (Central Business Name Index) | UID `CHE-…` |
| Norway | Brønnøysundregistrene | 9-digit organisasjonsnummer |
| Czechia | ARES | 8-digit IČO |
| Slovakia | RPO | 8-digit IČO |
| Finland | PRH / YTJ | Business ID (Y-tunnus) |
| Poland | KRS | KRS number |
| Estonia | e-Business Register (Äriregister) | 8-digit registrikood |
| Latvia | Uzņēmumu reģistrs | 11-digit registration number |
| United Kingdom | Companies House | company number |
| Denmark | CVR (coming soon) | CVR number |

Anywhere else, entities carrying an LEI are served from GLEIF (worldwide).

**No ownership chains up to natural persons, ever.** The CJEU ended public access to the
registers of ultimate owners in 2022, and French law excludes them from public
dissemination. Sirenic does not reconstruct control chains, which is precisely what keeps
the data defensible under GDPR.

## Finding this node

In the n8n nodes panel, this node answers to what you would actually type
(**e-invoicing**, **IBAN**, **VAT**, **supplier**, **onboarding**, **KYB**,
**SIREN**, **SIRET**, **sanctions**, **due diligence**, **company lookup**),
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
