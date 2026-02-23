🏛️: Agent (Organization / Governance)
⭐: Use-Rights with Responsibilities (Commitments / Agreements)
🟢: Process (Observation) & RecipeProcess (Knowledge)
🟦: EconomicResource (Instance) & ResourceSpecification (Knowledge)
👤: Agent (Person)
🌀: VfAction (Effects)
🌱: Environment
🔺: Environmental Predicate

# 🏛️: Governance (Agent)

- can issue/grant/revoke 🏛️⭐ any of its own powers to any 🏛️/👤 via `Agreement` and `AgentRelationship`
- if governs 🟦 (`EconomicResource` where Agent is `primaryAccountable`), can issue/grant/revoke 🟦⭐ to eligible 🟢/👤 via `transferAllRights` / `transferCustody` `Commitment`s, must maintain valid combinations of ⭐

# 🏛️: Aggregator/Indexer

- aggregates current/possible/desired 🟦/🔺/👤->🟢/🟦->🟢/🟦{⭐...} (`EconomicResource`, `Intent`, `Commitment`) for use in social planning (e.g., via `IndependentDemandIndex` and `ScenarioIndex`)

# ⭐: Use-Rights with Responsibilities

- Specify who can hold ⭐ (`provider`/`receiver` on `Commitment`)
- Specify what 👤/🟢 can do with 🟦 (Allowed `VfAction`s in `Process`)
- Specify what 👤/🟢 must do: obligations captured via `Commitment` within an `Agreement`
- Specify effects of use on 🟦/🟢/👤/🌀/🌱 (Captured in `ACTION_DEFINITIONS` — e.g. `accountingEffect`, `onhandEffect`)

# 🟦: EconomicResource (Instance)

- Governed by 🏛️ (`primaryAccountable`)
- Exists in Space (`currentLocation` → `SpatialThing`)
- Can be used by ⭐ holders (the `receiver` of a transfer)
- Maintains catalog of possible combinations of ⭐ via type `conformsTo` → `ResourceSpecification`
- Maintains an index of ⭐ distribution over time:
  - Time -> { 🟢⭐1, 👤⭐2, 🟢⭐3 } via event/commitment schedules (`hasBeginning`, `hasEnd`, `due`)

# 🟢: Process

- Governed by 👤/🏛️/🟢 (`inScopeOf` or implicitly via `plannedWithin`)
- Can specify slots (required/optional) via `RecipeFlow`:
  - 🟢 inputs for 🟦, 👤 (labor), 🔺
- If all required slots are filled, 🟢 is considered actual (recorded via `EconomicEvent`s assigned `inputOf` / `outputOf`)
- Specifies its 🌀 when actualized via `action` (e.g., `produce`, `consume`, `work`)

# 👤: Individual/Labor with Skills (Agent: Person)

- Can express `Intent` regardless of 🏛️ approval
- Can express desired 🟦/🌀/🔺 (`Intent` to `consume` or `receive`)
- Can express desire to fill 👤 slots in 🟢 (`Intent` to `work`) which might be taken into account by 🏛️
- Can participate in 🏛️ in manner 🏛️ allows (`AgentRelationship` e.g., "member of")

# 🌀: Effects (VfAction)

- Transform Entity Attributes (`accountingQuantity`, `onhandQuantity`, `currentLocation`) of 🏛️/🟦/🟢/👤/🌀/🌱 depending on the semantic rules mapped in `ACTION_DEFINITIONS`.

# 🔺: Environmental Predicate

- Query Entity Attributes (🏛️/🟦/🟢/👤/🌀/🌱)
- Return boolean

# Planning via Scenarios

## 👤/🟦⭐ -> 🟢 Matching

- 7 dimensions, geometric mean, any = 0 → blocked:
  - ⏰ Time: `availability_window` overlap, min block size
  - 📍 Space: distance decay within search radius (`ScenarioIndex` H3 `resolution`)
  - 📦 Quantity: need vs capacity, allocatable = min(need, capacity)
- (👤 specific) -> 🟢:
  - 🛠️ Skills: bidirectional — does provider meet need's `ResourceSpecification`?
  - 🚗 Travel: can 👤 physically get from prior `Commitment.atLocation` to here in time?
  - 🤝 Affinity: bidirectional trust weights (seeker↔provider)
  - 🔗 Continuity: fragmentation — many small blocks vs few large ones
- (🟦⭐) specific:
  - 🟦 must conform to `ResourceSpecification` required by the process input
  - 🟢 must be capable of receiving 🟦 via valid `action`

// valid prior commitment, conditional on ⭐

## 🟦⭐ -> 👤/🟢 Matching

- 🏛️ can only grant 🟦⭐ where 🟢 satisfies **🟦⭐ holding conditions**, where 🟦⭐ -> 🟢 matching is **physically coherent** (shared space/time), and where the resulting ⭐ distribution is a valid ⭐ combination at that given time.
- Matching bounds 🏛️: the 7 dimensions are a physical floor on governance
- ⭐ bounds matching: feasible is not yet permitted — ⭐ is a social filter on the feasible (handled via `Commitment` → `Agreement` approval)

## 🏛️ Planning Constraints

- Max Individual Working-Day per 👤
- 👤 quantities of space-time availability via `HexIndex` / `TemporalIndex`
- 🟢 Scheduling via `instantiateRecipe`

## 🕑 Time Constraints

- Explicit: `availability_window` (recurrence), `hasBeginning`, `hasEnd`, `hasDuration`
- Implicit: travel time, buffer time

## 🏛️ Social Plan and 🟢 Scheduling

- The social plan (`Plan`) is 🏛️ choosing a distribution of 🟦⭐ that is maximally coherent by selecting from the `Scenario` Pareto front.
- Given a distribution of 👤 space-time availability and quantity, try to achieve production of desired 🟦/🌀/🔺 via 🟢, allocating 👤 time to 🟢 slots (`Commitment` to `work`), and distributing 🟦⭐ to 🟢, and composing 🟢, in such a way that satisfied demand for 🟦/🔺 while minimizing total-labor-time (max free-time) and respecting Max Working-Day per 👤.
- **Social Working Day** = sum of `effortQuantity` across individual `work` Commitments/Events.

## 🏛️ Validation of 👤 Time Contribution to 🟢 in Social Plan

- 🟢🏛️ validates **socially-necessary contribution**, not just raw clock-time worked.
- In ValueFlows, **SNLT** is established at the Knowledge Layer by `RecipeFlow.effortQuantity` (for `action: 'work'`) or `RecipeProcess.hasDuration`. This encodes the socially expected time for a slot.
- The actual time worked is recorded at the Observation Layer by the `EconomicEvent` (`action: 'work'`, tracked in `effortQuantity`).
- 🟢🏛️ (`account.ts` / Commune) can only validate `gross_labor_credited` up to that Knowledge-Layer SNLT limit:
  - If 👤 `EconomicEvent.effortQuantity` (actual) > `RecipeFlow.effortQuantity` (SNLT), they only receive `gross_labor_credited` equal to the SNLT (wasted time is not rewarded).
  - If 👤 `EconomicEvent.effortQuantity` (actual) < `RecipeFlow.effortQuantity` (SNLT), they still receive `gross_labor_credited` equal to the SNLT (efficiency is rewarded with extra free-time).
- 🟢🏛️ validation records the `gross_labor_credited` (`Account.creditFromEvent`), which is then processed by the `communal_deduction_rate` to grant `net_claim_capacity`.
- This `net_claim_capacity` can be used by 👤 to claim 🟦 from the **🟦 Individual Consumption Pool** (`Account.claimGoods`).

// We should add note about the loop for updating the SNLT of RecipeFlows
// Also the quality of goods produced should be tracked. We must record probabilities etc. what quantity conforms to the resource specs we have socially validated as desired in the plan.

---

## 1. Is SNLT the cost divided across the quantity of outputs?

Yes. If a `RecipeProcess` (🟢) has a total SNLT of 10 hours (`RecipeFlow.effortQuantity` for inputs) and produces 100 apples (`RecipeFlow.resourceQuantity` for outputs), the labor cost per apple is 10 / 100 = 0.1 hours. The **SNLT per unit** _(Total Social Labor / Total Social Output of 🟦)_ is always distributed across the fungible quantity of outputs.

## 2. Do we count all dependent processes prior to the final process?

Yes, absolutely. The math is handled elegantly as "Dead Labor" being transferred via the `Scenario` graph (`inputOf` / `outputOf` links). In Marxist terms:

**Living Labor (👤 slot)**: The SNLT (`effortQuantity`) assigned to the current `RecipeProcess`.
**Dead Labor (🟦 slots)**: The labor hours physically embodied in the inputs (`EconomicResource`s) used up (`action: 'consume'`) by the `Process`. These are the accumulated SNLT costs from all upstream dependent processes tracing back through the supply chain.

If your apple orchard `Process` has a total SNLT of 2 hours for human labor (`work`), but also `consume`s fertilizer that carries 1 hour of SNLT produced in a previous `Process`, the total labor cost to produce the apples is 3 hours. If it `produce`s 30 apples, the SNLT per unit is 3 / 30 = 0.1 hours. Every `EconomicResource` passing through the economy essentially "carries" its accumulated labor-time history with it into the next `Process`.

## 3. If deductions already happen for all that (communal consumption, etc.), how does this balance?

This is the brilliant part of Marx's Critique of the Gotha Programme. You do not lower the "price" of the consumer goods, nor do you double-count.

Here is how the math balances across the whole society using the `Commune` and `Account` classes:

Let's imagine a micro-economy of 1,000 workers (`Agent`s). They each perform `work` events that yield 8 hours of `gross_labor_credited` today. Total `gross_labor_credited` = 8,000 hours.

**Society uses those 8,000 hours doing three different types of `Process`es:**

- Means of Production (making tractors, fertilizer to replace what was used up today): 2,000 hours
- Communal Needs (hospitals, schools, overhead for 🏛️): 2,000 hours
- Individual Consumption Goods (apples, chairs, for the 🟦 Individual Consumption Pool): 4,000 hours

The Capacity Side (Income): The workers received 8,000 hours of `gross_labor_credited` total. But 🏛️ knows 4,000 hours went to non-individual consumption. So, a `CommunalDeductionRate` of 50% (0.5) is dynamically fetched from the current `Plan` ratio.

**Each worker's `gross_labor_credited` of 8 hours yields a derived `net_claim_capacity` of 4 hours.**
Total `net_claim_capacity` of all workers = 4,000 hours.

The Production Side (Prices): The aggregate labor cost of the apples, chairs, etc., that go into the 🟦 Individual Consumption Pool (`current_consumption_pool`) is exactly the amount of SNLT that went into making them (including the "dead labor" transferred from the means of production `consume`d to make them).

**Total "price" of all goods in the 🟦 Individual Consumption Pool = 4,000 hours.**

The Exchange: The workers use their 4,000 hours of `net_claim_capacity` to claim the 4,000 hours worth of consumption goods (which increases their `claimed_capacity` and reduces their `current_potential_claim_capacity`). The goods produced for non-individual consumption never enter the 🟦 Individual Consumption Pool, so workers never have to claim them with their capacity. Those 🟦 are managed and routed directly by the 🏛️ via `Plan`s.

## Summary

The "cost" of a 🟦 (`EconomicResource`) in the Individual Consumption Pool is the Full Recursive SNLT per unit (Living Labor + Dead Labor) of the `Process` graph that produced it.

Because 🏛️ derives the `net_claim_capacity` based on the `communal_deduction_rate`, the total claim capacity circulating will perfectly equal the total labor-cost of the goods placed in the 🟦 Individual Consumption Pool. You don't need to do any special discounting on the goods themselves — their price is exactly their honest labor cost!

---

# Local Variables (mapped to `Account`)

`gross_labor_credited`: 8.0 hours
`commune.communal_deduction_rate`: 0.5 (from current `Plan`)
`net_claim_capacity`: 4.0 hours = gross_labor_credited x (1 - communal_deduction_rate)
`claimed_capacity`: 2.0 hours
`current_potential_claim_capacity`: 2.0 hours (net - claimed)

# Global Variables (mapped to `Commune`)

`commune.social_total_potential_claims`: 4000h (Sum of EVERYONE'S `current_potential_claim_capacity`)
`commune.current_consumption_pool`: 2000h (Sum of SNLT of all 🟦 `EconomicResource`s currently sitting in the pool)

# Elastic Derivation

`account.current_share_of_claims`: 2.0 / 4000.0 = 0.0005 (You hold 0.05% of the world's outstanding claims)
`account.current_actual_claim_capacity`: 0.0005 \* 2000h = 1.0 hour

---

# Decentralized Planning

# Planning Loop

## Replacement

## Insurance

## Expansion

# Legal Frame
