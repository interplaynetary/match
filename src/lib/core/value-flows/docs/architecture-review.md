# Planner Architecture Review

This document critically examines the current implementation against the design goals stated in
`workspace/new.md`. It is organized into three parts: structural misalignments, correctness gaps,
and elegance issues. Concrete suggestions follow each finding.

---

## Part 1 — Structural Misalignments with Design Goals

### 1.1 Two competing planning stacks

The codebase contains two separate planners:

| File                    | Approach                             | Status                                   |
| ----------------------- | ------------------------------------ | ---------------------------------------- |
| `plan-for-region.ts`    | Two-pass MRP (`planForRegion`)       | Active, 26 tests, correct                |
| `integrated-planner.ts` | Scenario/Pareto-front generator loop | Older approach, disconnected from Pass 2 |

`new.md` describes a single `planForRegion(cells, horizon, ctx, subStores?)` function. It does not
describe scenarios, Pareto fronts, or a generator loop.

`integrated-planner.ts` implements a fundamentally different model:

- It runs a forward feasibility pass (`buildVfFeasibleRecipes`) then a backward selection pass
  (`vfPlanFromNeeds`) within a single H3 leaf cell.
- It builds in-memory `Scenario` objects, scores them, and prunes a Pareto front.
- It never runs Pass 2 (derived replenishment demands). The metabolic sustainability loop is absent.
- Its "merge" is `mergeFrontier` over Scenario objects — structurally incompatible with
  `planForRegion`'s `PlanStore` merge.

**Impact:** `integrated-planner.ts` is a dead branch relative to `new.md`. It cannot satisfy the
metabolic sustainability constraint, and its Scenario/Pareto machinery adds ~400 lines of code that
is not used by `planForRegion`. The two planners cannot be composed.

**Suggestion:** Archive `integrated-planner.ts` into `docs/old/`. Its useful pieces — `buildVfFeasibleRecipes`
for pre-planning feasibility analysis and `promoteToPlan` as a promotion pattern — can be extracted
as small utilities if needed later. The Scenario/Pareto machinery belongs to a different optimization
paradigm and should not be maintained alongside the MRP planner.

**Status: Analysis complete** — see `docs/integrated-planner-analysis.md`. No immediate extractions
needed. `buildVfFeasibleRecipes` and `promoteToPlan` are candidates if use-cases arise. All D-series
demand bucketing and Scenario/Pareto machinery archived with the file.

---

### 1.3 Merge planner does not pass leaf unmetDemand and metabolicDebt as demand inputs

`new.md` states:

> _Merge Planner: Same planForRegion with subStores provided. Merges sub-PlanStores; runs Phase 3
> Formulate treating **leaf unmetDemand[] + metabolicDebt[] signals as new demand inputs**._

The current merge planner path (in `planForRegion` when `subStores` is provided) does not extract
`unmetDemand[]` or `metabolicDebt[]` from the sub-stores and re-inject them as demand slots. It
merges the PlanStores and runs conflict detection, but the leaf failures are lost.

The design intent is the local/global inversion: local failures become global inputs. A region that
could not source `spec:soil-nutrients` locally emits that as an upward signal; the merge planner
sees it, searches the union of cells, and may find a transport recipe or a production chain in a
neighboring region. Currently that signal evaporates.

**Suggestion:** `planForRegion` should accept an optional `leafSignals?: { unmetDemand: DemandSlot[], metabolicDebt: MetabolicDebt[] }[]`
parameter (extracted from leaf `RegionPlanResult`s by the caller), and treat those as additional
demand slots in Pass 1/Pass 2 with appropriate criticality (metabolicDebt at elevated priority).

---

### 1.4 Insurance/buffer demands are a stub

`RegionPlanContext.config.insuranceFactor` is described in a comment as "currently unused —
placeholder". `new.md` names Reserve/Buffer satisfaction as an explicit planning constraint:

> _Satisfy Reserve/Buffers demands (ranked by criticality)_

The integrated planner did implement an insurance pass (10% buffer over all primary selections),
but `planForRegion` omits it entirely. This means the metabolic sustainability loop handles
replenishment but not buffer stocks.

The distinction matters: replenishment restores what was consumed (net-zero metabolic position);
buffers provide a cushion against variance (positive reserve). Without buffers, the plan is
brittle — any execution shortfall creates immediate metabolic debt in the next cycle.

**Suggestion:** After Pass 2, compute buffer demands: for each spec tagged
`tag:plan:buffer-required`, if `onhandQuantity < minBuffer`, generate a derived demand for
`minBuffer - onhand`. Run this as a Pass 3 against the remaining netter capacity. The
`insuranceFactor` config then becomes a fallback multiplier when explicit min/max buffer ranges
are not defined on the spec.

---

### 1.5 SNE minimization is not tracked as an output objective

`new.md` states: **"Objective: Minimize Total Socially Necessary Effort (SNE)"**.

`RegionPlanResult` has no SNE total. The planner uses SNE (or SNLT) for **recipe ranking** within
`dependentDemand` — it prefers lower-SNE recipes — but the aggregate SNE of the resulting plan is
never computed and never returned. There is no way for a merge planner or a coordination body to
compare two plans on their SNE cost, or to know whether the plan satisfies the minimization
objective.

This is not just a display gap. Without an aggregate SNE, the merge planner cannot use SNE as a
criterion for which of two conflicting process subgraphs to retract.

**Suggestion:** Add `totalSNE?: number` to `RegionPlanResult`. Compute it in Phase 4 by summing
`effortQuantity` across all `work` intents and commitments in the planStore. This is the direct
labor component (SNLT). Full SNE (including embodied labor in inputs) requires the SNE index — add
`totalSNE` to `RegionPlanContext` optional fields and compute it when provided.

---

### 1.6 Mode-of-consumption classification is absent

`new.md`:

> _Plan re-classifies resources according to their mode-of-consumption `<communal | individual-claimable>`._

This is one of the more politically significant features — it determines which produced resources
flow into the commons and which into individual claim accounts. It is not modeled anywhere in the
current schemas or planners.

This is likely intentional deferral (it requires the capacity/claim equations section to be
implemented, which belongs to a different layer). But it should be noted: the current planner
produces a plan that is neutral on this question, which means all downstream distribution logic
would need to be bolted on later without guidance from the plan itself.

---

### 1.7 Max individual effort time constraint is absent

`new.md`: **"Constraint: Respect Max-Individual-Effort-Time/Day"**

Work intents are created with `effortQuantity` but there is no check that total planned effort for
an agent within a day/period stays within a bound. `ScheduleBook` handles time-slot conflicts for
`use` actions but not cumulative effort limits for `work`.

This matters practically: the planner may schedule an agent for 20 hours in a single day if
multiple processes require their skill. The plan would be formally infeasible to execute.

---

## Part 2 — Correctness Gaps

### 2.1 Phase 2 classification order may undermine locality goal

The demand sort order is:

```
class order (locally-satisfiable first) → criticality → due date
```

This means a locally-satisfiable `Support`-priority demand is planned **before** a
`MeansOfProduction`-priority demand that is a transport candidate. A piece of infrastructure that
needs to be moved gets deferred behind a locally-available nice-to-have.

`new.md` says priority is ranked by criticality only. The classification order (local vs. transport)
is an optimization heuristic that should be secondary to political priority, not override it.

**Suggestion:** Sort by `criticality → class order → due date`. Infrastructure planned first,
regardless of whether it needs transport. Classification helps within the same criticality tier.

---

### 2.2 `discoverInfrastructureSpecs` auto-discovery conflicts with explicit tagging

`integrated-planner.ts` auto-discovers infrastructure specs by structural analysis: any spec that
appears as a `use`/`cite` input in any recipe is classified as MeansOfProduction and gets a
reproduction need computed from inventory levels.

`new.md` and the current `plan-for-region.ts` use explicit tags (`tag:plan:MeansOfProduction`).

These two approaches are inconsistent. A spec could be a `use` input in a recipe (structurally
non-depleting) without being politically classified as MeansOfProduction — for example, a
reference document that is `cite`d during planning but is not productive infrastructure. Auto-
discovery would add it to infrastructure targets; the tag-based system would not.

Since `integrated-planner.ts` is being deprecated (per §1.1), this inconsistency goes away. But
it is worth noting that `discoverInfrastructureSpecs` should not be used as a substitute for
explicit tagging.

---

### 2.3 Backtracking only retries replenishment; it does not re-explode retracted primary demands

The backtracking loop retracts a Pass 1 process subgraph and then re-runs Pass 2 replenishment.
If that resolves the metabolicDebt, the retracted slot goes to `unmetDemand` and the loop stops.

But `new.md` says:

> _Re-explode retracted demands against newly freed capacity — their shortfall becomes
> `unmetDemand[]`. If metabolicDebt persists after exhausting all lower-priority retractable
> allocations, escalate to merge hierarchy._

"Re-explode" means: after retracting a support-tier demand, try to satisfy it again at the merge
level (where inter-region supply may be available). The current implementation simply discards it
into `unmetDemand` without attempting re-explosion. The distinction is significant: the retracted
demand may be satisfiable at a wider scope, just not locally.

---

### 2.4 Phase B runs against the same netter that served Pass 1

`dependentSupply` in Phase B uses the Pass 1 `netter`. This is Mode C — correct in principle.
But the backtracking in Phase 3 may have modified the planStore without rebuilding `netter`. After
a retraction, the `netter.allocated` set is manually pruned by checking which IDs still exist in
the planStore, but the `newNetter` built inside the backtracking loop is local and discarded after
the loop. Phase B continues with the original `netter`, which may contain stale allocated IDs
for records that were retracted.

**Suggestion:** After backtracking completes, rebuild the main `netter` from the post-backtracking
planStore state before entering Phase B.

**Status: Resolved** — `PlanNetter.pruneStale()` is called on the main `netter` after each
retraction, replacing the 10-line `newNetter`/`stillAllocated` block. Phase B receives the
correctly pruned netter.

---

### 2.5 `Pass 2 replenNetter` copies from `netter.allocated` but not from backtracking `newNetter`

When backtracking runs, it builds `retryReplenNetter` from `newNetter.allocated`. But `newNetter`
is rebuilt inside the loop from `stillAllocated` (flows still in planStore). If multiple retraction
iterations occur, each iteration builds a fresh `newNetter` but the outer `replenNetter` (which
was built once before backtracking) is never updated. Subsequent retry iterations may double-count
or miss allocations.

**Status: Resolved** — same fix as §2.4. `netter.pruneStale()` keeps the main netter consistent
across all backtracking iterations; `retryReplenNetter` is built from the already-pruned
`netter.allocated` at the start of each iteration.

---

## Part 3 — Elegance Issues

### 3.1 `planForRegion` is doing too much in one function

The function currently handles:

- Cell normalization
- Slot extraction and classification
- Pass 1 demand explosion
- Replenishment derivation
- Pass 2 replenishment
- Backtracking
- Phase B supply
- Conflict detection
- Surgical resolution

This is roughly 350 lines of interleaved state. Each phase is internally coherent but the phases
share mutable state (`netter`, `pass1Records`, `metabolicDebt`, `allPurchaseIntents`) in ways that
make it hard to reason about invariants.

`new.md` describes each phase cleanly. The implementation would be cleaner if each logical phase
were a named internal function:

```typescript
const canonical = normalizePhase(cells);
const slots = extractPhase(canonical, horizon, ctx);
const classified = classifyPhase(slots, canonical, ctx);
const pass1 = formulatePass1(classified, planStore, netter, ctx);
const derived = deriveReplenishment(pass1, ctx);
const pass2 = formulatePass2(derived, planStore, replenNetter, ctx);
const afterBT = backtrack(pass2, pass1, planStore, ctx);
const phaseB = supplyPhase(slots.supply, planStore, netter, ctx);
return collectPhase(planStore, pass1, afterBT, phaseB);
```

This makes the data flow explicit and each phase independently testable without setting up the
full orchestrator.

---

### 3.2 `SlotRecord` mixes concerns

`SlotRecord` holds a `DemandSlot`, the slot's `classifiedAs` tags, and the full
`DependentDemandResult`. This is fine for Pass 1 bookkeeping, but `classifiedAs` is derived
from `recipeStore.getResourceSpec(slot.spec_id)` at planning time — it is not intrinsic to the
slot. Storing it in the record means it can go stale if the spec is updated (though that does not
happen during a planning run). The tags should be looked up from the spec at retraction time, not
stored redundantly.

---

### 3.3 `detectConflicts` capacity contention is unimplemented

The `detectConflicts` function has a complete inventory-overclaim implementation, but the capacity
contention block is:

```typescript
// Only emit if there are multiple processes competing (not a real overclaim check
// without capacity data, but flagged for merge resolution)
// Skip — capacity contention requires AgentIndex; which isn't in ctx here.
// Left as extension point.
```

This means the merge planner can produce plans where multiple processes schedule the same agent
simultaneously with no conflict detected. The `AgentIndex` is not threaded into `RegionPlanContext`
(it is used inside the indexes but not available to the planner at merge time).

**Suggestion:** Add `agentIndex?: AgentIndex` to `RegionPlanContext`. If provided, check cumulative
work commitments per agent per period against `AgentCapacity.totalHours`. This closes the capacity
contention detection gap.

---

### 3.4 `synthethicSlot` in Pass 2 is structurally awkward

Pass 2 creates a `syntheticSlot` for each derived replenishment demand so it can be stored as a
`SlotRecord`. The synthetic slot has `intent_id: 'synthetic:${specId}'` — a fake ID that cannot
appear in the demand index, has no location, and has no real intent backing it.

This causes `unmetDemand` to potentially contain synthetic slots (if a replenishment demand
triggers backtracking in some edge case), which callers would have to filter or special-case.

A cleaner design: `pass2Records` should be a separate type `ReplenRecord` that does not pretend
to be a `DemandSlot`. The `MetabolicDebt` struct is already the right abstraction for "failed
replenishment" — there is no need for a synthetic slot wrapper.

---

---

## Design Decisions (not bugs)

### Criticality/priority system removed

The D-category ranking (`MeansOfProduction=0`, `Administration=1`, `Consumption=2`, `Support=3`)
was removed by design decision. Ordering planning by externally-assigned political classification
entangles the planner with categorisation decisions that belong to the community, not the algorithm.

The simplified sort order — class order (locally-satisfiable first) → due date ascending — is
sufficient for correct MRP behaviour and leaves priority questions to the demand-side (people
express priority via due dates). The `tag:plan:replenishment-required` tag is retained as it is
structural (not political), and retraction order is now purely latest-due-first.

---

## Summary

| Issue                                           | Severity | Root Cause                                                                                 |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Two competing planners                          | High     | `integrated-planner.ts` not retired when `plan-for-region.ts` became primary               |
| Retraction by BFS vs. provenance ID             | High     | `provenanceId` not stamped on records; new.md spec not followed                            |
| Leaf signals not routed upward                  | High     | Local/global inversion half-implemented; `unmetDemand`/`metabolicDebt` not passed to merge |
| Insurance/buffer absent                         | Medium   | `insuranceFactor` stubbed out                                                              |
| SNE not tracked as output                       | Medium   | Objective stated in new.md not computed                                                    |
| Sort order: class before criticality            | Medium   | Heuristic optimization overrides political priority                                        |
| Stale netter after backtracking in Phase B      | Medium   | Netter not rebuilt after backtracking loop                                                 |
| Capacity contention detection stub              | Medium   | `AgentIndex` not available in merge context                                                |
| `discoverInfrastructureSpecs` vs. explicit tags | Low      | Two mechanisms for the same thing                                                          |
| Pass 2 multi-iteration netter drift             | Low      | `retryReplenNetter` not updated across iterations                                          |
| Max effort time constraint                      | Low      | Not started                                                                                |
| Mode-of-consumption classification              | Low      | Deferred; different architectural layer                                                    |
| `syntheticSlot` in pass2Records                 | Low      | Code smell; cleaner with dedicated type                                                    |
| `planForRegion` monolith                        | Low      | Functional but hard to reason about; no wrong behavior                                     |

The core MRP engine (`dependentDemand`, `dependentSupply`, `PlanNetter`) is well-designed and
closely matches the spec. The `planForRegion` orchestrator is the right approach. The two highest-
priority fixes are retiring `integrated-planner.ts` and adding `provenanceId` stamps to replace
the fragile BFS retraction.
