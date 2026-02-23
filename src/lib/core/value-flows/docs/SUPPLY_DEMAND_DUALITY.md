# Supply/Demand Duality in VF Planning

> Analysis of `dependent-supply` as the algorithmic dual of `dependent-demand`,
> and how together they could implement the full planning surface described in
> `plan.md §"Planning from recipe"`.

---

## 1. Is it actually the dual?

### Structural mirror

| Dimension | `dependent-demand` | `dependent-supply` |
|---|---|---|
| Queue item | `{ specId, quantity, neededBy }` | `{ specId, quantity, availableFrom }` |
| Recipe lookup | `recipesForOutput(specId)` | `recipesForInput(specId)` |
| Temporal direction | back-schedule from `neededBy` | forward-schedule from `availableFrom` |
| BFS expansion | inputs of the recipe → new demand tasks | outputs of the recipe → new supply tasks |
| "Leaf" condition | no recipe → `purchaseIntent` | no recipe AND `!isDerived` → `surplus`; derived → terminal product |
| Ranking criterion | SNLT ascending (same formula) | SNLT ascending (same formula) |
| Scale mode | **continuous**: `remaining / recipe_output_qty` | **discrete**: `floor(remaining / input_qty_per_exec)` |

The BFS structure, SNLT ranking, `createFlowRecord`, `rpDurationMs`, and durable-input handling are identical in shape.

### Real asymmetries

**A. Continuous vs. discrete scaling**

Demand can request 5.3 kg of yarn — the algorithm scales recipe flows by a real-valued factor. Supply is inherently integer: "I have 7 kg of wool, the recipe needs 3 kg/run → 2 runs, 1 kg surplus." The discrete `floor()` is not a simplification; it reflects a real physical constraint (you cannot run half a shearing).

A demand explosion CAN produce fractional process durations (which is a problem for real scheduling); a supply explosion cannot, but it can leave fractional surplus. These are dual problems with no symmetric solution.

**B. Netting scope**

`dependent-demand` nets against BOTH observer inventory AND previously scheduled outputs already in `planStore` (soft-allocated Intents/Commitments with `outputOf` set). This handles WIP: "we're already making 3 of the 5 needed, so only schedule 2 more."

`dependent-supply` only checks observer inventory via `computeMaxByOtherMaterials`. It does **not** net against previously scheduled consumptions (Commitments with `inputOf` set). This is a gap: if another plan is already consuming the same supply, `dependent-supply` doesn't know.

The symmetric fix would be a `computeAlreadyConsumed()` helper — analogous to the demand side's scheduled-output netting — that scans `planStore.allCommitments()` for `inputOf` flows of the given spec and subtracts them from available quantity.

**C. Terminal-product semantics**

In demand: a spec with no recipe is always a gap — something that must be bought. `purchaseIntents` is the only signal.

In supply: a spec produced by a process but consumed by no further recipe is a **desired output** (garments at the end of the textile chain). The `isDerived` flag distinguishes this from "original supply nobody wants." There is no analog in demand because the demand side always has a goal (the top-level spec) and every leaf is a means to that goal.

This asymmetry is fundamental: supply planning has a built-in notion of "good enough, we made the thing." Demand planning has a built-in notion of "not enough, we need to source more."

---

## 2. The three forward-scheduling cases from `plan.md`

`plan.md §"Planning from recipe"` defines three planning entry points. Currently only (1) is fully implemented standalone.

### (1) Back-scheduling from a Resource Specification (demand explosion)

```
recipesForOutput(specId) → back-schedule → inputs become sub-demands
```

**Implemented**: `dependent-demand.ts`. Standalone, tested, plan.md compliant.

### (2) Forward-scheduling from a Resource Specification or Recipe

> "Start with the inputs with no predecessors and a start date, generate the plan from the inputs to their outputs, to the inputs that want the outputs, etc."

**Implemented**: `dependent-supply.ts`. The entry `(specId, availableQuantity, availableFrom)` maps exactly to this description. The BFS walks forward through all recipes that can absorb the spec, then follows their outputs onward.

### (3) Forward-scheduling from a Resource

> "Start with an Economic Resource, and generate the plan based on the recipe of its Resource Specification."
> Examples: Translation (start with source document), Auto repair (start with the car).

**Not yet implemented as a separate entry point**, but `dependent-supply` is 90% of the way there:

```typescript
// Hypothetical entry:
function dependentSupplyFromResource(
    resource: EconomicResource,
    recipeStore: RecipeStore,
    ...rest
): DependentSupplyResult {
    return dependentSupply({
        supplySpecId: resource.conformsTo!,
        supplyQuantity: resource.accountingQuantity?.hasNumericalValue ?? 1,
        availableFrom: new Date(),
        ...rest,
    });
}
```

The only missing piece: the auto-repair case might want to pass the `resource.id` through to the plan so that the specific resource is pinned to the input flow (not just "any conforming resource"). Currently `createFlowRecord` uses only the spec, not the specific instance. A `resourceInventoriedAs` field on the generated Commitment would close the gap.

---

## 3. The textile supply-demand scenario from `plan.md`

`plan.md §"Thinking about supply and demand"` describes three modes for the textile chain:

```
wool → [scouring] → scoured wool → [carding] → roving → [spinning] → yarn → [weaving] → fabric → [cutting/sewing] → garments
```

**Mode A: Pure demand-driven** — "how many garments this season?" → `dependent-demand(spec:garments, N, dueDate)`

**Mode B: Pure supply-driven** — "what wool do the farms produce?" → `dependent-supply(spec:wool, X, harvestDate)`

**Mode C (bottom of diagram): Mixed** — demand-driven baseline, then opportunistic supply top-up:
> "When they see they can get extra sheep wool from the farms, they decide to purchase as much as they can... send it through scouring because saving greasy wool is not so pleasant."

Mode C is currently **not directly expressible** as a single algorithm call. It requires:

1. Run `dependent-demand(spec:garments, N, dueDate)` → produces plan with purchaseIntents for wool.
2. Observe that extra wool is available (observer or separate offer).
3. Run `dependent-supply(spec:wool, extraQty, now)` → produces scouring processes only (because the plan already has downstream weaving scheduled).
4. Merge the two plans.

This merge step is the missing piece. The demand side would need scheduled-output netting from the supply plan, and the supply side would need scheduled-consumption netting from the demand plan.

---

## 4. Could `dependent-supply` replace `buildVfFeasibleRecipes()`?

`buildVfFeasibleRecipes()` in `integrated-planner.ts` currently:
- Scans all recipes in RecipeStore
- For each recipe, queries Observer for each input
- Computes `maxBatches = min(available_input / required_input)` per recipe
- Returns a feasibility table (not an actual plan)

`dependent-supply` does the same computation but:
- Starts from a **specific spec**, not all recipes
- Chains downstream automatically (BFS)
- **Produces an actual plan** (processes, Intents, Commitments) not just a feasibility number
- Handles SNLT ranking, durable inputs, complementary-input purchase intents

So yes — for the D-series forward pass, `buildVfFeasibleRecipes()` could be replaced by calling `dependent-supply` for each spec that has available inventory. The feasibility scan becomes an actual plan construction, and the "recipe is feasible" signal becomes "the plan has no surplus and empty purchaseIntents."

Sketch:

```typescript
// In integrated-planner.ts, replace buildVfFeasibleRecipes() with:
for (const spec of observer.allResourceSpecs()) {
    const available = observer.conformingResources(spec.id)
        .reduce((sum, r) => sum + (r.accountingQuantity?.hasNumericalValue ?? 0), 0);
    if (available <= 0) continue;

    const result = dependentSupply({
        planId,
        supplySpecId: spec.id,
        supplyQuantity: available,
        availableFrom: planStart,
        recipeStore,
        planStore,
        processes,
        observer,
    });

    // surplus[] → report as unconvertible inventory
    // purchaseIntents[] → report as missing complements
    // absorbed[] → confirm feasible production
}
```

The primary advantage: the D-series pipeline currently separates "is this feasible?" (buildVfFeasibleRecipes) from "generate the plan" (vfPlanFromNeeds). With `dependent-supply`, the feasibility check IS the plan generation — one pass instead of two.

---

## 5. Meet-in-the-middle planning

`plan.md §"Thinking about supply and demand"`: "Longer flows can be supply-driven, demand-driven, or both, meeting somewhere in the middle."

This is the most sophisticated use pattern. Neither algorithm alone can implement it, but together they can:

```
Demand side: dependent-demand(spec:garments, N, deadline)
             → produces back-scheduled processes
             → purchaseIntents for specs it can't make (e.g., spec:yarn)

Supply side: dependent-supply(spec:wool, X, harvestDate)
             → produces forward-scheduled processes
             → output spec:yarn at some date T

Meeting point: the demand side needs spec:yarn by T_demand;
               the supply side produces spec:yarn at T_supply.
               If T_supply ≤ T_demand → compatible, merge plans.
               If T_supply > T_demand → gap, need either earlier supply or later demand.
```

The algorithms as written don't produce a meeting-point signal. But the data to detect it is all there:
- `dependent-demand.purchaseIntents` lists what spec is needed and by when (`due` field)
- `dependent-supply` produces Intents/Commitments with `outputOf` + `due` for each output

A `meetInMiddle(demandResult, supplyResult)` function could scan for matching `(resourceConformsTo, due)` pairs and link them.

---

## 6. Summary: what's missing for full plan.md coverage

| Gap | What's needed |
|---|---|
| Forward-from-Resource entry point | `dependentSupplyFromResource(resource, ...)` thin wrapper + `resourceInventoriedAs` on pinned flows |
| Supply-side netting of planned consumption | `computeAlreadyConsumed()` scanning `planStore.allCommitments()` with `inputOf` |
| Mixed mode (plan.md Mode C) | Two-phase: run both algorithms, merge via scheduled-output / scheduled-consumption netting |
| Meet-in-the-middle | `meetInMiddle(demandResult, supplyResult)` linker on matching (spec, due) pairs |
| Replace buildVfFeasibleRecipes() | Loop over observer inventory → call dependentSupply per spec → feasibility IS plan generation |
