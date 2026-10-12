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

Two areas, mirroring the original desktop apps (operator + admin) of [coffee-payments](https://github.com/Micopay/coffee-payments):

**Operation**
| Screen | What happens |
|---|---|
| **Realizar pago** | Pay at the scale: pick the producer, weigh, the daily price loads by default (overrides are audited), optional quality readings apply tiered deductions, confirm — the producer is paid **immediately** in one Stellar transaction |
| **Productores** | Search, sign-up (validates the Stellar address and whether the account can receive MXNe), profile with delivery history and credits |
| **Historial** | Filters by date, status and producer; payment detail with the ISO 20022 documents, retry of rejected payments, CSV export, producer receipt |

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
2. **Disburse** — the lender pays the producer on Stellar. The memo is the **SHA-256 of the canonical loan terms** (downloadable as JSON), so the contract is anchored next to the money. Status: *vigente*.
3. **Repay with the harvest** — each payment deducts the repayment and sends it to the lender **in the same atomic transaction** that pays the producer. Every repayment is a movement with its transaction hash.
4. **Administer** — pause/resume the automatic deduction, change the repayment %, cancel before disbursement. *Vencido* is derived when the due date passes with balance; *pagado* when the balance reaches zero.

### Every payment, end to end
`kilos × price − quality deduction − loan repayment` → **pain.001** with kilos, price, deductions and repayment in structured remittance → its SHA-256 becomes the memo of **one Stellar transaction** (producer + lender, all or nothing) → **pain.002** status → **camt.054** receipt for the producer → **camt.053** statement with balances reconstructed from Horizon.

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

Then: **Realizar pago** → pick Juan Pérez (he has a disbursed loan) → weigh 250 kg with 13.5% humidity → **Ejecutar pago**. Open the transaction on stellar.expert and the ISO documents under **Historial**; follow the loan under **Créditos** (María's is pending: disburse it from there).

```bash
npm test                   # ISO 20022 messages vs official XSDs + settlement math
npx tsx apps/api/test/e2e.ts   # 26 end-to-end checks against testnet (API must be running, fresh seed)
```

Testnet keys are written to `data/testnet-keys.json`, which is git-ignored. Testnet only — never real funds.

## Status and roadmap

Working today on testnet: pay at the scale, producers, daily price, quality deductions, crop-loan administration (grant, anchored disbursement, automatic repayment, pause, cancel), ISO 20022 messages, receipts, monthly summary, audit log, day close and exports.

Next:
1. Sign-in and signing with the MicoPay app (`/sign-requests`), replacing the local demo signer.
2. Shared users with the MicoPay backend on AWS (identity = Stellar address).
3. Operator roles and sign-in (the original app had operator/admin accounts), and lender reporting for FIRA credit dispersers.
4. Monthly anchoring of the credit portfolio hash on Stellar.
5. Optional quality escrow (Soroban), shared with MicoPay's rental platform.

## Versión en español

MicoPay Café es una plataforma para que las cooperativas paguen a sus productores por kilo entregado. Pagos y abonos a crédito salen en una sola transacción de Stellar, y cada corrida genera mensajes ISO 20022 validados contra los esquemas oficiales, con la huella del `pain.001` anclada en el memo de la transacción. El productor cobra en la app de MicoPay: en pesos digitales, por SPEI o en efectivo con un agente. Los documentos de diseño están en [`PLAN.md`](PLAN.md) y [`docs/`](docs/).

## License

MIT
