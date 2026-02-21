🏛️: Governance
⭐: Use-Rights with Responsibilities
🟢: Process
🟦: Resource
👤: Individual/Labor with Skills
🌀: Effects
🌱: Environment
🔺: Environmental Predicate

# 🏛️: Governance

- can issue/grant/revoke 🏛️⭐ any of its own powers to any 🏛️/👤
- if governs 🟦, can issue/grant/revoke 🟦⭐ to eligible 🟢/👤, must maintain valid combinations of ⭐

# 🏛️: Aggregator/Indexer

- aggregates current/possible/desired 🟦/🔺/👤->🟢/🟦->🟢/🟦{⭐...} for use in social planning

# ⭐: Use-Rights with Responsibilities

- Specify who can hold ⭐
- Specify what 👤/🟢 can do with 🟦
- Specify what 👤/🟢 must do: with 🟦, or when it uses 🟦
- Specify effects of use on 🟦/🟢/👤/🌀/🌱

# 🟦: Resource

- Governed by 🏛️
- Exists in Space
- Can be used by ⭐ holders
- Maintains catalog of possible combinations:
  - { ⭐1, ⭐2, ⭐3 }
  - { ⭐1, ⭐4 }
  - { ⭐5 }
- Maintains an index of ⭐ distribution over time:
  - Time -> { 🟢⭐1, 👤⭐2, 🟢⭐3 }

# 🟢: Process

- Governed by 👤/🏛️/🟢
- Can specify slots (required/optional):
  - 🟢, 🟦⭐, 👤, 🔺
  - 🟦⭐ implies 🟦
- If all required slots filled 🟢 is considered actual
- Can specify its 🌀 when actualized

# 👤: Individual/Labor with Skills

- Can express 🟢 regardless of 🏛️ approval
- Can express desired 🟦/🌀/🔺 (express needs/priorities)
- Can express desire to fill 👤 slots in 🟢 which might be taken into account by 🏛️
- Can participate in 🏛️ in manner 🏛️ allows (perhaps based on participation in 🟢)

# 🌀: Effects

- Transform Entity Attributes (🏛️/🟦/🟢/👤/🌀/🌱)

# 🔺: Environmental Predicate

- Query Entity Attributes (🏛️/🟦/🟢/👤/🌀/🌱)
- Return boolean

# Planning

## 👤/🟦⭐ -> 🟢 Matching

- 7 dimensions, geometric mean, any = 0 → blocked:
  - ⏰ Time: availability window overlap (timezone-aware), min block size
  - 📍 Space: distance decay within search radius, remote = always pass
  - 📦 Quantity: need vs capacity, allocatable = min(need, capacity)
- (👤 specific) -> 🟢:
  - 🛠️ Skills: bidirectional — does provider meet need's skills? does seeker meet capacity's?
  - 🚗 Travel: can 👤 physically get from prior commitment to here in time?
  - 🤝 Affinity: bidirectional trust weights (seeker↔provider)
  - 🔗 Continuity: fragmentation — many small blocks vs few large ones
- (🟦⭐) specific:
  - 🟦⭐ must be in 🟦's catalog of possible combinations
  - 🟢 must be capable of holding 🟦⭐

// valid prior commitment, conditional on ⭐

## 🟦⭐ -> 👤/🟢 Matching

- 🏛️ can only grant 🟦⭐ where 🟢 satisfies **🟦⭐ holding conditions**, where 🟦⭐ -> 🟢 matching is **physically coherent**, and where the resulting ⭐ distribution is a valid ⭐ combination at that given time.
- Matching bounactualds 🏛️: the 7 dimensions are a physical floor on governance
- ⭐ bounds matching: feasible is not yet permitted — ⭐ is a social filter on the feasible

## 🏛️ Planning Constraints

- Max Individual Working-Day per 👤
- 👤 quantities of space-time availability via @aggregation.ts
- 🟢 Scheduling

## 🕑 Time Constraints

- Explicity (total-duration, start, end, recurrence) if no start/end, then Scheduling
- Implicity (travel time, buffer time)

## 🏛️ Social Plan and 🟢 Scheduling

- The social plan is 🏛️ choosing a distribution of 🟦⭐ that is maximally coherent:
- Given a distribution of 👤 space-time availability and quantity, try to achieve production of desired 🟦/🌀/🔺 via 🟢, allocating 👤 time to 🟢 slots, and distributing 🟦⭐ to 🟢, and composing 🟢, in such a way that that satisfied demand for 🟦/🔺 while minimizing total-labor-time (max free-time) and respecting Max Working-Day per 👤
- Project Network? Critical Path?
- There might be many valid plans, 🏛️ can choose any of them, making decisions on the valid set, which constrain suggestions, while clearly showing which possible plans are not possible given those decisions.
- **Social Working Day** = sum of individual hours of work.

## 🏛️ Validation of 👤 Time Contribution to 🟢 in Social Plan

- 🟢🏛️ validates **socially-necessary contribution**, not just raw clock-time worked.
- Every 🟢 has an established slot duration based on the current **Socially Necessary Labor Time (SNLT)** determined by the 🏛️ Social Plan.
- 🟢🏛️ can only validate `gross_labor_credited` up to that SNLT limit:
  - If 👤 works slower than the SNLT, they only receive `gross_labor_credited` equal to the SNLT (wasted time is not rewarded).
  - If 👤 works faster than the SNLT, they still receive `gross_labor_credited` equal to the SNLT (efficiency is rewarded with extra free-time).
- 🟢🏛️ validation records the `gross_labor_credited`, which is then processed by the `communal_deduction_rate` to grant `net_claim_capacity`.
- This `net_claim_capacity` can be used by 👤 to claim 🟦 from the **🟦 Individual Consumption Pool**.

---

## 1. Is it the cost divided across the quantity of outputs?

Yes. If a 🟢 process has a total SNLT of 10 hours and produces 100 apples, the labor cost per apple is 10 / 100 = 0.1 hours. The **SNLT per unit** _(Total Social Labor / Total Social Output of 🟦)_ is always distributed across the fungible quantity of outputs.

## 2. Do we count all dependent processes prior to the final process?

Yes, absolutely. You must count the entire upstream chain, but the math is handled elegantly as "Dead Labor" being transferred. In Marxist terms, the total labor cost of an output 🟦 is made of two things:

**Living Labor (👤 slot)**: The SNLT assigned to the current 🟢 process.
**Dead Labor (🟦 slots)**: The labor hours already embodied in the inputs used up by the 🟢 process. These are the SNLT costs from all upstream dependent processes.

If your apple orchard 🟢 has a total SNLT of 2 hours for human labor (👤), but also uses fertilizer (🟦) that carries 1 hour of SNLT produced in a previous 🟢 process, the total labor cost to produce the apples is 3 hours. If it produces 30 apples, the SNLT per unit is 3 / 30 = 0.1 hours. Every 🟦 passing through the economy essentially "carries" its accumulated labor-time history with it into the next 🟢.

## 3. If deductions already happen for all that (communal consumption, etc.), how does this balance?

This is the brilliant part of Marx's Critique of the Gotha Programme and your intuition is spot on. You do not lower the "price" of the consumer goods, nor do you double-count.

Here is how the math balances across the whole society:

Let's imagine a micro-economy of 1,000 workers. They each perform labor that yields 8 hours of `gross_labor_credited` today. Total `gross_labor_credited` = 8,000 hours.

**Society uses those 8,000 hours doing three different types of 🟢 processes:**
Means of Production (making tractors, fertilizer to replace what was used up today): 2,000 hours
Communal Needs (hospitals, schools, overhead for 🏛️): 2,000 hours
Individual Consumption Goods (apples, chairs, for the 🟦 Individual Consumption Pool): 4,000 hours

The Capacity Side (Income): The workers received 8,000 hours of `gross_labor_credited` total. But 🏛️ knows 4,000 hours went to non-individual consumption. So, a `communal_deduction_rate` of 50% (0.5) is dynamically fetched from the current 🏛️ social plan ratio.

**Each worker's `gross_labor_credited` of 8 hours yields a derived `net_claim_capacity` of 4 hours.**
Total `net_claim_capacity` of all workers = 4,000 hours.

The Production Side (Prices): The aggregate labor cost of the apples, chairs, etc., that go into the 🟦 Individual Consumption Pool is exactly the amount of SNLT that went into making them (including the "dead labor" transferred from the means of production used up to make them).

**Total "price" of all goods in the 🟦 Individual Consumption Pool = 4,000 hours.**

The Exchange: The workers use their 4,000 hours of `net_claim_capacity` to claim the 4,000 hours worth of consumption goods (which increases their `claimed_capacity` and reduces their `current_claim_capacity`). The goods produced for non-individual consumption never enter the 🟦 Individual Consumption Pool, so workers never have to claim them with their capacity. Those 🟦 are managed and routed directly by the 🏛️ (e.g., tractors are sent straight to farms, hospitals are free at point of use).

## Summary

The "cost" of a 🟦 in the Individual Consumption Pool is the Full Recursive SNLT per unit (Living Labor + Dead Labor) of the 🟢 that produced it (Total Social Labor / Total Social Output of 🟦).

Because 🏛️ derives the `net_claim_capacity` based on the `communal_deduction_rate`, the total claim capacity circulating will perfectly equal the total labor-cost of the goods placed in the 🟦 Individual Consumption Pool. You don't need to do any special discounting on the goods themselves — their price is exactly their honest labor cost!

---

# Local Variables

`gross_labor_credited`: 8.0 hours
`communal_deduction_rate`: 0.5 (from current 🏛️ plan)
`net_claim_capacity`: 4.0 hours = gross_labor_credited x (1 - communal_deduction_rate)
`claimed_capacity`: 2.0 hours
`current_potential_claim_capacity`: 2.0 hours (net - claimed)

# The Global Variables

`social_total_potential_claims`: 4000h (Sum of EVERYONE'S current_potential_claim_capacity)
`current_consumption_pool`: 2000h (Sum of SNLT of all 🟦 currently sitting in the pool)

# The Elastic Derivation

`current_share_of_claims`: 2.0 / 4000.0 = 0.0005 (You hold 0.05% of the world's outstanding claims)
`current_actual_claim_capacity`: 0.0005 \* 2000h = 1.0 hour

---
