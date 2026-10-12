# MicoPay Café

**Pay smallholder farmers per kilo, at the scale, in seconds — with bank-grade records anyone can verify.**

MicoPay Café is a payments platform for agricultural cooperatives built on **Stellar**. A cooperative weighs a delivery, the platform settles it (kilos × price − quality deductions − credit repayment), and one atomic Stellar transaction pays every producer **and** repays their crop loan at the same time. Every run produces ISO 20022 messages that validate against the official schemas, and the hash of the payment order is written into the transaction memo, so the bank record and the ledger point at each other.

It is part of the [MicoPay](https://github.com/Micopay) ecosystem: producers receive the money in the MicoPay app and can keep it as digital pesos, send it to their bank via SPEI, or cash out with a MicoPay agent.

> Built for **Find Your Way: Hackathon** (Stellar Passport) · General Track.

---

## The problem

- Coffee producers in southern Mexico sell through layers of intermediaries and are often paid late, in cash, with no record of how the price was computed.
- Cooperatives carry cash to collection centers and reconcile payments by hand.
- Since the national rural development bank (FND) was dissolved in 2023, producers lost access to affordable crop credit. In 2026, FIRA and Amecafé proposed that **coffee cooperatives disburse credit themselves** — but they have no tool to disburse, collect and report it. ([research, in Spanish](docs/FINANCIAMIENTO.md))

## What it does

| Step | What happens | Where |
|---|---|---|
| 1. Weigh | The operator records a delivery: producer, product, kilos, humidity, defects | Web panel |
| 2. Settle | Live settlement: `kilos × price − quality deduction − credit repayment`, rounded once to cents | API, `settlement.ts` |
| 3. Order | A **pain.001** (Customer Credit Transfer Initiation) is built with kilos, price, deductions and repayment in structured remittance | `packages/iso20022` |
| 4. Pay | **One Stellar transaction** pays every producer and sends the repayments to the lender. All or nothing: a producer can never be paid while the loan repayment is skipped | API, `stellar.ts` |
| 5. Anchor | The transaction memo is the **SHA-256 of the pain.001**: anyone can hash the document and compare it with the ledger | Stellar memo |
| 6. Report | **pain.002** (status), **camt.054** (producer receipt) and **camt.053** (statement with balances reconstructed from Horizon) | Web + XML downloads |
| 7. Cash out | The producer sees a phone receipt and cashes out through the MicoPay app (digital, SPEI or cash agent) | `/recibo/:id` |

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

- **Generic products:** coffee and cocoa are configured as data (unit, quality attributes, deduction tiers). Adding honey or milk needs no code.
- **Credit:** the loan contract is private (database); disbursement, repayments and the evidence hash are on-chain.
- **Signing:** the demo signs with a local testnet key. In production the cooperative signs from the **MicoPay app** via the existing `/sign-requests` endpoint of the MicoPay backend — no private key ever touches the platform.

## Run it locally

Requirements: Node 22+. No database to install (PGlite runs Postgres in-process).

```bash
npm install
npm run seed -w apps/api   # creates testnet accounts, issues demo MXNe, loads a cooperative, 3 producers and a loan
npm run dev:api            # http://127.0.0.1:8787
npm run dev:web            # http://localhost:5180
```

Then: **Registrar entrega** → **Por pagar** → **Firmar y pagar en Stellar** → open the transaction on stellar.expert and the ISO documents under **Corridas**.

```bash
npm test                   # ISO 20022 messages vs official XSDs + settlement math
npx tsx apps/api/test/e2e.ts   # end-to-end against testnet (API must be running)
```

Testnet keys are written to `data/testnet-keys.json`, which is git-ignored. Testnet only — never real funds.

## Status and roadmap

Working today on testnet: deliveries, live settlement with quality deductions and credit repayment, atomic payment runs, ISO 20022 messages, receipts, statements.

Next:
1. Sign-in and signing with the MicoPay app (`/sign-requests`), replacing the local demo signer.
2. Shared users with the MicoPay backend on AWS (identity = Stellar address).
3. Credit module for cooperatives acting as FIRA credit dispersers: disbursement, schedules, lender reporting.
4. Monthly anchoring of the credit portfolio hash on Stellar.
5. Optional quality escrow (Soroban), shared with MicoPay's rental platform.

## Versión en español

MicoPay Café es una plataforma para que las cooperativas paguen a sus productores por kilo entregado. Pagos y abonos a crédito salen en una sola transacción de Stellar, y cada corrida genera mensajes ISO 20022 validados contra los esquemas oficiales, con la huella del `pain.001` anclada en el memo de la transacción. El productor cobra en la app de MicoPay: en pesos digitales, por SPEI o en efectivo con un agente. Los documentos de diseño están en [`PLAN.md`](PLAN.md) y [`docs/`](docs/).

## License

MIT
