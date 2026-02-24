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

## 📐 Resource Value Calculation

- **Total Recursive SNLT**: The full labor cost of a 🟦 is the sum of living and dead labor.
  - `Total SNLT = Living Labor + Dead Labor`
  - **Living Labor (👤 slot)**: SNLT assigned to the current 🟢 process.
  - **Dead Labor (🟦 slots)**: SNLT embodied in inputs used up by the 🟢 process.
- **SNLT per unit**: Distributed across the fungible quantity of outputs.
  - `SNLT_per_unit = Total_Recursive_SNLT / Total_Social_Output_of_🟦`

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
- Matching bounds 🏛️: the 7 dimensions are a physical floor on governance
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

## 📐 Capacity & Claim Equations

- **Net Claim Capacity**: Derived from gross labor after communal deductions.
  - `net_claim_capacity = gross_labor_credited * (1 - communal_deduction_rate)`
- **Current Potential Claims**: Remaining capacity after claims are made.
  - `current_potential_claim_capacity = net_claim_capacity - claimed_capacity`
- **Social Share**: The individual's portion of total outstanding claims.
  - `current_share_of_claims = current_potential_claim_capacity / social_total_potential_claims`
- **Actual Claim Capacity**: The real-world purchasing power relative to the available consumption pool.
  - `current_actual_claim_capacity = current_share_of_claims * current_consumption_pool`

---

# Planning Loop

We are aiming to define an integrated planning engine that uses some combination of forward/backwards passes with spatio-temporal optimizations to reconcile social needs with material and labor feasibility.

## 👥 Demand Categories (D-Series)

**Dependent Demand**
_magnitude is to be determined according to available means and forces, and partly by computation of probabilities_

- **D1 (Replace Used up Means of Production)**: Structural reproduction of the tools and machines required by the catalog.
  - **Determination**: Usage during planning period.
    // But only replace those we _want_ to keep having

- **D2 (Deficits)**: Not a demand category, but an expansion signal emitted when `needed > feasible`.
  - **Determination**: Residual signal returned by the backward pass whenever intent quantity exceeds feasible capacity (bounded by material and labor).

- **D3 (Insurance)**: A dynamic safety buffer (percentage-based) applied on top of final output requirements.

- **D4 (Administration)**: Operational overhead and governance requirements, not related to production, but to the functioning of the 🏛️, and enforcement of ⭐ distribution.

**Independent Demand (Means of Consumption)**

- **D5 (Communal Satisfaction of Needs)**
  - ecology, schools, health services, etc.
- **D6 (Individual Consumption)**
  - Individual Consumption Pool
  - A portion is deducted for those unable to work.

## Usage:

🟦: {
lifespan_remaining: (uses_remaining | time_remaining),
maintenance_history: [🟢repair1, 🟢repair2],
efficiency_factor: 0.95 // after 100 uses, 5% less efficient
}

- Keep track of use, life-span of economic-resource, like in stock.book
- We can then see what processes extend life-span? Number of uses? How did stockbook keep track?
- Cuz then we see whether we should do processes to repair/maintain/extend life-span of economic-resource
  or produce more of it to make u for those used?

# Antifragility (Robust Heuristics for Planning)

- convexity-first: prioritize improving payoff structure over knowledge acquisition
- diversification: spread resources across many small trials rather than few large ones
- barbell-strategy: 90% capacity directed to robust/stable progress, 10% spread across antifragile experimentation
- serial-optionality: maintain flexibility with short-term plans and frequent exit points
- negative-knowledge: learn from failures and document what doesn't work
- opportunistic-adaptation: invest in agents who can pivot and exploit opportunities
