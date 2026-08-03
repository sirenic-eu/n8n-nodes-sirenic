# Changelog

## 0.4.2 — 2026-08-03

Fixes found by auditing all 42 operations against the live API. Nine were broken
outright, six could cost money or return a plausible but wrong answer. Nothing in
the node tested the query-string contract, so nothing caught them; that test now
exists (`tests/query-contract.test.ts`).

### Money

- **Slow routes no longer abandon a paid call.** The client used a fixed 120 s
  timeout while the API grants 200 s on Capital Structure, Capital Links and the
  Intelligence Report — and settles the payment *after* the handler returns.
  Aborting early meant paying (up to $2.00) and discarding the answer. The wait
  is now derived from the window each quote declares, plus head-room for
  settlement, so future routes are covered without maintaining a table.
- **PDFs are delivered as files again.** The report ($0.50), the original filed
  documents ($0.10) and pre-2022 Belgian filings were read as text, which
  corrupts every non-UTF-8 byte: the user paid and received an unusable string.
  They now arrive as n8n binary data, ready to upload or attach.
- **Create Watch states its real price** — $0.05 *per target*, so $5.00 for 100,
  not the flat $0.05 shown before — and refuses to run without a delivery
  channel, which used to be payable and unreachable.
- **Prospecting no longer drops your headcount filter in silence.** It sent
  `tranche_effectif`, a parameter the API does not have and therefore ignores:
  the call succeeded, was charged, and returned an unfiltered list that looked
  right. It now sends `effectif_min` / `effectif_max`, and can page through
  results.
- **The European invoicing pack no longer produces a false blocking verdict.**
  It offered eleven countries where the API covers two (Belgium and Poland), and
  a Polish KRS silently failed the VAT and White List checks — reporting a
  healthy company as unsafe to invoice. The list is now BE/PL, and the field
  says Poland needs the NIP.

### Broken operations

- **Get Changes** never sent the required `depuis` date: every call answered 400.
  It now takes a Since date and refuses to spend anything without a valid one.
- **Get French Regulator Alerts** sent `q`, which the API never reads; it needs
  `nom` and/or `siren`. Two fields replace the dead one.
- **Renew Watch** sent no target list, which the API requires (renewal is priced
  per target): every renewal answered 400.
- **Get Company Accounts (PDF)** has been removed: production disabled that route
  on 2026-07-29 and it now answers 503, silently, while advertising $2.00.
- **Annual accounts** operations now refuse a country they do not serve, with the
  covered list in the message, instead of paying for a 400.
- **Get Insider Transactions** is Belgium-only (FSMA) and says so, instead of
  answering 404 for the other eleven countries in the menu.

### Behaviour

- An HTTP error now fails the node instead of being pushed as a normal item — a
  workflow no longer carries on with an error object where its data should be.
  Nothing is charged on an error; with *Continue On Fail*, the API's structured
  body (its machine-readable `error` code) is preserved so branching still works.
- A 404 that legitimately means "no data for this key" (insider filings, a
  company absent from a register, an unknown document) stays a normal item.
- Two free operations were added, **Get Watch** and **Stop Watch**, so a watch
  can be read back when a webhook cannot reach a self-hosted instance.
- VAT numbers and IBANs are normalised before the call: a number copied with
  spaces used to 400.
- The European search exposes a country filter. Without it, seven of the eleven
  countries in the menu could not be found by name at all.
- Sweden joined the country list; identifier formats are documented per country,
  since a wrong format comes back as "not found" and looks like a company that
  does not exist.

### If you have saved workflows

Two parameters were renamed, both on operations that could not work before, so
nothing that used to run stops running:

- Get French Regulator Alerts: `query` → **Name to Screen** and/or **SIREN to
  Screen** (the operation answered 400 on every call).
- Prospect: `workforce` → **Minimum Headcount** / **Maximum Headcount** (the old
  value never reached the API).

Re-enter those values on the affected nodes. Every other field kept its name.
