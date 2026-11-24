# MicoPay Café

**Pay smallholder farmers per kilo, at the scale, in seconds — with bank-grade records anyone can verify.**

In Veracruz, during the harvest, *compradoras de café* (seasonal buying points) open in the coffee towns. Producers bring **café cereza** — the freshly picked fruit they cannot process themselves — and are paid per kilo, in cash, before the buyer carries it to the *beneficio*. MicoPay Café gives those buyers, and cooperatives, a way to pay on the spot without carrying cash.

MicoPay Café is a payments platform for coffee buyers and agricultural cooperatives built on **Stellar**. The buyer weighs a delivery, the platform settles it (kilos × price − quality deductions), and a Stellar transaction pays the producer on the spot. Every payment produces ISO 20022 messages that validate against the official schemas, and the hash of the payment order is written into the transaction memo, so the bank record and the ledger point at each other.

> Built for **Find Your Way: Hackathon** (Stellar Passport) · General Track.

> **Status:** Prototype on Stellar Testnet, not a production service. **Custody:** MicoPay does not hold funds. The demo signs with a local testnet key; the planned production flow has the cooperative sign from the MicoPay app.

---

## How it connects to the MicoPay app (planned)

MicoPay Café is part of the [MicoPay](https://github.com/Micopay) ecosystem. **Today it runs on its own and does not use the MicoPay app yet.** The planned connection:

- **The producer gets paid in the MicoPay app.** There they can keep the money as digital pesos, send it to their bank via SPEI, or cash out with a MicoPay agent.
- **The *compradora* could be that agent**, so the producer walks away with cash from the same counter where they were weighed and paid.
- **The buyer signs payments from the MicoPay app**, so no private key ever touches the platform.
- **One identity across MicoPay products:** the Stellar address.

---

## The problem

- Coffee producers in southern Mexico sell through layers of intermediaries and are often paid late, in cash, with no record of how the price was computed.
- Buyers and cooperatives carry cash to collection points during the harvest and reconcile payments by hand.

## What it does

Two areas, mirroring the original desktop apps (operator + admin) of [coffee-payments](https://github.com/Micopay/coffee-payments):

**Operation**
| Screen | What happens |
|---|---|
| **Realizar pago** | Pay at the scale: pick the producer, weigh, the daily price loads by default (overrides are audited), optional quality readings apply tiered deductions, confirm — the producer is paid **immediately** in one Stellar transaction |
| **Productores** | Search, sign-up (validates the Stellar address and whether the account can receive the payment asset), profile with delivery history |
| **Historial** | Filters by date, status and producer; payment detail with the ISO 20022 documents, retry only when it is proven the payment did not happen, CSV export, producer receipt |

**Administration**
| Screen | What happens |
|---|---|
| **Resumen del mes** | KPIs, amount paid per day, top 5 producers by kg |
| **Precio del día** | Reference price per product, with history |
| **Auditoría** | Audit log of every action, day close (`camt.053`), CSV exports |

> **Crop loans: a possible future feature.** The demo contains crop-loan screens (**Créditos**, **Prestamistas**) from the hackathon: a lender grants a loan and each payment repays part of it in the same Stellar transaction. It is not part of the current product, disbursement is disabled (the route answers 503) and seeded loans stay *pendiente*. It may be built later; the background research (FIRA and coffee cooperatives disbursing credit) is in [`docs/FINANCIAMIENTO.md`](docs/FINANCIAMIENTO.md) (Spanish).

### Every payment, end to end
`kilos × price − quality deduction` → **pain.001** with kilos, price and deductions in structured remittance → its SHA-256 becomes the memo of **the Stellar transaction** → **pain.002** status → **camt.054** receipt for the producer → **camt.053** statement with balances reconstructed from Horizon.

### Payments that never pay twice

A payment is retried **only when it is proven it did not happen**. A network failure while sending can leave a payment on the ledger even though the answer never arrived, so the API never reads "no answer" or an error code as "no money moved".

- Before the transaction leaves the API, the attempt is stored with its hash, envelope, expiry and an immutable snapshot of everything its documents need. The delivery, its settlement and the attempt are created in one database transaction.
- Only two proofs settle an attempt: Horizon returns the transaction record (successful → **paid**; failed → **can be retried**), or the envelope never left the process (local signing failed, or the API stopped before sending).
- Anything else is **unconfirmed**. A background pass looks the hash up every minute; if the transaction never shows up after it expires, the attempt moves to **needs review** and stays blocked — the public Horizon cannot prove absence. `npm run review:run -w apps/api -- <runId>` (with the API stopped) looks it up again and closes it only on evidence.
- One open attempt per producer. A scale that sends a `clientRef` (UUID) gets the stored payment back when it repeats the request, even after a reload; without it, only the one-open-attempt rule protects against a resend.
- Signing from the MicoPay app is disabled for payments until its contract returns the signed envelope (the API answers 503 when it is configured).

API fields: `status` (`settled`, `unconfirmed`, `failed_onchain`, `not_executed`, `needs_review`), `paymentState` and `retryAllowed` on every payment; `GET /api/payments/by-ref/:clientRef`.

### Why Stellar

- Settlement in seconds for a fraction of a cent.
- **Any Stellar asset:** the payment asset is configuration, not code, so a buyer can pay in an existing tokenized peso, one issued by a third party, or digital dollars. The demo uses MicoPay's testnet USDC.
- A public, tamper-evident ledger: the cooperative's records can be checked without trusting the cooperative or us. Personal data never goes on-chain — only amounts and hashes.

### Why ISO 20022

It is the language banks, ERPs and auditors already read. We use the **customer-to-bank** messages (`pain.001`, `pain.002`) and the account-reporting ones (`camt.054`, `camt.053`). Kilos, price and quality deductions travel in `RmtInf/Strd`; the currency is always ISO 4217 (`MXN`) and the Stellar token is described in a single `SplmtryData` envelope. Every generated message is validated against the official XSD in the test suite. See [`docs/ISO20022.md`](docs/ISO20022.md) for the full study (in Spanish), including why the previous XRPL version's messages failed validation.

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
- **Signing:** the demo signs with a local testnet key. The plan is for the cooperative to sign from the **MicoPay app** via the `/sign-requests` endpoint of the MicoPay backend, so no private key touches the platform; it is disabled for payments until that endpoint returns the signed envelope.

## Run it locally

Requirements: Node 22+. No database to install (PGlite runs Postgres in-process).

```bash
npm install
npm run seed -w apps/api   # creates testnet accounts, funds demo USDC, loads a cooperative and producers
npm run dev:api            # http://127.0.0.1:8787
npm run dev:web            # http://localhost:5180
```

Then: **Realizar pago** → pick Pedro Martínez → *Café cereza* is preselected at the demo price → weigh 600 kg → **Ejecutar pago**. Open the transaction on stellar.expert and the ISO documents under **Historial**.

To verify a payment from a clean clone: open that payment in **Historial**, download its `pain.001`, then open **Verificar** (or use **Verificar este pago** in the payment detail). Drop the XML, paste the transaction hash or its stellar.expert link, and select **Testnet** if the API is unavailable. The page reads the file locally and checks its SHA-256 memo and every transfer against public Horizon.

> **Running it outside MicoPay:** the seed mints demo USDC with the issuer key of MicoPay's testnet USDC (`~/.micopay/ensayo-usdc.json`), so it does not run as is without that key. The exchange rate comes from `api.micopay.app`; set `FX_MXN_PER_USD` (for example `17.20`) if it does not answer.

```bash
npm test                   # ISO 20022 messages vs official XSDs + settlement math
npx tsx apps/api/test/e2e.ts   # 30 end-to-end checks against testnet (API must be running, fresh seed)
```

Testnet keys are written to `data/testnet-keys.json`, which is git-ignored. Testnet only — never real funds. `CAFE_DATA_DIR` moves the database and keys elsewhere.

The API only starts on a database the seed created with the current schema (a "schema cut" row), and only one process (API, seed or review command) uses a data directory at a time. To start clean next to an old demo: stop the API, archive the whole data directory (keys included), then run the seed with `CAFE_DATA_DIR` pointing at a new, empty directory. `npm run audit:legacy -w apps/api -- <copy of the old pg directory>` reports, read-only, what Horizon shows for each old run.

## Status and roadmap

Working today on testnet: pay at the scale with unconfirmed-payment protection, producers, daily price, quality deductions, ISO 20022 messages, receipts, monthly summary, audit log, day close and exports.

Next:
1. Sign-in and signing with the MicoPay app (`/sign-requests`), replacing the local demo signer.
2. Shared users with the MicoPay backend on AWS (identity = Stellar address).
3. Operator roles and sign-in (the original app had operator/admin accounts).
4. The next leg of the supply chain: *compradora* → *beneficio*, with the same delivery → settlement → payment model.
5. Optional quality escrow (Soroban), shared with MicoPay's rental platform.
6. Possibly, crop loans repaid with the harvest (see the note above).

## Versión en español

MicoPay Café es una plataforma para que las compradoras de café y las cooperativas paguen a los productores por kilo entregado, empezando por el café cereza que se compra en temporada de cosecha. El pago sale al momento en una transacción de Stellar, con cualquier activo, y cada pago genera mensajes ISO 20022 validados contra los esquemas oficiales, con la huella del `pain.001` anclada en el memo de la transacción. La conexión con la app de MicoPay está planeada y aún no está disponible: el productor cobraría en la app y podría guardar pesos digitales, mandarlos a su banco por SPEI o cambiarlos por efectivo con un agente, que podría ser la misma compradora. Los créditos de avío que se pagan con la cosecha quedan como posible implementación a futuro. Los documentos de diseño están en [`PLAN.md`](PLAN.md) y [`docs/`](docs/).

## License

MIT
