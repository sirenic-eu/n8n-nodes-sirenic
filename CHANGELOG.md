# Changelog

## 0.10.1 — 2026-08-13

Nothing changes for a workflow that already runs. This release exists to clear
the four points n8n's verification review raised on 0.7.0–0.10.0.

### Published with npm provenance again

0.7.0 through 0.10.0 were published by hand from a laptop, so npm minted no
provenance attestation for them — and provenance has been mandatory for
community nodes since 1 May 2026. Nothing was wrong with the workflow in
`.github/workflows/publish.yml`; it was simply bypassed, since it only runs on a
`v*` tag and no tag was pushed for those four versions.

So that the shortcut cannot be taken again, `npm publish` now refuses to run
outside GitHub Actions, and the workflow checks the registry afterwards to
confirm the attestation really landed rather than trusting the flag.

### English source comments

Two comment blocks added in 0.8.0 were written in French. Translated, along with
the French comments and test name in `tests/operations.test.ts`, which the review
did not reach but the rule covers.

### Deactivating a trigger now clears all of its stored state

`create()` initialises the event-deduplication memory in the node's static data,
and `delete()` left it behind. Every key is now cleared, the cached signing key
included, so the two hooks are symmetric and a deactivated trigger keeps nothing.
There was no user-visible effect — the next activation reset that memory anyway.
A test now activates and deactivates for real and requires the static data to
come back empty, so a key added later cannot slip through.

## 0.10.0 — 2026-08-11

### Search the BODACC gazette by criteria, not by company

**Due Diligence → Search BODACC Announcements** ($0.03) answers the other
direction: not *is this company in trouble* but **which companies are**. Pick a
family (insolvency proceedings, accounts filings, deregistrations, sales,
incorporations, conciliation…), a publication window and optionally a French
department; get up to 100 announcements, newest first, each with its SIREN, court
and town.

It is built for a scheduled workflow: run it every morning on your department and
route what comes out.

Two limits the response carries itself, and they are deliberate:

- **Sole traders are excluded** — their name is personal data — and their number
  is returned in `exclues_personnes_physiques`, so an empty answer is never
  ambiguous. Records whose person type the gazette leaves unreadable are excluded
  too and counted apart in `exclues_type_indetermine`.
- **The judgment is STRUCTURED** (nature, date, family). Its operative free text
  is removed everywhere, because it names court-appointed administrators together
  with their address. Facts that live only in that text — the date of cessation
  of payments, for one — are therefore not in the response: follow the
  `url_bodacc` field to the official publication.

It is now the first operation of the Due Diligence resource.

## 0.9.0 — 2026-08-11

### Watch duration: 30, 90 or 365 days, cheaper the longer you commit

**Sirenic Trigger** gains a **Duration** option. A watch used to last 30 days,
full stop; it can now run 30, 90 or 365 days, and the per-target price falls as
the commitment grows:

| Duration | Per target | 100 targets | vs. paying monthly |
| --- | --- | --- | --- |
| 30 days | $0.05 | $5.00 | — |
| 90 days | $0.135 | $13.50 | −10 % |
| 365 days | $0.50 | $50.00 | −17.8 % |

- **Nothing changes for existing workflows.** Duration defaults to 30 days, so a
  workflow saved before this release keeps the exact behaviour and the exact
  price it had.
- **Renewals buy the current Duration**, not the original one — a 30-day watch
  can roll over into a year.
- **Changing Duration on an active workflow charges nothing** and does not
  restart the watch: the current one is already paid for. The new value applies
  at the next renewal.
- Sirenic now emits an `expiration_proche` event 7 days before a watch expires,
  which lines up with when this node renews.

### Fixed: the credential default refused a yearly watch

`Max Amount Per Call` defaulted to **$0.20**. A single target bought for a year
quotes at **$0.50**, so the node refused it *client-side*, before the API was
even asked. The default is now **$1.00**, and the field explains that batched
and monitoring routes are priced per entity. Existing credentials keep their own
stored value — only newly created ones start at the new default.

## 0.8.0 — 2026-08-11

### Get Company File: one call, pick your blocks

**Due Diligence → Get Company File (Pick Blocks)** returns the identity base
plus only the blocks you ask for: `etablissements`, `alertes_bodacc`,
`finances`, `marches_publics`, `marches_publics_ue`, `lobbying`,
`risques_industriels`, `agrements`, `pi`, `documents`, `facturation_prep`,
`score`.

- **Grouping never costs more than calling separately.** Each block is priced at
  exactly what its own operation costs, on top of a $0.005 identity base, and
  the total is capped at $0.35. Duplicates are billed once.
- **A block that cannot be served is NAMED, with a reason**: `aucune_donnee` (a
  negative answer — the company has no patents, no public contracts),
  `non_diffusible` (partial Sirene diffusion / GDPR guard) or `panne_amont`
  (upstream register down). If EVERY requested block is down, the call returns
  503 and nothing is charged.
- It is a **dump of facts**, not a verdict. For a verdict, use *Get Intelligence
  Report* ($1.00).
- It is now the first operation of the Due Diligence resource.

### Fixed: the 0.7.0 default never actually changed

0.7.0 claimed *Suggest Names* had become the default operation of the French
Company resource. **It had not.** The change was made to an internal table that
nothing reads; the dropdown that n8n actually shows kept its own literal, so the
node still opened on the paid *Search Company*. Both dropdowns are corrected in
this release, and a new test reads the literals n8n really uses — the previous
test only checked the unused table, which is why the mistake shipped.

## 0.7.0 — 2026-08-11

### A free operation, and it is the new default

**French Company → Suggest Names (Free)** turns the start of a company name into
its SIREN: up to five matches with city, postcode, activity code and
active/ceased status. It calls `GET /v1/suggestions`, which sits outside
Sirenic's price list — the node's pre-flight request gets a `200` and no payment
is ever signed.

- **It is now the default operation of the French Company resource.** Dropping
  the node on a canvas and running it once should not spend money to show what
  it does. Existing workflows are untouched: they store their own operation.
- **Use it upstream of everything else.** Every other operation takes a SIREN;
  this one produces it for nothing. Chain it into Get Company Profile, Get KYB
  File or the Sirenic Trigger.
- **What it deliberately does not do:** no typo tolerance and no confidence
  score. Those stay in *Search Company* ($0.001), which also reaches names it
  cannot. Matching is on the START of the registered name, then whole words.
- **Still needs credentials configured**, like every other operation — the node
  reads them once per execution. Nothing is charged for this operation, but the
  node does not yet run credential-free; if that matters for your use case, call
  the REST endpoint or the MCP tool `suggest_company_names` directly, both of
  which need no account at all.

## 0.6.0 — 2026-08-06

### The watch lifecycle moved into the Sirenic Trigger

n8n's review asked for it, and they were right: a subscription where the caller
hands over the URL is their trigger pattern, not a set of one-shot actions.
Watch Companies, Get Watch, Stop Watch and Renew Watch have left the Sirenic
node. The trigger now owns the whole thing, and there is nothing to copy across
between two nodes any more.

- **Activating the workflow creates the watch** and pays for it — $0.05 per
  target for 30 days, $5.00 for the maximum of 100. The URL registered is the
  node's own production URL.
- **Deactivating keeps it**, by default: the watch is prepaid for 30 days and
  stopping it early forfeits the rest. A switch stops and purges it instead.
- **Re-activating pays nothing.** `checkExists` reads the stored watch back
  through the free route; only a watch Sirenic reports as gone leads to a new,
  paid one.
- **A test listen never pays.** n8n runs these same hooks for "Listen for test
  event", against a throwaway URL — so the node refuses rather than buy a watch
  that would post into the void.
- **An unreachable API fails the activation** instead of assuming the watch
  vanished and paying for a second one.
- **Renewal happens before expiry**, at the same price per target. Turned off,
  the node emits a `surveillance_expiree` item: an active workflow whose watch
  has quietly expired looks monitored and is not.
- **Polling delivery creates a channel-less watch**, so a self-hosted n8n that
  Sirenic cannot call still works — the node reads the events for free.

### Breaking

- The **Monitoring** resource is gone from the Sirenic node, which now exposes 38
  operations instead of 42. A workflow built on Watch Companies, Get Watch, Stop
  Watch or Renew Watch moves to the Sirenic Trigger. A watch created outside n8n
  keeps working: set **Watch** to *Already created elsewhere* and paste its token.
- The trigger asks for the Sirenic API credential **when it manages the watch**.
  It still needs none to receive the events of a watch created elsewhere.

### Tests

81 pass (was 71): 13 new ones pin the money rules above — no payment on a test
listen, no second payment on re-activation, no payment when the API is silent.

## 0.5.1 — 2026-08-03

Documentation only, no code change.

The demo recording is now linked with absolute URLs. The npm package ships `dist/`
alone, so a relative path rendered as a broken image on npmjs.com — which is exactly
where someone evaluating the node looks first.

## 0.5.0 — 2026-08-03

### Sirenic Trigger

A second node: your workflow now starts when a watched company changes, instead
of asking. Point it at a watch and it fires on insolvency proceedings, officer
changes, deregistration, sanctions hits and the other events the daily check
finds.

Two modes, because Sirenic only accepts a webhook URL that is public HTTPS on
port 443 — which rules out most self-hosted instances:

- **Webhook**: Sirenic pushes signed batches. The node verifies the Ed25519
  signature of every delivery and refuses anything else with a 401. The public
  key is fetched from `/.well-known/sirenic-signing-key` and cached, so a key
  rotation is picked up instead of turning every batch into a forgery.
- **Polling**: the node reads the watch through its free read route. It works
  behind a firewall, and it is the only way to test your wiring — the API sends
  nothing when a watch is created.

Two deliberate design choices:

- **The trigger never spends money.** Creating or renewing a watch is priced per
  target (up to $5.00 for 100), so it stays an explicit action on the main
  Sirenic node. Activating a workflow charges nobody: the trigger hands you a
  URL and you pass it to Create Watch yourself.
- **No credential required.** Receiving events costs nothing and the read route
  is authorised by the watch token, so a trigger has no business asking for a
  wallet private key.

On duplicates: the API sends no event id and retries a batch up to three times
with identical bytes, so every item carries `_sirenic.event_key`, a stable hash
of the event. Polling mode remembers the keys it has already emitted. Webhook
mode cannot — n8n discards what a webhook context writes to static data once it
starts an execution — so chain a Remove Duplicates node on that key if your
workflow is not idempotent.

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
