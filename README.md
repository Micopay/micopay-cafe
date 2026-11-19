# MicoPay Café

**Pay smallholder farmers per kilo, at the scale, in seconds — with bank-grade records anyone can verify.**

In Veracruz, during the harvest, *compradoras de café* (seasonal buying points) open in the coffee towns. Producers bring **café cereza** — the freshly picked fruit they cannot process themselves — and are paid per kilo, in cash, before the buyer carries it to the *beneficio*. MicoPay Café gives those buyers, and cooperatives, a way to pay on the spot without carrying cash.

MicoPay Café is a payments platform for coffee buyers and agricultural cooperatives built on **Stellar**. The buyer weighs a delivery, the platform settles it (kilos × price − quality deductions − credit repayment), and one atomic Stellar transaction pays every producer **and** repays their crop loan at the same time. Every run produces ISO 20022 messages that validate against the official schemas, and the hash of the payment order is written into the transaction memo, so the bank record and the ledger point at each other.

It is part of the [MicoPay](https://github.com/Micopay) ecosystem: the integration with the MicoPay app is planned, not available yet. As a future possibility, producers could receive the money in the app, keep it as digital pesos, send it to their bank via SPEI, or cash out with a MicoPay agent. The *compradora* itself could be that agent, so the producer could walk away with cash from the same counter.

> Built for **Find Your Way: Hackathon** (Stellar Passport) · General Track.

> **Status:** Prototype on Stellar Testnet, not a production service. **Custody:** MicoPay does not hold funds. The demo signs with a local testnet key; the planned production flow has the cooperative sign from the MicoPay app.

---

## The problem

- Coffee producers in southern Mexico sell through layers of intermediaries and are often paid late, in cash, with no record of how the price was computed.
- Buyers and cooperatives carry cash to collection points during the harvest and reconcile payments by hand.
- Since the national rural development bank (FND) was dissolved in 2023, producers lost access to affordable crop credit. In 2026, FIRA and Amecafé proposed that **coffee cooperatives disburse credit themselves** — but they have no tool to disburse, collect and report it. ([research, in Spanish](docs/FINANCIAMIENTO.md))

## What it does

Two areas, mirroring the original desktop apps (operator + admin) of [coffee-payments](https://github.com/Micopay/coffee-payments):

**Operation**
| Screen | What happens |
|---|---|
| **Realizar pago** | Pay at the scale: pick the producer, weigh, the daily price loads by default (overrides are audited), optional quality readings apply tiered deductions, confirm — the producer is paid **immediately** in one Stellar transaction |
| **Productores** | Search, sign-up (validates the Stellar address and whether the account can receive MXNe), profile with delivery history and credits |
| **Historial** | Filters by date, status and producer; payment detail with the ISO 20022 documents, retry only when it is proven the payment did not happen, CSV export, producer receipt |

**Administration**
| Screen | What happens |
|---|---|
| **Resumen del mes** | KPIs, amount paid per day, top 5 producers by kg |
| **Precio del día** | Reference price per product, with history |
| **Créditos** | Crop-loan portfolio — see the lifecycle below |
| **Prestamistas** | Who funds the loans (IFNB / SOFOM / bank on FIRA funding, or the cooperative as disperser), balances and portfolio |
| **Auditoría** | Audit log of every action, day close (`camt.053`), CSV exports |

### Crop-loan lifecycle

1. **Grant** — producer, lender, purpose, principal, annual rate, term, repayment % per delivery, due date. Interest is fixed at origination; the loan is *pendiente*.
2. **Disburse** — the lender pays the producer on Stellar. The memo is the **SHA-256 of the canonical loan terms** (downloadable as JSON), so the contract is anchored next to the money. Status: *vigente*. **Disabled for now:** an unconfirmed disbursement could be sent twice, so the route answers 503 and the seed leaves every loan *pendiente* until disbursement gets the same treatment as payments (below).
3. **Repay with the harvest** — each payment deducts the repayment and sends it to the lender **in the same atomic transaction** that pays the producer. Every repayment is a movement with its transaction hash.
4. **Administer** — pause/resume the automatic deduction, change the repayment %, cancel before disbursement. *Vencido* is derived when the due date passes with balance; *pagado* when the balance reaches zero.

### Every payment, end to end
`kilos × price − quality deduction − loan repayment` → **pain.001** with kilos, price, deductions and repayment in structured remittance → its SHA-256 becomes the memo of **one Stellar transaction** (producer + lender, all or nothing) → **pain.002** status → **camt.054** receipt for the producer → **camt.053** statement with balances reconstructed from Horizon.

### Payments that never pay twice

A payment is retried **only when it is proven it did not happen**. A network failure while sending can leave a payment on the ledger even though the answer never arrived, so the API never reads "no answer" or an error code as "no money moved".

- Before the transaction leaves the API, the attempt is stored with its hash, envelope, expiry and an immutable snapshot of everything its documents need. The delivery, its settlement and the attempt are created in one database transaction.
- Only two proofs settle an attempt: Horizon returns the transaction record (successful → **paid**; failed → **can be retried**), or the envelope never left the process (local signing failed, or the API stopped before sending).
- Anything else is **unconfirmed**. A background pass looks the hash up every minute; if the transaction never shows up after it expires, the attempt moves to **needs review** and stays blocked — the public Horizon cannot prove absence. `npm run review:run -w apps/api -- <runId>` (with the API stopped) looks it up again and closes it only on evidence.
- One open attempt per producer. A scale that sends a `clientRef` (UUID) gets the stored payment back when it repeats the request, even after a reload; without it, only the one-open-attempt rule protects against a resend.
- Signing from the MicoPay app is disabled for payments until its contract returns the signed envelope (the API answers 503 when it is configured).

API fields: `status` (`settled`, `unconfirmed`, `failed_onchain`, `not_executed`, `needs_review`), `paymentState` and `retryAllowed` on every payment; `GET /api/payments/by-ref/:clientRef`.

### Why Stellar

- **Atomic multi-operation transactions** make "pay the producer *and* collect the loan" a single, indivisible event — the property lenders care about most.
- Settlement in seconds for a fraction of a cent, in a peso-pegged token (MXNe; the demo issues its own on testnet).
- A public, tamper-evident ledger: the cooperative's records can be checked without trusting the cooperative or us. Personal data never goes on-chain — only amounts and hashes.

### Why ISO 20022

It is the language banks, ERPs, auditors and development lenders (FIRA, IFNBs) already read. We use the **customer-to-bank** messages (`pain.001`, `pain.002`) and the account-reporting ones (`camt.054`, `camt.053`). Kilos, price and quality deductions travel in `RmtInf/Strd`; the currency is always ISO 4217 (`MXN`) and the Stellar token is described in a single `SplmtryData` envelope. Every generated message is validated against the official XSD in the test suite. See [`docs/ISO20022.md`](docs/ISO20022.md) for the full study (in Spanish), including why the previous XRPL version's messages failed validation.

## Architecture

```
 cooperative operator (browser)
        │
 apps/web   React 19 + Vite + Tailwind 4, MicoPay design system
        │   REST
 apps/api   Fastify + Postgres (PGlite locally) ──── Stellar Horizon (testnet)
        │
 packages/iso20022   pain.001 · pain.002 · camt.054 · camt.053, XSD-validated
```

- **Generic products:** coffee cherry (freshly picked; no standard deductions — the price is negotiated at the scale), parchment coffee and cocoa are configured as data (unit, quality attributes, deduction tiers). Adding honey or milk needs no code.
- **Credit:** the loan contract is private (database); disbursement, repayments and the evidence hash are on-chain.
- **Signing:** the demo signs with a local testnet key. The plan is for the cooperative to sign from the **MicoPay app** via the `/sign-requests` endpoint of the MicoPay backend, so no private key touches the platform; it is disabled for payments until that endpoint returns the signed envelope.

## Run it locally

Requirements: Node 22+. No database to install (PGlite runs Postgres in-process).

```bash
npm install
npm run seed -w apps/api   # creates testnet accounts, funds demo USDC, loads a cooperative, producers and two pending loans
npm run dev:api            # http://127.0.0.1:8787
npm run dev:web            # http://localhost:5180
```

Then: **Realizar pago** → pick Pedro Martínez → *Café cereza* is preselected at the demo price → weigh 600 kg → **Ejecutar pago**. Open the transaction on stellar.expert and the ISO documents under **Historial**; the loans under **Créditos** stay pending while disbursement is disabled.

```bash
npm test                   # ISO 20022 messages vs official XSDs + settlement math
npx tsx apps/api/test/e2e.ts   # 30 end-to-end checks against testnet (API must be running, fresh seed)
```

Testnet keys are written to `data/testnet-keys.json`, which is git-ignored. Testnet only — never real funds. `CAFE_DATA_DIR` moves the database and keys elsewhere.

The API only starts on a database the seed created with the current schema (a "schema cut" row), and only one process (API, seed or review command) uses a data directory at a time. To start clean next to an old demo: stop the API, archive the whole data directory (keys included), then run the seed with `CAFE_DATA_DIR` pointing at a new, empty directory. `npm run audit:legacy -w apps/api -- <copy of the old pg directory>` reports, read-only, what Horizon shows for each old run.

## Status and roadmap

Working today on testnet: pay at the scale with unconfirmed-payment protection, producers, daily price, quality deductions, crop-loan administration (grant, pause, cancel; disbursement disabled), ISO 20022 messages, receipts, monthly summary, audit log, day close and exports.

Next:
1. Sign-in and signing with the MicoPay app (`/sign-requests`), replacing the local demo signer.
2. Shared users with the MicoPay backend on AWS (identity = Stellar address).
3. Operator roles and sign-in (the original app had operator/admin accounts), and lender reporting for FIRA credit dispersers.
4. The next leg of the supply chain: *compradora* → *beneficio*, with the same delivery → settlement → payment model.
5. Monthly anchoring of the credit portfolio hash on Stellar.
6. Optional quality escrow (Soroban), shared with MicoPay's rental platform.

## Versión en español

MicoPay Café es una plataforma para que las compradoras de café y las cooperativas paguen a los productores por kilo entregado, empezando por el café cereza que se compra en temporada de cosecha. Pagos y abonos a crédito salen en una sola transacción de Stellar, y cada corrida genera mensajes ISO 20022 validados contra los esquemas oficiales, con la huella del `pain.001` anclada en el memo de la transacción. La integración con la app de MicoPay está planeada y aún no está disponible; como posibilidad futura, el productor podría cobrar en la app en pesos digitales, por SPEI o en efectivo con un agente. Los documentos de diseño están en [`PLAN.md`](PLAN.md) y [`docs/`](docs/).

## License

MIT
