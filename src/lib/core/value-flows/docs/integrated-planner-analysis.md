# Integrated Planner — Piece-by-Piece Analysis

This document analyses each reusable piece of `integrated-planner.ts` before archiving the file.
The goal is to identify what (if anything) is worth extracting as a standalone utility.

---

## Piece Analysis

| Piece | Keep? | Rationale |
|---|---|---|
| `buildVfFeasibleRecipes()` | Maybe | Computes feasibility envelopes (maxByMaterial, maxByLabor, snltPerUnit) per recipe. Useful as a pre-planning capacity report. However, `dependentDemand` already ranks recipes by SNLT/SNE internally, so the information is consumed at explosion time. Not used by `planForRegion`. Extract if a capacity-report use-case arises. |
| `discoverInfrastructureSpecs()` | Potentially | Walks every recipe and collects non-depleting (use/cite) input specs — structurally identified Means of Production. Could feed replenishment targeting without requiring explicit tags. However, it conflicts with the tag-based approach (`tag:plan:MeansOfProduction`) used by `planForRegion` — a `cite`d reference document is not necessarily productive infrastructure. Since `planForRegion` uses explicit tags, auto-discovery would produce false positives. Do not extract. |
| `computeInfrastructureTargets()` | No | Depends on `discoverInfrastructureSpecs` (which we're not extracting) and the priority ordering being removed. Not applicable. |
| `planningPriority()` / demand bucketing | No | Removed with the criticality system by design decision. The D-category ranking (MeansOfProduction=0 … Support=3) entangles planning order with external political classification. Sorting by due date alone is simpler and sufficient. |
| `vfPlanFromNeeds()` | No | A top-down "what can I produce" backward pass within a single leaf cell. `dependentDemand` (bottom-up BFS) already covers this direction more correctly, with full netter integration, transport support, use/cite scheduling, and SNE ranking. `vfPlanFromNeeds` adds complexity (mutable `remaining` inventory map, no netter, no location propagation) without adding capability. |
| `Scenario` / Pareto machinery | No | A different optimization paradigm: score, hash, and merge Scenario objects across an H3 hierarchy. Structurally incompatible with the `PlanStore` merge approach. The `space-time-scenario.ts` module encapsulates this; it is self-contained and can remain archived alongside `integrated-planner.ts`. |
| `promoteToPlan()` | Maybe | Pattern for making in-memory planning results permanent: register Processes, Commitments, then call `scenarioToPlan()`. The underlying idea — a function that stamps `plannedWithin` on all records and returns a `Plan` — could be a useful utility. Not needed now (no Scenario path remains). Extract if the Scenario paradigm is ever revived. |
| `generateLeafScenario()` / `runPlanningSearch()` | No | Entry points into the Scenario machinery. No remaining callers. |
| SNLT-based recipe ranking | Already done | `dependentDemand` already uses SNLT (direct labour) and optional SNE (embodied labour) for recipe selection. No extraction needed. |
| `buildAgentIndex` / `AgentIndex` usage | Already extracted | `indexes/agents.ts` is the canonical module. `integrated-planner.ts` imported from it; no duplication. |
| `isDepletingAction()` helper | Duplicated | The same check exists in `integrated-planner.ts` and is also done inline in `dependent-demand.ts` via `ACTION_DEFINITIONS`. If a shared utility is needed, it belongs in `schemas.ts` or a new `utils/actions.ts`. Not worth extracting just for this file. |

---

## Conclusion

**Archive the following:**
- The Scenario/Pareto machinery (`generateLeafScenario`, `runPlanningSearch`, `Scenario`, `ScenarioIndex`)
- The D-series demand bucketing (`planningPriority`, `TAG_*` constants, `adminDemands` / `consumptionDemands` / `supportDemands`)
- `vfPlanFromNeeds` — superseded by `dependentDemand`
- `computeInfrastructureTargets` / `discoverInfrastructureSpecs` — conflicts with explicit-tag approach

**Candidates for future extraction (no immediate action):**
- `buildVfFeasibleRecipes` — pre-planning capacity envelope; useful if a reporting layer is added
- `promoteToPlan` — promotion pattern; useful if Scenario path is revived

**No immediate extractions are needed.** The active planning stack (`planForRegion` + `dependentDemand` + `dependentSupply` + `PlanNetter`) is complete. `integrated-planner.ts` can be safely archived.
