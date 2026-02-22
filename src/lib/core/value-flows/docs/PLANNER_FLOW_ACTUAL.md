# Integrated Planner — Actual Flow vs Spec

> Compares the implementation in `planning/integrated-planner.ts` against the
> design spec in `docs/SPACE_TIME_PLAN_VF.md`.

---

## Overview

The spec describes a three-phase loop: **Atoms → Merge → Select**.
The implementation follows this structure but adds a **D-series backward pass**
between the atom step and the recipe graph construction — this is the main
intentional extension beyond the spec.

---

## Step-by-step comparison

### Step 1 — Atom (leaf cell, res 9)

**Spec says:**
```
1. query AgentIndex(cell)            → available work Intents in this cell
2. query EconomicResourceIndex(cell) → on-hand inventory
3. query IndependentDemandIndex(cell) → what Intents need satisfying here
4. call instantiateRecipe(recipe, {observer}) → Processes + Commitments
5. wrap in Scenario{ id: hash, score: scoreScenario(...) }
```

**Implementation (`generateLeafScenario`):**

```
1. buildAgentIndex(workIntents, agents, locations, leafResolution)
      workIntents = allIntents.filter(action==='work' && provider)
      → AgentIndex with one AgentCapacity node per (agent, space_time_sig)  ✓

2. observer.inventory() / observer.inventoryForSpec(specId)
      → all-cell snapshot of EconomicResources via Observer
      ⚠ uses Observer, not EconomicResourceIndex directly (see note below)

3. DemandSlots passed in from the caller
      → caller pre-filters IndependentDemandIndex by cell before calling
      ✓ correct, just happens at the call site not inside the function

4a. buildVfFeasibleRecipes(recipeStore, observer, agentIndex)
      → FORWARD PASS: per-recipe feasibility envelopes (maxByMaterial, maxByLabor, snltPerUnit)
      → sorted by snltPerUnit ascending (SNLT-efficiency ordering)
      ✗ not in spec — this is an explicit pre-screen before backward pass

4b. vfPlanFromNeeds(demands, feasibleBySpec, ...)
      → BACKWARD PASS: D-series demand loop, inventory netting, recursive intermediates
      ✗ not in spec — D-series classification is an extension (see §D-series below)
      → emits D2 expansionSignals for gaps (spec doesn't cover this)

4c. planStore.buildRecipeGraph(recipeId, quantity, dueDate, intentId?)
      → PURE graph builder: Processes + Commitments in-memory, no PlanStore writes
      → sets Commitment.satisfies = intentId on primary output so scoreScenario counts it
      ✓ aligns with spec intent; replaces instantiateRecipe() which writes to PlanStore

5. computeScenarioId(signatures)   — djb2 hash of sorted commitmentSignature(c, loc, res)
   scoreScenario(scenario, allIntents)
      ✓ matches spec exactly
```

**Observer vs EconomicResourceIndex:**
The spec table maps inventory to `EconomicResourceIndex` but both the spec doc
(`planning.ts:instantiateRecipe(recipe, {observer})`) and the implementation use
`Observer` as the inventory source. `Observer` is the VF observation layer and
subsumes `EconomicResourceIndex`; no divergence in practice.

---

### Step 1b — D-series backward pass (extension beyond spec)

Not in the spec. Added because the commons resource classification system
(`RESOURCE_CLASSIFICATION.md`) assigns every ResourceSpecification a D-category
tag that determines planning priority.

| D-category | Tag | Priority | How handled |
|------------|-----|----------|-------------|
| D1 | `tag:plan:D1-MeansOfProduction` | 1st | explicit `d1Targets` map (depreciation) |
| D4 | `tag:plan:D4-Administration` | 2nd | demand slots tagged D4 |
| D5 | `tag:plan:D5-Consumption` | 3rd | all other demand slots (default) |
| D6 | `tag:plan:D6-Support` | 4th | demand slots tagged D6 |
| D3 | _(derived)_ | last | `insuranceFactor × total` of D1/D4/D5/D6 |
| D2 | _(signal)_ | — | emitted when needed > feasible → `expansionSignals` |

**Within each D-category** the planner:
1. Nets against remaining inventory first
2. Selects the most SNLT-efficient feasible recipe (sorted by `snltPerUnit`)
3. Consumes material inputs from the remaining inventory map
4. Recurses for intermediate input deficits (max depth 10)

The selection output is `VfSelectedRecipe[]` — not Processes/Commitments yet.
Graph construction happens in Phase 3 via `buildRecipeGraph`.

---

### Step 2 — Merge

**Spec says:**
```
merge(A, B, resolution):
  Find A.deficits where h3ToParent(location, res) === h3ToParent(B.location, res)
    AND specId matches B.commitments[*].resourceConformsTo
  For each match:
    create Commitment in B (outputOf → B's Process)
    create Commitment in A (inputOf → A's Process, satisfies → deficit.intent_id)
    remove Intent from A.deficits
  Return new Scenario{ processes: A∪B, commitments: A∪B∪new, score: recomputed }
```

**Implementation (`mergeScenarios` in `space-time-scenario.ts`):**

```
Guard: both origin_cells must share a parent at resolution
  aParent = h3.cellToParent(a.origin_cell, resolution)
  bParent = h3.cellToParent(b.origin_cell, resolution)
  if aParent !== bParent → MergeConflict{no_common_parent}   ✓

Match: A.deficits where spec_id is in B.surpluses (not B.commitments directly)
  ⚠ spec says "B.commitments[*].resourceConformsTo" but impl uses B.surpluses
    → B.surpluses are pre-computed excess outputs, equivalent in result

Cross-cell transfer Commitments (process-free — VF allows this):
  outCommitment: { action:'transfer', resourceConformsTo: spec, quantity: qty }
  inCommitment:  { action:'transfer', resourceConformsTo: spec, quantity: qty,
                   satisfies: deficit.intent_id }
  ✓ satisfies link matches spec exactly
  ✓ no outputOf/inputOf — VF process-free transfers, as spec notes

Score: scoreScenario(merged, allIntents) recomputed after merge   ✓
```

**`mergeFrontier`** drives the loop:
- Groups scenarios by `h3.cellToParent(s.origin_cell, resolution)`
- Tries all pairs within each group
- Prunes to Pareto front per group
- Adds merged Scenarios to `ScenarioIndex`

Called for `res = leafResolution-1` down to `rootResolution` (res 8 → 3 with defaults).

---

### Step 3 — Pareto front + Select

**Spec says:**
```
selected = paretoFront(scenarios)[policyFn]
plan = planStore.addPlan(...)
for process in selected.processes: process.plannedWithin = plan.id
for commitment in selected.commitments: commitment.plannedWithin = plan.id
plan.hasIndependentDemand = selected.deficits.filter(!finished).map(i.id)
```

**Implementation:**

`runPlanningSearch` returns `{ index, front: globalParetoFront(index) }`.
The caller picks the winner from `front` and calls `promoteToPlan(winner, planStore)`.

`promoteToPlan` does:
```
1. planStore.processes.register(process) for each process not already stored
2. planStore.addCommitment(commitment)   for each commitment not already stored
3. scenarioToPlan(scenario, planStore.addPlan, updateProcess, updateCommitment)
      → creates Plan record
      → stamps process.plannedWithin = plan.id on all processes
      → stamps commitment.plannedWithin = plan.id on all commitments
```

`plan.hasIndependentDemand` is set inside `scenarioToPlan` from the final
outputs of the last process, not from `selected.deficits` directly.

**Domination** (matches spec exactly):
```
A dominates B iff A.intents_satisfied >= B.intents_satisfied
                  AND A.total_effort_hours <= B.total_effort_hours
                  AND (one strict improvement)
```

---

## Alignment summary

| Spec step | Implementation | Status |
|-----------|---------------|--------|
| Query AgentIndex by cell | `buildAgentIndex(workIntents, agents, locations, leafRes)` | ✓ aligned — now VF-native |
| Query EconomicResourceIndex | `observer.inventory()` / `availableQtyForSpec(observer, specId)` | ✓ equivalent |
| Query IndependentDemandIndex | `DemandSlot[]` pre-filtered by cell at call site | ✓ aligned |
| `instantiateRecipe()` | `buildRecipeGraph()` (pure, no writes) | ✓ improved: search-safe |
| Scenario hash | `computeScenarioId(commitmentSignatures)` djb2 | ✓ aligned |
| Merge guard: shared parent | `h3.cellToParent(origin_cell, res)` comparison | ✓ aligned |
| Merge: cross-cell Commitments | `transfer` Commitments with `satisfies` | ✓ aligned |
| No Agreement during search | Agreement intentionally absent | ✓ aligned |
| Pareto domination | `intents_satisfied ↑, total_effort_hours ↓` | ✓ aligned |
| Plan binding | `promoteToPlan` → `scenarioToPlan` | ✓ aligned |
| D-series priority ordering | `vfPlanFromNeeds` D1→D4→D5→D6→D3 | **extension** (not in spec) |
| SNLT-efficiency ordering | `snltPerUnit` sort in `buildVfFeasibleRecipes` | **extension** (not in spec) |
| D2 expansion signals | `Scenario.expansionSignals` | **extension** (not in spec) |
| Recursive intermediate demand | `selectFor(..., 'intermediate', depth+1)` | **extension** (not in spec) |

---

## What the spec does not cover (our additions)

1. **D-series priority** — The spec treats all demand uniformly. We classify
   every spec into D1/D4/D5/D6 via `resourceClassifiedAs` tags and process them
   in criticality order so Means of Production are planned before consumption needs.

2. **SNLT-efficiency ordering** — Recipes are sorted by `snltPerUnit` before
   selection. The spec only mentions `total_effort_hours` as a scoring axis; we
   apply the ordering during selection too, not just scoring.

3. **D2 expansion signals** — When `needed > feasible`, the gap is recorded on
   `Scenario.expansionSignals`. These surface capacity bottlenecks that need new
   Means of Production (D1 investment decisions).

4. **Recursive intermediate demand** — `selectFor` recurses when a recipe's
   material input has a deficit. The spec describes a single flat recipe call;
   we propagate the supply chain automatically.

5. **Insurance buffer (D3)** — After satisfying D1/D4/D5/D6, we add
   `insuranceFactor × total_quantity` as a safety buffer, processed as D3.
   The spec makes no mention of insurance.
