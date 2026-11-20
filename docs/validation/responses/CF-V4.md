# CF-V4 · Product validation: Why Stellar and ISO 20022: does it matter?

- **Issue:** #13
- **Country / general region:** Mexico — Gulf coast (Veracruz region)
- **Did you run the demo locally?** no — I ran the automated checks (`npm test`, `npm run typecheck`, `npm run build -w apps/web`), not the demo. The README says the seed needs MicoPay's testnet USDC issuer key (`~/.micopay/ensayo-usdc.json`) and the exchange rate comes from `api.micopay.app`, so the demo does not run as is from a fresh clone.

## 1. First read — what do you think it is?

*Read the README only up to its first `##` heading. Write this before reading anything else.*

- What does MicoPay Café do, in your own words?
  > It lets the people who buy coffee at harvest time pay producers by weight on the spot, without carrying cash. The buyer weighs the delivery, the kilos are multiplied by the price minus quality deductions, and a Stellar transaction sends the money right there. Each payment also produces a formal banking record, so the payment can be checked later.
- Who is it for?
  > The *compradoras de café* and the cooperatives — the ones who hand out the money at the scale. The producer receives the payment but does not seem to operate the product.
- What problem does it solve?
  > Two things, as I read the opening: paying per kilo during harvest without moving cash around, and having a record of how each price was reached instead of a cash hand-off with nothing written down.

## 2. After the full README — what did you get wrong?

- What did you misunderstand in step 1, or what surprised you?
  > I had it mostly right about who it is for, but I expected the producer to be the user: a wallet or an app where they see their money. The product is really the buyer's back office — **Realizar pago**, **Productores**, **Historial**, **Resumen del mes**, **Precio del día**, **Auditoría**. The producer only appears as someone who receives a `camt.054` receipt.
  >
  > I also read "bank-grade records anyone can verify" as a traceability story — a QR on a coffee bag that tells you the farm. It is not that. The interesting part is that **kilos, price and quality deductions travel inside the `pain.001` structured remittance** (`RmtInf/Strd`), and the SHA-256 of that message becomes the memo of the Stellar transaction. That is a much narrower and more useful claim than what I first imagined.
  >
  > The retry section surprised me the most: a payment is retried **only when it is proven it did not happen**, and "no answer" is never read as "no money moved". That is not the usual hackathon shortcut, and it is the part I would trust.
- What is still unclear?
  > What the operator sees on **Realizar pago** when the attempt comes back `unconfirmed` or `needs_review`. The README explains the states in the API section, but not the screen: does the person at the scale tell the producer "you are paid" or "wait"? That decision is the whole product at the counter.
  >
  > Also, who carries the exchange rate. The price is in `MXN` and the settlement is in MicoPay's testnet USDC with the rate fetched at payment time; if the rate moves between the weighing and the payment, nothing in the README says which side absorbs it.

## 3. Producers and middlemen where you live

- Your country / general region (no city or address needed).
  > Mexico — Gulf coast, Veracruz region.
- Where you live, do local producers (coffee, fruit, vegetables, milk, fish…) sell through middlemen? Who buys from them, and who sells to the final buyer?
  > Yes, and it is the normal way, not the exception. Smallholders around here sell oranges, coffee and vegetables to *acopiadores* — the same figure the README calls a *compradora* — who show up with a truck at a fixed point or drive to the edge of the plot. The *acopiador* then sells on to a packing house, a *beneficio*, or a market wholesaler, and that is who actually reaches the final buyer. Producers almost never sell directly; the ones who do are selling by the roadside in small quantities.
- How and when are they paid? (cash on the spot, days or weeks later, bank transfer, an app…)
  > Cash on the spot for fruit sold at the roadside or at the collection point, and that is the part that matches the README. For coffee and for larger fruit loads it is often cash with part of the payment held back and settled later, when the *acopiador* has sold — so the producer carries the risk of the next sale. Bank transfer exists but is rare for small deliveries; I have not seen an app used to pay a producer here.
- Do you live this yourself, see it up close (family, neighbours, work), or only hear about it?
  > I see it up close through family and neighbours who grow on small plots and sell to the same *acopiador* every season. I have been at the collection point when a load is weighed.
- What is the biggest problem you notice for the producer? (price, late payment, no record of how the price was computed, carrying cash, safety…)
  > The price. The *acopiador* looks at the fruit, names a number, and that number is the whole negotiation. There is no written breakdown of size, ripeness or humidity, so the producer cannot compare it with the previous load or with what the next buyer offers. The second problem is the cash itself: the producer leaves with a bundle of bills, and everyone at the collection point knows who just got paid. Late or partial payment is real, but the missing record of *how the price was computed* is what I hear complained about most.

## 4. Value

- **How useful does it look to you?** 1 (not at all) – 5 (very). Why?
  > **4** for the buyer or cooperative, **3** for the producer as it stands today. For the buyer it removes the two things that actually hurt: carrying cash during harvest and reconciling payments by hand afterwards — **Historial** with the ISO documents, **Auditoría** with the day close (`camt.053`), and CSV exports are exactly the work someone does at night with a notebook. For the producer, the useful part is the `camt.054` receipt with kilos, price and deductions, but only if they get it in a form they can keep and read; the Stellar and ISO 20022 machinery underneath changes nothing in their day.
- What is the most valuable part?
  > Paying at the scale in one transaction and getting the record for free, because it is produced by the same step. The line "`kilos × price − quality deduction` → **pain.001** ... → its SHA-256 becomes the memo" is the strongest idea in the README: the receipt is not extra work someone has to remember to do, it is a by-product of paying.
- What is missing?
  > The producer's side of the counter. There is a producer receipt, but no place where the producer sees their own history without asking the buyer for a file. The cash-out leg is only planned, and that is the leg that matters to someone who lives day to day.
  >
  > Operationally: no offline or low-signal behaviour, and no operator sign-in yet (roadmap item 3). At a harvest scale, anyone who opens the browser can execute a payment, and the person at the scale is often a temporary worker.
- What would stop you (or the person in your issue's role) from using it?
  > Onboarding the producers. **Productores** validates the Stellar address and whether the account can receive the payment asset, which means every producer needs a working account and trustline before the first load — and the people I know would not set that up themselves. If the *compradora* has to do it during harvest, at the busiest moment of the year, that is the point where they go back to cash.
  >
  > Second: connectivity. The `unconfirmed` → `needs_review` path blocks the next delivery for that producer, and at a collection point with weak signal the operator has no way to resolve it on the spot.

## 5. The MicoPay app

*The README section "How it connects to the MicoPay app (planned)" describes producers getting paid in the MicoPay app and cashing out with an agent, who could be the buyer itself.*

- Does that connection make the product more useful to you? What would it change for you?
  > Yes, it is the difference between "the producer was paid" and "the producer has money". Right now the producer ends up with digital dollars and, where I live, the next thing they need is cash for the day — so without the agent the payment just moves the problem. Having the *compradora* as the agent at the same counter is the right shape: the producer is weighed, paid and handed cash in one stop, which is exactly what happens today, only without the *compradora* carrying a box of bills.
  >
  > Signing from the app also fixes something the demo makes me uneasy about: a local testnet key on the machine that runs the payments. And "one identity across MicoPay products: the Stellar address" means the producer's history is not trapped inside one cooperative's installation.
  >
  > What it does not change: the producer still depends on the same buyer for the cash, so it does not by itself make the price fairer. And if the agent runs out of cash at the peak of the harvest, the promise breaks at the worst moment.

## 6. What confused you

- Which screen, step or term confused you, and what did you expect instead?
  > **"Bank-grade records anyone can verify."** I expected that anyone could check the kilos and the price. Only amounts and hashes go on-chain; kilos, price and deductions live in the ISO documents, which the buyer holds. "Anyone" can verify that a payment happened, not that it was the right one. I would have expected that sentence to say who can verify what.
  >
  > **The mixing of `MXN` and USDC.** **Precio del día** is a reference price per product in pesos, and the settlement is in MicoPay's testnet USDC, but no screen is named as the place where the conversion is shown. On the scale, the producer is told a peso price and receives a dollar token; I would expect one line in **Realizar pago** with the rate used.
  >
  > **`camt.054` vs `camt.053`.** The README introduces them in the end-to-end line without saying which one the producer gets and which one the accountant gets; I had to infer it from the tables. **Auditoría** says "day close (`camt.053`)" and **Historial** says "producer receipt", so I assumed the receipt is the `camt.054`, but the screen never names it.
  >
  > **"Unconfirmed" vs "needs review".** The difference between a payment the system is still looking for and one it has given up on is clear in the API section and invisible in the UI section. At the counter those are two very different sentences to say to a producer.
  >
  > **Two languages, two audiences.** The README is in English (with a Spanish section at the end) and every screen is in Spanish. That is right for the operator, but it means the part a producer would read — the receipt — is the part the README never describes in their words.
  >
  > **Créditos / Prestamistas.** They appear in the demo as screens, with disbursement answering 503 and seeded loans stuck in *pendiente*. As a reader I spent time wondering whether the product does crop loans; a screenshot or a line on the screen saying "not available" would have saved that.

## 7. Questions for your issue

*Copy the questions from your issue here and answer them.*

**Does the promise of "bank-grade records anyone can verify" convince you? Why?**

> Partly — it convinces me for the accountant, not for "anyone". What convinces me is concrete: the messages are validated against the official XSDs in the test suite, the structured remittance carries kilos, price and deductions, and the `pain.001` hash is anchored in the transaction memo, so a bank file and a ledger entry can be shown to be the same payment. That is a real, checkable link, and it is the strongest claim in the project.
>
> What does not convince me is the word "anyone". A producer is not going to open stellar.expert, and the numbers that matter — the weight and the price — are not on-chain. So the honest version is: the buyer's records can be checked against the ledger without trusting the buyer's spreadsheet. That is valuable; it is just narrower than the sentence promises.

**Does it matter to a buyer or to a producer, or mostly to banks and auditors?**

> Mostly to the buyer and their accountant, and second to banks and auditors, who gain files they already parse instead of a spreadsheet. For the producer it matters only through two visible effects: the payment arrives at the scale instead of weeks later, and there is a piece of paper with the kilos, the price and the deduction on it. The ISO 20022 part is invisible to them and, honestly, does not need to be visible. If I had to rank: buyer first, auditor second, producer third but for different reasons.

**What would you tell a buyer about it in one sentence, without technical words?**

> "It is a cash register for the scale: it pays the producer on the spot by transfer and prints the receipt your accountant needs, so you stop carrying cash and stop rebuilding the day's payments at night."

## 8. Ideas

Up to 3. For each one: the problem it solves, then the idea.

1. **Problem:** The producer cannot see or keep the numbers behind their payment — today the price is a number said out loud, and a receipt file in **Historial** is not something they will open. · **Idea:** a producer-facing ticket at the moment of weighing: a large screen or printed slip showing kilos, price of the day, deductions and total, plus a short code to look the same ticket up later. One screen, same data as the `camt.054`, in the producer's words.
2. **Problem:** Weak or no signal at a collection point turns a payment into `unconfirmed`, and the one-open-attempt rule then blocks that producer's next delivery with nothing the operator can do at the counter. · **Idea:** an explicit low-signal mode on **Realizar pago**: record the delivery and issue a signed ticket marked "pending", keep it out of the producer's open-attempt block until the connection returns, and show the operator a plain "not sent yet / sent, waiting / needs review" panel instead of the API statuses.
3. **Problem:** The producer has no way to compare prices across buyers or across loads, which is the complaint I actually hear — not the payment method. · **Idea:** a one-page producer summary (or a QR to a public page) with the last deliveries: kilos, price of the day, deductions, total. Not a wallet, just history the producer can show to the next *acopiador*. It reuses **Precio del día** history and the payment records that already exist.
