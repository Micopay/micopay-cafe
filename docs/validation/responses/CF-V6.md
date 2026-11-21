# CF-V6 · Product validation: The message: explain it to a friend

- **Issue:** #15
- **Country / general region:** EDIT BEFORE MERGE: write your own country or general region here (no city). Section 3 below is written as "I only hear about it", so change it if that is not true for you.
- **Did you run the demo locally?** no — I only read the README. It says the seed needs MicoPay's testnet USDC issuer key, so I did not try.

## 1. First read — what do you think it is?

*Read the README only up to its first `##` heading. Write this before reading anything else.*

- What does MicoPay Café do, in your own words?
  > It is a tool for the people who buy coffee at harvest time. They weigh what a farmer brings, the system works out the amount (kilos × price, minus deductions for quality) and pays the farmer right there by a Stellar transaction, instead of with cash. Each payment also leaves a formal record that a bank or an auditor could check.
- Who is it for?
  > The seasonal buying points (*compradoras de café*) and the cooperatives, in coffee towns in Veracruz. The farmer is the one who gets paid, but the opening paragraphs describe the buyer as the user.
- What problem does it solve?
  > Carrying cash to pay farmers during the harvest. The tagline also hints at a second problem: payments with a record that is hard to dispute ("bank-grade records anyone can verify").

## 2. After the full README — what did you get wrong?

- What did you misunderstand in step 1, or what surprised you?
  > I was close on the "who" and "what". What I missed was how much of it is the buyer's back office: **Realizar pago**, **Productores**, **Historial**, **Resumen del mes**, **Precio del día**, **Auditoría**. I also did not expect the section "Payments that never pay twice". A payment is retried only when it is proven it did not happen, and "no answer" is never read as "no money moved". Nothing in the opening hints at that, and it is the part that made me trust the project most.
  >
  > I also did not expect that the MicoPay app link is only planned. The status note in the opening says it is a testnet prototype, but "How it connects to the MicoPay app (planned)" is what makes the cash-out story real, and I only found it afterwards.
- What is still unclear?
  > What the person at the scale sees and says when a payment is `unconfirmed` or `needs_review`. The README explains these states for the API, not for the screen **Realizar pago**. Also unclear: whether the farmer needs their own Stellar account before the first delivery (**Productores** says it validates the address and whether the account can receive the asset), and who sets that up.

## 3. Producers and middlemen where you live

- Your country / general region (no city or address needed).
  > EDIT BEFORE MERGE: your own country or general region.
- Where you live, do local producers (coffee, fruit, vegetables, milk, fish…) sell through middlemen? Who buys from them, and who sells to the final buyer?
  > I only hear about this and I do not want to claim more than I know. What I understand is that small producers often sell to an intermediary who collects and then sells on to a larger buyer, which is the same shape the README describes (*compradora* → *beneficio*). I have no first-hand knowledge of how it works in detail.
- How and when are they paid? (cash on the spot, days or weeks later, bank transfer, an app…)
  > I have no first-hand knowledge. From what I hear, cash on the spot is common for small sales. The README's own problem statement says payments are "often late, in cash", and I have nothing of my own to add or contradict.
- Do you live this yourself, see it up close (family, neighbours, work), or only hear about it?
  > Only hear about it.
- What is the biggest problem you notice for the producer? (price, late payment, no record of how the price was computed, carrying cash, safety…)
  > From the outside, the missing record of how the price was computed. The README's "The problem" section lists it, and the flow `kilos × price − quality deduction` is the part of the product that answers it. Carrying cash looks like a buyer problem, and a safety problem for the farmer who leaves with a bundle of bills.

## 4. Value

- **How useful does it look to you?** 1 (not at all) – 5 (very). Why?
  > **4.** For the buyer it replaces carrying cash and reconciling by hand: **Historial** with the payment documents, **Auditoría** with the day close, and the CSV export. I do not give 5 because the farmer's side is thin today: the benefit reaches them through a receipt, and cash-out depends on the planned MicoPay app connection.
- What is the most valuable part?
  > That the record is produced by the same step as the payment. The line "`kilos × price − quality deduction` → pain.001 → its SHA-256 becomes the memo of the Stellar transaction" means nobody has to remember to write anything down.
- What is missing?
  > A place where the farmer can see their own deliveries without asking the buyer for a file. Also, an operator sign-in: the roadmap lists "Operator roles and sign-in" as item 3, so today anyone with the browser open could run a payment.
- What would stop you (or the person in your issue's role) from using it?
  > For a friend who buys coffee: having to get every farmer onto Stellar before harvest, and not being able to turn the digital money into cash at the same counter. The README says the second part is planned, not available.

## 5. The MicoPay app

*The README section "How it connects to the MicoPay app (planned)" describes producers getting paid in the MicoPay app and cashing out with an agent, who could be the buyer itself.*

- Does that connection make the product more useful to you? What would it change for you?
  > Yes. "The *compradora* could be that agent, so the producer walks away with cash from the same counter where they were weighed and paid" is the sentence that makes the whole idea work for someone who needs cash today. Without it, the farmer is paid in a digital asset and has to find a way out of it. Signing from the app instead of a local key also makes me trust the custody statement more ("MicoPay does not hold funds").

## 6. What confused you

- Which screen, step or term confused you, and what did you expect instead?
  > **The tagline.** "Bank-grade records anyone can verify" made me think a farmer, or any customer, could check the kilos and the price. Further down, "Personal data never goes on-chain — only amounts and hashes" shows that is not what it means. I expected the tagline to say who can verify what.
  >
  > **Stellar, ISO 20022, `pain.001`, `camt.054`, `camt.053`.** They appear in the opening and in "Every payment, end to end" with no plain-words explanation of what the farmer or buyer gets from them. "Why ISO 20022" explains that banks and auditors read it, but that comes after the technical line.
  >
  > **Créditos / Prestamistas.** The crop-loan note says they are not part of the product, but it sits inside "What it does", right after the screen tables, so I first read it as a feature.

## 7. Questions for your issue

**Summarize the product in one sentence for a friend.**

> "It is a way for the people who buy coffee from farmers at harvest time to pay by phone at the scale instead of with cash, and to get the record of every payment for free."

**Who would you recommend it to, and why?**

> To a coffee buying point or a small cooperative that pays many farmers per kilo in a short season, because **Realizar pago** (weigh, price loads by default, pay in one step) and **Historial** (documents and CSV export) remove the two chores the README names: carrying cash and reconciling by hand. I would not recommend it yet to a buyer who needs it in production: the README's status note says it is a testnet prototype, and sign-in with the MicoPay app is still on the roadmap.

**What would you change in the README so it is understood faster?**

> 1. Add one plain sentence after the tagline: "The buyer weighs the coffee, the farmer is paid on the spot by transfer, and a receipt is created automatically", before the words Stellar and ISO 20022.
> 2. Fix "anyone can verify": say what is checked (that a payment happened and matches its bank record) and what is not (kilos and price are not public).
> 3. Move the "planned" MicoPay app section's key sentence (producer cashes out with the *compradora*) up into the opening, and keep the "not available yet" warning next to it. It is the main answer to "does the farmer end up with cash?".
> 4. Add a short "What the operator sees" example for the unconfirmed case, next to "Payments that never pay twice", in words a person at the scale could say to a farmer.
> 5. Put the crop-loan note under its own heading ("Not available yet") so it is not read as part of the product tables.

## 8. Ideas

Up to 3. For each one: the problem it solves, then the idea.

1. **Problem:** A reader needs several paragraphs to learn what the farmer actually gets, because the opening is technical. · **Idea:** a three-line "In plain words" box right under the tagline: who pays, how, and what record is left; with the technical details moved below.
2. **Problem:** The farmer cannot see how their price was computed after leaving the scale. · **Idea:** a simple printed or on-screen slip at **Realizar pago** showing kilos, price of the day, deductions and total, in the same words as the producer receipt in **Historial**.
3. **Problem:** At the counter, `unconfirmed` and `needs_review` are API words, not something to say to a farmer. · **Idea:** replace them on **Realizar pago** with two short messages for the operator: "wait, we are checking" and "do not pay again, call for review", plus what to tell the farmer.
