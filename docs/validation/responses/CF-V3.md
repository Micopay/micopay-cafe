# CF-V3 · Product validation: The payment flow at the scale

- **Issue:** #12
- **Country / general region:** West Africa (general region)
- **Did you run the demo locally?** no — I reviewed the README and product flow.

## 1. First read — what do you think it is?

*Read the README only up to its first `##` heading. Write this before reading anything else.*

- What does MicoPay Café do, in your own words?
  > My first impression is that MicoPay Café lets a coffee buyer pay a producer digitally at the buying point instead of carrying cash. The buyer weighs the coffee, the platform calculates the payment, and a Stellar transaction records the payment.
- Who is it for?
  > It is for coffee buyers and agricultural cooperatives that receive deliveries from smallholder farmers and need to pay them at the scale.
- What problem does it solve?
  > It appears to solve the practical problem of paying producers quickly while reducing the need to carry cash and creating a record that can be checked later.

## 2. After the full README — what did you get wrong?

- What did you misunderstand in step 1, or what surprised you?
  > I initially thought the product was mainly a wallet or a general farmer-payment app. The full README made it clearer that the operator workflow is the centre of the product: `Realizar pago` calculates a delivery settlement, and the ISO 20022 documents and transaction memo create an auditable link between the business record and the Stellar transaction. I was also surprised that the MicoPay app connection is planned rather than available today, and that the demo is testnet-only.
- What is still unclear?
  > I would still want a clear visual indication of who is responsible for resolving an `unconfirmed` payment and how long an operator should wait before using the review command. The README explains the safety rule well, but the operator-facing screen could make that next action more prominent.

## 3. Producers and middlemen where you live

- Your country / general region (no city or address needed).
  > West Africa.
- Where you live, do local producers (coffee, fruit, vegetables, milk, fish…) sell through middlemen? Who buys from them, and who sells to the final buyer?
  > I see this pattern with agricultural products: producers commonly sell to aggregators, buying agents, or market traders, who consolidate deliveries before they reach processors, wholesalers, or retailers. I am not describing one specific producer or transaction.
- How and when are they paid? (cash on the spot, days or weeks later, bank transfer, an app…)
  > The options I see around me are mixed. Cash at collection is familiar, while bank transfers and mobile-money payments are also used when the buyer and producer have the right accounts and connectivity. Timing can depend on the buyer's reconciliation process.
- Do you live this yourself, see it up close (family, neighbours, work), or only hear about it?
  > I have seen and heard about this through local commerce rather than working as a producer or buying-point operator myself.
- What is the biggest problem you notice for the producer? (price, late payment, no record of how the price was computed, carrying cash, safety…)
  > The biggest issue I notice is the lack of a clear, reusable record showing how the final payment was calculated. Late payment and the safety risk of carrying cash make that lack of transparency more serious.

## 4. Value

- **How useful does it look to you?** 4 (very useful). Why?
  > The flow brings weighing, price, deductions, payment status, and receipts into one process. That is useful when a buyer handles many deliveries and needs to explain a result later. I do not give it a 5 because the prototype still depends on testnet and the planned app signing connection is not available.
- What is the most valuable part?
  > The strongest part is the payment history: the `Historial` screen, the structured ISO documents, and the retry protection make it possible to distinguish a confirmed payment from a request whose network response was lost.
- What is missing?
  > I would want a very simple producer-facing confirmation, available in the producer's preferred language, plus a clear offline or poor-connectivity recovery path for the operator.
- What would stop you (or the person in your issue's role) from using it?
  > Unreliable connectivity, uncertainty about who controls signing, and a producer not having a usable digital account would be barriers. A buyer would also need confidence that an `unconfirmed` payment cannot be accidentally sent twice.

## 5. The MicoPay app

- Does that connection make the product more useful to you? What would it change for you?
  > Yes. If the producer can receive the payment in the MicoPay app and cash out with an agent, the same counter could support both the digital settlement and the producer's practical need for cash. Having the buyer sign from the app would also make the trust boundary clearer because the platform would not need to handle the private key. I would want the app to show the same payment reference and final status as `Historial`.

## 6. What confused you

- Which screen, step or term confused you, and what did you expect instead?
  > The phrase `unconfirmed` needs careful treatment. I first expected it to mean that the payment had failed, but the README says it means the system cannot yet prove whether the transaction reached the ledger. The `Historial` screen should explain that distinction next to the status and show the exact next safe action without encouraging a resend.

## 7. Questions for your issue

*Copy the questions from your issue here and answer them.*

- Walk through the "Realizar pago" flow (in the demo or from the README): what is confusing, what is unnecessary, what is missing?
  > I would select a producer in `Realizar pago`, confirm the daily price, enter the delivered weight, review any quality deduction, and confirm. The overall order makes sense. The price override and deduction sections should make it obvious which values are defaults and which were changed by the operator. Before confirmation, I would also want a compact review showing the producer, product, weight, applied price, deductions, final status expectation, and the payment reference. A visible explanation of what happens if the network response is lost is missing from this moment.
- At every moment, would you know whether the payment went through? Where would you look?
  > I would know that the request was accepted from the confirmation state, but I would not assume that an accepted request means the ledger payment is final. I would look first at the payment status in `Historial`, then at the payment detail and its Stellar transaction link when one exists. The interface should keep `settled`, `failed_onchain`, `not_executed`, and `unconfirmed` visually distinct and explain each one in plain language.
- If a payment ends up "unconfirmed", what would you do?
  > I would not click pay again. I would open the payment detail in `Historial`, keep the run identified by its reference, and follow the review process. I would only retry after the system proves that the envelope did not reach the ledger or that Horizon recorded a failed transaction. If neither proof exists, I would leave it blocked for review rather than risk paying twice.

## 8. Ideas

Up to 3. For each one: the problem it solves, then the idea.

1. **Problem:** An operator may mistake `unconfirmed` for a failed payment. · **Idea:** Add a status panel with plain-language explanations, a prominent “do not resend yet” message, and the exact safe next step.
2. **Problem:** A producer may not know whether the amount was calculated from the expected delivery details. · **Idea:** Give the producer a receipt view that shows weight, price, deductions, final status, and the same payment reference used by the buyer.
3. **Problem:** A buyer may need to work through intermittent connectivity at a buying point. · **Idea:** Add a connection indicator and a resumable review queue that preserves the payment reference and never creates a second attempt automatically.
