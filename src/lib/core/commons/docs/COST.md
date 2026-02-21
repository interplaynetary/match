---

# Alternative:

This is a really sharp question. You're right to challenge this, because "when" the deduction happens fundamentally changes the architecture of the state-machine you're building in your code.

Let's break down whether the deduction has to happen at the moment of voucher issuance, or if that’s just one implementation model.

Two Ways to Handle the "Communal Deduction"
In a computed planning system, you have two ways to balance the math between total labor performed and total individual consumption available.

Model A: The Upfront Deduction (What I described above)
The Mechanic: The worker provides 8 hours of labor 👤 to a 🟢. When 🟢🏛️ validates it, it queries the global macro-economic plan. The plan says "this month, our communal overhead ratio is 50%". The 🟢🏛️ mints a 👤 Time-Voucher for 4 hours.
Pros:
The voucher's face value matches the exact sum of goods in the 🟦 Individual Consumption Pool. A "4 hour voucher" buys goods that cost "4 hours" of SNLT.
It aligns perfectly with Marx's phrasing: "he receives a certificate from society that he has furnished such-and-such an amount of labor (after deducting his labor for the common funds)..."
Cons (System Design):
The face value of the voucher feels disconnected from the worker's lived experience. They worked 8 hours, but their "wallet" says 4.
If the communal overhead ratio changes mid-month (e.g., from 50% to 60% due to a crisis requiring more hospital 🟢 processes), how do you retroactively adjust vouchers already issued?
Model B: The Voucher "Tax" or "Inflation" (Alternative approach)
The Mechanic: The worker provides 8 hours of labor 👤. The 🟢🏛️ issues a voucher for the full 8 hours.
Option 1 (Tax check-out): When the worker goes to claim a 🟦 from the consumption pool that has an SNLT of 4 hours, the 🏛️ checkout system applies the 50% macro-ratio: it deducts 8 hours from their voucher to clear the 4 hour good.
Option 2 (Price Inflation): The 🟦 in the consumption pool still only took 4 hours of SNLT to make, but 🏛️ lists its "price" as 8 hours to soak up the excess vouchers that were handed out for communal labor.
Pros:
The worker's voucher always reflects their actual literal hours worked (8 hours worked = 8 hour voucher).
Cons (System Design):
Option 2 (Inflation) completely breaks the foundational rule that the cost of a good = its actual Labor Time. It turns the labor-voucher into fiat currency that fluctuates based on communal spending. Marx explicitly warned against this.
Option 1 (Tax) requires complex dynamic pricing at the moment of consumption.
Why Marx (and likely your architecture) prefers Model A (Deduction at Issuance)
If you read the architecture you are building in

PLAN.md
:

Share of total-unspent-socially-validated-time: is amount that 👤 can claim from 🟦 Individual Consumption Pool (where different items in this pool have different costs = social-time spent to produce it) ?

If the items in the pool must maintain their honest SNLT price tag ("different items in this pool have different costs = social-time spent to produce it"), then the total purchasing power in everyone's wallets must be mathematically restricted to equal the exact total SNLT of the pool.

If it isn't restricted, and workers hold 8,000 hours of vouchers but the consumption pool only has 4,000 hours of goods (because the other 4,000 hours built tractors and hospitals), you have a catastrophic system failure: the last 50% of people who show up to the consumption pool find it empty, even though they hold valid vouchers.

How to Implement "Deduction at Issuance" in Code
If you are worried about the worker feeling "cheated" by working 8 hours and getting a 4-hour voucher, the UI and the data model can handle this transparently:

When 🟢🏛️ validates the 8 hours of labor, it creates a transaction record:

gross_labor_credited: 8.0 hours
communal_deduction_rate: 0.5 (dynamically fetched from the current 🏛️ social plan ratio)
net_consumption_voucher_minted: 4.0 hours
The worker's dashboard shows: "You contributed 8 hours to society today! 4 hours went to funding hospitals, schools, and infrastructure. 4 hours have been localized to your personal Consumption Wallet."

Does that make the mechanical necessity of the upfront deduction clearer? It is the only way to prevent "inflation" and ensure the items in the 🟦 pool remain priced at their literal, honest labor-time cost.

---

well im curious it seems that Model B, Option 1, is the one that allows for retroactively adjusting gross_labor_credited:

gross_labor_credited: 8.0 hours
communal_deduction_rate: 0.5 (dynamically fetched from the current 🏛️ social plan ratio)
net_claim_capacity: 4.0 hours (derived)
claimed_capacity: 2 hours
current_claim_capacity: (derived)

---

Scenario: The Retroactive Debt Trap
Time 1 (The Work):

gross_labor_credited: 8.0 hours
communal_deduction_rate: 0.5 (current rate)
net_consumption_voucher_minted: 4.0 hours (derived)
Time 2 (The Consumption):

Worker buys a 3-hour chair.
consumption_voucher_spent: 3.0 hours
net_consumption_voucher_remaining: 1.0 hours (derived)
Time 3 (The Crisis):

🏛️ determines that due to an unexpected crop failure, more labor must urgently go to communal reserves. It updates the global communal_deduction_rate to 0.75.
Time 4 (The Recalculation): Because your ledger derives the net dynamically, the worker's wallet state instantly becomes:

gross_labor_credited: 8.0 hours
communal_deduction_rate: 0.75 (new rate)
net_consumption_voucher_minted: 2.0 hours (derived: 8 \* 0.25)
consumption_voucher_spent: 3.0 hours (from earlier)
net_consumption_voucher_remaining: -1.0 hours (derived)Z

The Architectural Choice
By keeping the deduction rate dynamically derived, your system allows society to retroactively "tax" unspent (and even spent!) labor vouchers to balance the books during a crisis.

You now have to decide how your ledger handles that -1.0 state. You have two options for your governance (🏛️) rules:

1. Allow Negative Balances (Credit / Debt)
   If a worker can go into -1.0 debt, they effectively owe society 1 hour of "free" labor before they can claim individual consumption goods again. Their next 8-hour shift will wipe the debt and give them fresh positive vouchers.

2. Materialize the Minting (Snapshotting)
   If you do not want workers to randomly fall into debt because the 🏛️ changed the macro-rate, you cannot derive the minting on the fly. You must materialize the net_consumption_voucher_minted down to a static number at the exact moment the 🟢🏛️ validation occurs.

Under snapshotting, the net_consumption_voucher_minted becomes a permanent event in the ledger. If 🏛️ changes the macro-rate tomorrow, it only applies to new labor performed, not past labor.
