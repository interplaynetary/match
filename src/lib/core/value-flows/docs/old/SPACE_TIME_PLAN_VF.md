# Space-Time Planning in ValueFlows Language

> The pre-VF SPACE*TIME_PLAN.md describes a search algorithm over \_candidate timelines*.
> This document re-expresses the same ideas in native VF vocabulary and clarifies
> where the boundary between **Scenario** and **Plan** lies.

---

## The Core Question: Scenario or Plan?

The pre-VF doc conflates two distinct things that VF separates cleanly:

| Concept                                 | Pre-VF name                              | VF name                                                                                          | Layer       |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| A committed, agreed-upon future         | `Plan` (committed nodes)                 | **Plan** + **Commitments**                                                                       | Planning    |
| A candidate future being evaluated      | `Plan` (frontier beam)                   | **Scenario**                                                                                     | _Extension_ |
| A single atomic operation               | `SpaceTimePlanNode`                      | **Process** + its Commitments                                                                    | Planning    |
| The "address" of an operation           | `SpaceTimePlanKey`                       | `spaceTimeSig(process)` + `processConformsTo`                                                    | Utils       |
| The inventory of what exists            | `LaborIndex / NeedIndex / ResourceIndex` | `AgentIndex / EconomicResourceIndex / IntentIndex`                                               | Indexes     |
| A satisfied need / resolved deficit     | `deficit: []` in score                   | **Intent** with `finished: true`                                                                 | Planning    |
| An unresolved deficit                   | `deficits: [{...}]`                      | **Intent** with no satisfying Commitment                                                         | Planning    |
| A cross-cell flow that emerges at merge | emergent cross-cell operation            | Pair of **Commitments** (`satisfies` → deficit Intent) — Agreement optional, created post-commit | Planning    |

**Answer: The algorithm operates at the Scenario level. A Scenario is a candidate Plan — a set of Processes and Commitments that has not yet been committed. When selected from the Pareto front, a Scenario becomes a Plan.**

---

## VF Concept Map

```
                ╔══════════════════════════════════════════════════════════╗
                ║                    SCENARIO  (extension)                ║
                ║                                                          ║
                ║  id:         hash(sorted process IDs)                   ║
                ║  processes:  Set<Process>            (the atoms)         ║
                ║  commitments: Set<Commitment>        (the flows)         ║
                ║  score:      ScenarioScore           (see below)         ║
                ║  deficits:   Intent[]                (unresolved)        ║
                ║  surpluses:  {specId, quantity}[]    (excess output)     ║
                ╚══════════════════════════╦═══════════════════════════════╝
                                           │ on SELECT → becomes
                                           ▼
                ╔══════════════════════════════════════════════════════════╗
                ║                       PLAN  (VF core)                  ║
                ║                                                          ║
                ║  id / name / due                                         ║
                ║  hasIndependentDemand → IndependentDemandIndex          ║
                ╚══════════════════════════════════════════════════════════╝

Each Scenario contains one or more:

  ┌─────────────────────────────────────────────────────────────────────┐
  │  Process  (VF core)                                                 │
  │                                                                     │
  │  id / name / basedOn (ProcessSpec) / plannedWithin / atLocation    │
  │  hasBeginning / hasEnd                                              │
  │                                                                     │
  │  ← its "SpaceTimePlanKey" =                                         │
  │      commitmentToSpaceTimeContext(commitment, location, h3Res)      │
  │      + "::" + processConformsTo                                     │
  └───────────────────┬────────────────────────────────────────────────┘
                      │
          input Commitments (inputOf this Process)
          output Commitments (outputOf this Process)
                      │
  ┌───────────────────▼────────────────────────────────────────────────┐
  │  Commitment  (VF core)                                             │
  │                                                                     │
  │  action / provider / receiver                                       │
  │  resourceConformsTo / resourceQuantity / effortQuantity             │
  │  satisfies → Intent  (the demand this commitment resolves)          │
  │  independentDemandOf → Plan  (if this is a terminal deliverable)    │
  │  availability_window (TemporalExpression — for recurring schedules) │
  └────────────────────────────────────────────────────────────────────┘
```

---

## The Search Algorithm in VF Terms

### Atoms (leaf-level, one Process per cell)

```
for each h3 leaf cell (res 9):
  1. query AgentIndex(cell)        → available work Intents in this cell
  2. query EconomicResourceIndex(cell) → on-hand inventory
  3. query IndependentDemandIndex(cell) → what Intents need satisfying here
  4. call instantiateRecipe(recipe, {observer}) → builds Processes + Commitments
     — inventory-aware: Commitments that can use existing resources skip new demand
  5. wrap in a Scenario{ id: hash, score: scoreScenario(...) }
  6. emit to merge layer
```

### Merge (one H3 level up)

```
merge(scenarioA, scenarioB, resolution):
  — Find Intents in A.deficits whose h3ToParent(location, resolution)
    matches h3ToParent(B.location, resolution)  AND  specId matches
    some B.commitments[*].resourceConformsTo
  — For each match:
      create Commitment in B (outputOf → B's Process)
        .resourceConformsTo = deficit.spec_id
        .resourceQuantity   = deficit.remaining_quantity
      create Commitment in A (inputOf → A's Process)
        .resourceConformsTo = deficit.spec_id
        .satisfies = deficit.intent_id    ← the only link needed
      remove the Intent from A.deficits
  — Return new merged Scenario{
      processes: A.processes ∪ B.processes,
      commitments: A.commitments ∪ B.commitments ∪ newCommitments,
      score: scoreScenario(merged)
    }
```

The cross-cell flow emerges at the merge step as a pair of Commitments — one output from B satisfying an input demand in A — linked only by `Commitment.satisfies → Intent.id`. No Agreement object is required during search.

> **Note on Agreement:** Agreement is a _post-commit formalization_, not a search primitive.
> During the Scenario search, the only link needed is `Commitment.satisfies → Intent`.
> An Agreement can be created lazily when the winning Scenario is promoted to a Plan,
> to document the bilateral economic relationship — but it plays no role in the hash,
> the merge logic, or the Pareto score. This keeps the search fully deterministic
> from Commitment content alone.

### Score

```ts
interface ScenarioScore {
  intents_satisfied: number; // count of Intents now with a satisfying Commitment
  intents_total: number; // total Intents in scope
  total_effort_hours: number; // sum of effortQuantity across all Commitments (≈ SNLT)
  deficit_specs: string[]; // ResourceSpecification IDs still unmet
  h3_resolution_depth: number; // how many levels contributed (higher = more coordination)
}
```

**Domination**: Scenario A dominates B iff `A.intents_satisfied >= B.intents_satisfied && A.total_effort_hours <= B.total_effort_hours`.

### Select → commit to Plan

```
selected = paretoFront(scenarios)[policyFn]
plan = planStore.addPlan({ name, due })
for process of selected.processes:
  process.plannedWithin = plan.id         // bind to the Plan
for commitment of selected.commitments:
  commitment.plannedWithin = plan.id
plan.hasIndependentDemand = selected.deficits
  .filter(i => !i.finished)
  .map(i => i.id)
```

---

## The Independent Demand Index

An **independent demand** in VF is an Intent (or Commitment) with `independentDemandOf → Plan.id` — it represents a _terminal deliverable_, a need that the Plan's supply chain must ultimately satisfy. This is the VF translation of the `deficits` array.

### Why a dedicated index?

The planning algorithm needs to answer:

- _Which Intents in this H3 cell (or region) are unsatisfied?_ → seed the bottom-up build
- _Which Commitments are marked as independent demands of a given Plan?_ → the Plan's "wish list"
- _What fraction of a Plan's independent demands have been fulfilled?_ → Plan completion %

None of the existing indexes answer these directly. The `IntentIndex.agent_index` groups by agent, not by demand status or plan. The `CommitmentIndex.plan_index` groups by `plannedWithin`, not `independentDemandOf`.

### Structure

```ts
interface IndependentDemandIndex {
  // Intents with no satisfying Commitment (open demands)
  open_intents: Map<string, Intent>; // intentId → Intent

  // Which open intents fall in which H3 cell?
  cell_index: Map<string, Set<string>>; // h3Cell@res → intentIds

  // Which open intents need which ResourceSpecification?
  spec_index: Map<string, Set<string>>; // specId → intentIds

  // Which Commitments are marked as independentDemandOf a given Plan?
  plan_demand_index: Map<string, Set<string>>; // planId → commitmentIds

  // Spatial hierarchy over open Intents (for radius queries during planning)
  spatial_hierarchy: HexIndex<Intent>;
}
```

### Build logic

```
buildIndependentDemandIndex(intents, commitments, observer, locations):
  for each Intent i where !i.finished:
    satisfied = observer.satisfiedBy(i.id).length > 0
                OR commitments.some(c => c.satisfies === i.id)
    if !satisfied:
      open_intents.set(i.id, i)
      cell_index ← h3Cell(i.atLocation)
      spec_index ← i.resourceConformsTo

  for each Commitment c where c.independentDemandOf:
    plan_demand_index ← c.independentDemandOf
```

---

## Scenario vs Plan: The Clean Boundary

```
  SCENARIO                          PLAN
  (candidate, mutable, in-memory)   (committed, persistent, VF-native)
  ─────────────────────────────     ───────────────────────────────────
  Not stored in PlanStore           Stored in PlanStore
  Processes have no plannedWithin   Processes have plannedWithin = planId
  Evaluated on Pareto score         The "winner" of the Pareto search
  Can be merged with other          Commitments are binding agreements
  Scenarios                         (clauseOf Agreement or active Commitments)
  Identified by hash of its         Identified by its planId
  process IDs
  Deficits = open Intent list       Deficits promoted to hasIndependentDemand
  Score computed on the fly         Score not stored (observable via queries)
```

A Scenario at the merge step that reaches the global level and is selected by the policy function is promoted to a Plan by binding all its Processes and Commitments to a `Plan` record. The open Intents become `Plan.hasIndependentDemand`.

---

## Relationship to Existing Modules

| Module                                          | Role in Scenario search                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `planning.ts:instantiateRecipe()`               | Leaf-level Scenario constructor (single recipe, single cell) |
| `AgentIndex`                                    | Supply side: available work Intents by spec+cell             |
| `EconomicResourceIndex`                         | Stock: existing inventory by spec+cell                       |
| `IntentIndex`                                   | Demand side: all Intents (needs filtered by spec+cell)       |
| `IndependentDemandIndex`                        | _(new)_ Filtered demand: open Intents, indexed by cell+spec  |
| `CommitmentIndex.satisfies_index`               | Per-occurrence fulfillment tracking                          |
| `recurrence.ts:unfulfilledOccurrences()`        | Recurring demand gap detection                               |
| `space-time-keys.ts:intentToSpaceTimeContext()` | Addressing for spatial merge step                            |
| `space-time-scenario.ts`                        | _(to build)_ Scenario type + merge + score + Pareto          |

---

## What `space-time-scenario.ts` Should Contain

1. **`Scenario` type** — wraps Processes + Commitments + score + deficits
2. **`scoreScenario(scenario, index)`** → `ScenarioScore`
3. **`scenarioDominates(a, b)`** → boolean (Pareto check)
4. **`mergeScenarios(a, b, resolution)`** → `Scenario | Conflict`  
   — creates cross-cell Commitment pairs (`satisfies` → deficit Intent); no Agreement created here
5. **`mergeFrontier(scenarios, resolution, planStore)`** → `Scenario[]` (pruned Pareto front)
6. **`scenarioToPlan(scenario, planStore, processRegistry)`** → `Plan`  
   — commit the winning Scenario to the VF graph

The `IndependentDemandIndex` feeds step 2 (scoring) and step 1 (seeding the leaf solver).
