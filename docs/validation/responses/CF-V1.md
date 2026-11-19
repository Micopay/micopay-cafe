# CF-V1 · Coffee buyer (compradora / cooperative) perspective

- **Issue:** CF-V1
- **Country / general region:** Latin America (Mexico / Southern Cone context, general region)
- **Did you run the demo locally?** no

## 1. First read — what do you think it is?

*Read the README only up to its first `##` heading. Write this before reading anything else.*

- What does MicoPay Café do, in your own words?
  > It is a payments platform that lets a coffee buyer (a *compradora* or cooperative) pay a smallholder producer immediately at the weighing scale — no cash changes hands. The buyer enters the kilos delivered, the platform calculates the amount (kilos × daily price, with any quality deductions), and the payment goes out as a Stellar blockchain transaction in seconds. Every payment also generates ISO 20022 financial-messaging documents, and the hash of the payment order is embedded in the transaction's memo so the bank record and the ledger cross-reference each other.

- Who is it for?
  > The buyer side of the harvest transaction: *compradoras de café* (seasonal buying points) and agricultural cooperatives that collect produce from smallholder farmers and need to pay them per kilo on the spot.

- What problem does it solve?
  > Carrying large amounts of cash to rural collection points, then reconciling payments by hand afterward. The opening lines name the specific context: Veracruz harvest season, café cereza (freshly picked coffee cherry), producers who cannot process the fruit themselves and must sell it immediately. The platform replaces cash with an instant Stellar payment while producing audit-ready records.

## 2. After the full README — what did you get wrong?

- What did you misunderstand in step 1, or what surprised you?
  > My first read was mostly accurate. What I had not grasped was the depth of the idempotency and double-payment-prevention design. I assumed "instant Stellar payment" meant straightforward fire-and-forget. The README's "Payments that never pay twice" section describes a careful state machine — `settled`, `unconfirmed`, `failed_onchain`, `not_executed`, `needs_review` — and a background process that re-queries Horizon rather than inferring absence from silence. That is not obvious from the opening paragraph and is a meaningful piece of the product.
  >
  > I also did not anticipate the ISO 20022 message chain (`pain.001` → `pain.002` → `camt.054` → `camt.053`) or that kilos and quality deductions travel in `RmtInf/Strd`. The opening mentions "bank-grade records anyone can verify" and "ISO 20022 messages," but the full section makes clear this is a complete implementation validated against official XSDs, not a loose label.
  >
  > The crop-loan screens were a surprise: they exist in the demo but the disbursement route answers 503 and they are explicitly marked as a possible future feature, not current product.

- What is still unclear?
  > The README says "the payment asset is configuration, not code" and the demo uses testnet USDC. It is not clear who issues or redeems the tokenized peso a production buyer would actually use, nor how a producer without a smartphone or a Stellar account today would get set up. The producer sign-up screen validates a Stellar address, but the README does not explain the onboarding path for a producer who does not already have one.

## 3. Producers and middlemen where you live

- Your country / general region (no city or address needed).
  > Mexico (southern region, coffee-growing states context).

- Where you live, do local producers (coffee, fruit, vegetables, milk, fish…) sell through middlemen? Who buys from them, and who sells to the final buyer?
  > Yes. Smallholder coffee producers sell freshly picked cherry to *compradoras* (small seasonal buyers who operate a scale point during harvest) or directly to cooperatives. The *compradoras* then sell to *beneficios* (wet or dry processing mills) which sell to exporters or large roasters. There are typically two to three intermediary steps between the producer and the exporter.

- How and when are they paid? (cash on the spot, days or weeks later, bank transfer, an app…)
  > At the *compradora* level, payment is almost always cash on the spot at the scale. At the cooperative level, payment timing varies: some pay immediately, others pay in instalments (a partial advance at delivery, the remainder after the cooperative sells the processed coffee). Bank transfer is rare at the smallholder-to-*compradora* step; it appears more at the cooperative-to-producer step when the cooperative has digital infrastructure.

- Do you live this yourself, see it up close (family, neighbours, work), or only hear about it?
  > I see it up close through work and community context in coffee-producing regions.

- What is the biggest problem you notice for the producer? (price, late payment, no record of how the price was computed, carrying cash, safety…)
  > No record of how the price was computed. Producers often accept a verbal price at the scale with no written breakdown of quality deductions. If a *compradora* applies a humidity or defect deduction, the producer cannot verify it. This is exactly what the README's "pay.001 with kilos, price and deductions in structured remittance" and the **Realizar pago** confirmation screen address: the settlement is calculated in front of both parties and the receipt is a verifiable document, not a verbal statement.

## 4. Value

- **How useful does it look to you?** 1 (not at all) – 5 (very). Why?
  > 4. The core problem is real and the technical approach is sound. The main reason it is not a 5 is that the hardest part of the problem — producer onboarding and the question of what asset a *compradora* actually holds and redeems — is deferred to the MicoPay app integration, which is not yet available. The platform is complete on the buyer side; the producer side depends on a planned connection.

- What is the most valuable part?
  > The idempotency design and the ISO 20022 paper trail together. A *compradora* today reconciles payments from handwritten tallies. The **Historial** screen with date/status/producer filters, the `camt.053` day-close statement, and the CSV export replace that entirely. The "Payments that never pay twice" guarantee matters in a low-connectivity rural environment where a network failure at the moment of payment would otherwise leave the buyer unsure whether money moved.

- What is missing?
  > Offline or low-connectivity mode, or at minimum a clear statement of what happens when the scale point has intermittent internet. The README describes the unconfirmed-payment flow for network failures, but it assumes the API is reachable. A *compradora* in a coffee town during harvest may have a 2G connection or a shared WiFi that drops. How the platform behaves on a device that loses connectivity mid-transaction is not addressed.
  >
  > Also missing: a producer-facing receipt they can photograph or print on the spot. The README mentions "producer receipt" in the **Historial** screen, but it is not clear whether the producer sees it in real time at the scale or only the buyer sees it.

- What would stop you (or the person in your issue's role) from using it?
  > Two things. First, liquidity: the *compradora* needs to hold the payment asset before the harvest starts. If that asset is a tokenized peso or testnet USDC, there must be a clear and cheap way to load funds into the wallet before the season, and an equally clear way to reconcile that wallet balance against the cooperative's bank account at day close. The README describes the `camt.053` for the latter but does not describe the former. Second, producer trust: a producer who has always been paid in cash at the scale may not accept a Stellar transaction as payment, especially if they do not have a smartphone or cannot verify the balance immediately. The *compradora* switching to this platform while producers are skeptical creates a friction asymmetry.

## 5. The MicoPay app

*The README section "How it connects to the MicoPay app (planned)" describes producers getting paid in the MicoPay app and cashing out with an agent, who could be the buyer itself.*

- Does that connection make the product more useful to you? What would it change for you?
  > Yes, significantly. The planned flow — producer receives digital pesos in the MicoPay app and can cash out with the *compradora* acting as agent — solves the liquidity and trust problem simultaneously. The *compradora* does not carry cash to the field; instead, producers who want cash get it at the scale from the *compradora*'s float, and the *compradora* nets out at day close. That is a materially different operational model from either pure cash or pure digital.
  >
  > What it changes: the *compradora*'s risk shifts from "carry a large amount of cash to the field" to "carry a smaller float sufficient for producers who want immediate cash-out, while digital-first producers take nothing." That is a real improvement in physical safety.
  >
  > What still needs to be clear: the agent fee structure. If the *compradora* earns a fee percentage for acting as cash-out agent, the README does not describe it. That would be a business-model incentive for the *compradora* to adopt the platform beyond the operational convenience.

## 6. What confused you

- Which screen, step or term confused you, and what did you expect instead?
  > **`clientRef` (UUID) on the Realizar pago screen.** The README mentions that "a scale that sends a `clientRef` (UUID) gets the stored payment back when it repeats the request." It is not clear from the UI description whether the browser-based operator sees or controls this field, or whether it is generated automatically. I expected a visible confirmation-token visible to both parties at the moment of payment, not just an internal idempotency key.
  >
  > **"Unconfirmed" status in Historial.** The README explains what it means technically (the API never received confirmation from Horizon), but a *compradora* operator looking at a payment marked "unconfirmed" in the payment list has no immediate instruction about what to do. The retry logic is explained in the developer documentation, not in the UI description. What would a non-technical operator see and do at that moment?
  >
  > **`camt.053` "with balances reconstructed from Horizon."** This phrase implies the platform does not maintain a running balance internally but reconstructs it from the Stellar ledger at day-close time. That is worth stating explicitly for a finance-team reader, because it means the day-close statement cannot be generated without an internet connection to Horizon.

## 7. Questions for this issue

*Coffee buyer (compradora or cooperative that pays at the scale)*

**If you bought produce per kilo and paid in cash, would you use this instead? Why or why not?**

> Conditionally yes, and the condition is the asset. If the tokenized peso or digital dollar I pay with can be loaded from my bank account with a standard SPEI transfer and the exchange rate is locked at the moment I load funds, I would use it. The operational win is clear: no cash counting at the scale, no risk of being robbed on the road to the coffee town, and an automatic reconciliation export at day close instead of a handwritten tally. The README's **Realizar pago** flow — pick producer, enter kilos, price loads automatically, deductions apply, confirm — is faster than counting bills and writing a receipt by hand.
>
> What would hold me back: if the asset requires a crypto exchange or a step my accountant cannot trace through a standard bank statement, I would not use it. The ISO 20022 output addresses the reconciliation side, but the funding-side onboarding (how the *compradora* loads the wallet before harvest) is the gap.

**What would it save you (time, cash handling, reconciliation, disputes about the price)?**

> The largest saving is in reconciliation. Today, end-of-day at a *compradora* means matching handwritten scale tickets against cash paid out. With the **Historial** screen's CSV export and the `camt.053` day-close statement, that work is done automatically. The second saving is disputes: when a producer questions a quality deduction, the *compradora* today has no document to show. The `pain.001` with deductions in `RmtInf/Strd` and the producer receipt from **Historial** give both parties the same number at the same time. Cash handling safety is a third saving — not carrying a large amount of cash to the collection point reduces a real physical risk during harvest.

**What would stop you from switching?**

> Three things, in order of weight:
>
> 1. **Producer resistance.** If producers insist on cash, the *compradora* either carries cash anyway (defeating the purpose) or loses business to a *compradora* who does. The platform needs at least a critical mass of producers in a territory to adopt it before a buyer can switch. The MicoPay app cash-out agent model helps because it preserves the option of walking away with cash from the same counter.
>
> 2. **Asset liquidity and cost.** The *compradora* needs to pre-fund a wallet before the harvest, and needs to know that topping up is cheap and fast. If there is a fee percentage to load or unload, it has to be lower than the cost of armored transport or bank cash withdrawal. The README does not address this.
>
> 3. **Connectivity at the scale point.** If the platform requires a live connection to Horizon to confirm a payment and the scale point has intermittent internet, the operator faces an "unconfirmed" state they do not know how to resolve. That uncertainty is worse than cash, which is final on the spot.

## 8. Ideas

1. **Problem:** Producers who have never used a digital wallet do not trust that money arrived. · **Idea:** A printed receipt from the scale — a simple thermal-printer output of the `camt.054` with a QR code linking to the transaction on stellar.expert — that the producer takes home as proof. No smartphone required on the producer side; the *compradora*'s printer produces it.

2. **Problem:** The *compradora* does not know in advance how much to load into the wallet for the day's purchases. · **Idea:** A "forecast" view in **Resumen del mes** that shows last year's same-week volume (from the existing delivery history) as a default funding guide. The buyer arrives at the scale knowing the likely day's outflow, not guessing.

3. **Problem:** The transition from "unconfirmed" to "needs review" is invisible to a non-technical operator. · **Idea:** A plain-language status banner in **Historial** for any unconfirmed payment that has been open for more than a configurable threshold (e.g. 10 minutes): "This payment has not been confirmed. Do not pay again. We are checking — you will see the result here." With a contact or escalation link. The technical mechanism already exists; what is missing is the operator-facing language.
