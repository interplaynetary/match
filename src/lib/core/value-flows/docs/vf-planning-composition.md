# VF Planning Composition & Spatio-Temporal Netting

## Overview

This document explains how to compose a complete production plan using the three planning
primitives, what the spatio-temporal netting guards enforce, and — critically — where
**transport** sits in this model, why it is a special case, and what would be needed to
make it a first-class citizen.

---

## 1. The Three Planning Primitives

### 1.1 `dependentDemand` — backward explosion

Start from a desired output and walk backwards through recipes.

```
need: yarn @ FactoryB, qty 50kg, by 2026-03-01
  → weave recipe → need: cotton @ FactoryB, qty 60kg, by 2026-02-28
    → gin recipe → need: raw cotton @ FarmA, qty 120kg, by 2026-02-26
```

Each step produces **Intents** (or **Commitments** when both agents are known) in the
`PlanStore`. Sub-demands are pushed onto a BFS queue; the loop terminates when inventory
or a purchase intent covers each leaf.

### 1.2 `dependentSupply` — forward explosion

Start from an available resource and walk forward through recipes that consume it.

````
have: raw cotton @ FarmA, qty 120kg, available 2026-02-01
  → gin recipe → produces cotton @ FarmA, qty 60kg, available 2026-02-03
    → no weave recipe registered for FarmA context
    → cotton becomes terminal product (not surplus) at FarmA
```dependentSupply` — forward explosion

Start from an available resource and walk forward through recipes that consume it.

````

have: raw cotton @ FarmA, qty 120kg, available 2026-02-01
→ gin recipe → produces cotton @ FarmA, qty 60kg, available 2026-02-03
→ no weave recipe registered for FarmA context
→ cotton becomes terminal product (not surplus) at FarmA

````

Outputs that no recipe absorbs become **terminal products** (if derived from a chain) or
**surplus** (if the original supply goes unused). Complementary inputs missing from
inventory become **purchase intents**.

### 1.3 `PlanNetter` — shared netting state

The netter accumulates a `Set<string>` of soft-allocated intent/commitment IDs so the
same flow is never double-counted across multiple algorithm calls.

Three methods:
| Method | Mutates `allocated`? | Purpose |
|--------|----------------------|---------|
| `netDemand(specId, qty, opts)` | yes | absorb inventory + output intents against a demand |
| `netSupply(specId, qty, availableFrom, atLocation)` | yes | deduct pre-claimed consumptions from available supply |
| `netAvailableQty(specId, opts)` | no | read-only ceiling check (used by `computeMaxByOtherMaterials`) |

---

## 2. Composing a Plan: the Three Modes

### Mode A — demand only

```ts
const netter = new PlanNetter(planStore, observer);
dependentDemand({ planId, demandSpecId, demandQuantity, dueDate, ..., netter });
````

Use when you have a known required output and want to find what must be produced/purchased.
The plan will contain:

- Processes back-scheduled to meet the due date.
- Purchase intents for any leaf spec with no recipe.

### Mode B — supply only

```ts
const netter = new PlanNetter(planStore, observer);
dependentSupply({ planId, supplySpecId, supplyQuantity, availableFrom, ..., netter });
```

Use when you have a known available resource and want to route it forward into production.
The plan will contain:

- Processes forward-scheduled from `availableFrom`.
- Surplus for supply that nothing can absorb.
- Purchase intents for complementary inputs.

### Mode C — demand then supply (full netting)

The demand explosion runs first and books **consumption intents** into the plan.
The supply explosion then runs with the **same netter**, so `netSupply` sees those
pre-claimed consumptions and deducts them from available supply before routing into
recipes.

```ts
const netter = new PlanNetter(planStore, observer);

// Step 1: demand side
dependentDemand({ planId, demandSpecId, ..., netter });

// Step 2: supply side — netter is shared, so absorbed demand flows
// are NOT double-absorbed by the supply algorithm
dependentSupply({ planId, supplySpecId, ..., netter });
```

This is the canonical way to reconcile "what do we need?" with "what do we have?"
in a single consistent plan.

---

## 3. Spatio-Temporal Netting Guards

### 3.1 Temporal guards

Every netting call respects `due` dates on intents/commitments:

- `netDemand` opts `neededBy`: output intents whose `due` is **after** `neededBy` are
  skipped — the supply won't be ready in time.
- `netSupply` arg `availableFrom`: consumption intents whose `due` is **before**
  `availableFrom` are skipped — the supply doesn't exist yet when the consumption fires.
- `netAvailableQty` opts `asOf`: only counts outputs due by `asOf`; only deducts
  consumptions due by `asOf`.

Missing `due` on an intent → no temporal filter (conservative: assume it's available).

### 3.2 Spatial guards

Every netting call now respects `atLocation` (SpatialThing ID):

- **Inventory**: a resource at `loc:FarmA` is NOT absorbed by a demand at `loc:FactoryB`.
- **Output intents**: an intent with `atLocation: 'loc:FarmA'` is NOT absorbed by
  `netDemand` with `atLocation: 'loc:FactoryB'`.
- **Consumption intents**: an intent with `atLocation: 'loc:FactoryB'` is NOT deducted
  by `netSupply` with `atLocation: 'loc:FarmA'`.

Missing `atLocation` on either side → **no spatial filter** (conservative: assume the
resource is globally available / the consumption is location-agnostic).

### 3.3 Why exact match is the right default

Anything weaker — e.g. "absorb if within 50km" — would require geodesic computation and
domain knowledge about delivery feasibility. Exact match is:

- Decidable with string equality.
- Symmetric with VF's own `atLocation` semantics.
- Safe: it under-absorbs rather than over-absorbs (the plan will produce a purchase intent
  for the missing supply rather than silently claiming it from the wrong place).

The missing absorption becomes a signal: "you need supply at this location" — exactly what
a **transport recipe** should satisfy (see §4).

### 3.4 The trajectory index

Because every intent/commitment produced by the algorithms carries the task's `atLocation`,
the `PlanStore`'s intent list is itself a **spatio-temporal trajectory index**:

```
netAvailableQty('spec:yarn', { asOf: T, atLocation: 'loc:FactoryB' })
```

…scans all unallocated output intents that conform to `spec:yarn`, are at `loc:FactoryB`,
and are due by `T`. This is the projected supply at a specific place and time — no
separate index is required.

---

## 4. Transport: The Special Case

### 4.1 The problem

After demand explosion for `yarn @ FactoryB`:

- No local inventory at FactoryB.
- No output intents at FactoryB (no weaving process scheduled yet).
- `netDemand` returns `remaining = demandQuantity` (nothing absorbed).
- Recipe lookup: find a recipe whose primary output is `spec:yarn`.
- A weaving recipe exists → a weave process is scheduled at FactoryB.
- Sub-demand: `cotton @ FactoryB qty N` (weave input).
- No cotton at FactoryB, no recipe produces cotton at FactoryB.
- Result: **purchase intent** `transfer cotton to FactoryB qty N`.

Meanwhile, the supply explosion for `raw cotton @ FarmA`:

- Gin recipe → produces `cotton @ FarmA qty M`.
- `netSupply` checks: is there a consumption intent for `cotton` at `loc:FarmA`?
- The only cotton consumption intent has `atLocation: 'loc:FactoryB'` (from weave at FactoryB).
- **Location mismatch → NOT absorbed**.
- Cotton at FarmA becomes a terminal product (or surplus) — the plan has no way to use it.

Both plans are internally consistent but **disconnected across space**. The only bridge is
a transport operation.

### 4.2 Transport in VF

The VF spec models transport as a normal **process** with location-changing events:

```
Process: "Truck FarmA → FactoryB"
  Input:  pickup  cotton qty N  atLocation: loc:FarmA
  Output: dropoff cotton qty N  atLocation: loc:FactoryB
  Duration: 2 days
```

The `pickup` action decrements the provider's custody at the origin; `dropoff` increments
the receiver's custody at the destination. The resource's `currentLocation` changes from
FarmA to FactoryB.

This is semantically identical to a manufacturing process: it consumes a resource at one
location and produces it (changed in some way — namely its location) at another.

### 4.3 Why transport can't be a recipe today

`RecipeFlow` in `schemas.ts` currently has no `atLocation` field. A recipe process is
location-agnostic — the location is stamped on the planned intent/commitment when the
algorithm runs, inherited from the demand/supply task's `atLocation`.

A transport recipe needs **two different locations**: one for the input pickup and one for
the output dropoff. Without `atLocation` on `RecipeFlow`, the planner has no way to
express "this input happens at origin, this output happens at destination."

### 4.4 What would be required

**Schema extension**: add `atLocation?: string` and `toLocation?: string` to `RecipeFlow`:

```ts
interface RecipeFlow {
  // ... existing fields ...
  atLocation?: string; // where this flow happens (pickup location for input)
  toLocation?: string; // destination for flows that move resources
}
```

**Recipe definition**:

```ts
// Transport recipe: cotton from FarmA to FactoryB
recipeStore.addRecipeFlow({
  action: "pickup",
  resourceConformsTo: "spec:cotton",
  resourceQuantity: { hasNumericalValue: 1, hasUnit: "kg" },
  atLocation: "loc:FarmA", // pickup happens at FarmA
  inputOf: "rp:truck-transport",
});
recipeStore.addRecipeFlow({
  action: "dropoff",
  resourceConformsTo: "spec:cotton",
  resourceQuantity: { hasNumericalValue: 1, hasUnit: "kg" },
  toLocation: "loc:FactoryB", // dropoff deposits at FactoryB
  outputOf: "rp:truck-transport",
});
```

**Algorithm change**: `createFlowRecord` reads `flow.atLocation` (if set) instead of
inheriting `task.atLocation`. This lets transport flows override the ambient location.

**Recipe lookup**: `recipesForOutput(specId)` must be extended or supplemented with
`recipesForOutputAt(specId, atLocation)` so the planner can find a transport recipe that
delivers `spec:cotton` to `loc:FactoryB` specifically.

### 4.5 The corrected demand explosion with transport

With transport as a recipe, the demand explosion for `yarn @ FactoryB` would proceed:

```
need: yarn @ FactoryB, qty 50kg
  → weave recipe (at FactoryB) → need: cotton @ FactoryB, qty 60kg
    → transport recipe (FarmA→FactoryB) → need: cotton @ FarmA, qty 60kg
      → gin recipe (at FarmA) → need: raw cotton @ FarmA, qty 120kg
        → inventory check @ FarmA → found 120kg → absorbed ✓
```

The result:

1. A gin process at FarmA (forward in time).
2. A transport process FarmA→FactoryB (duration = transit time).
3. A weave process at FactoryB (after transport arrives).
4. All flows location-stamped: gin flows @FarmA, transport input @FarmA, transport output @FactoryB, weave flows @FactoryB.

**Mode C** would then correctly reconcile: `netSupply` for cotton at FarmA sees the
transport's consumption intent ALSO at FarmA — location matches — and absorbs it.

---

## 5. Summary Table

| Concern                   | Current behaviour                             | With transport recipes          |
| ------------------------- | --------------------------------------------- | ------------------------------- |
| `netDemand` spatial guard | exact match or skip                           | unchanged                       |
| `netSupply` spatial guard | exact match or skip                           | unchanged                       |
| Cross-location absorption | impossible (correct)                          | bridged by transport recipe     |
| Transport modelling       | manual purchase intent                        | recipe-driven process chain     |
| `RecipeFlow.atLocation`   | not present                                   | needed (schema extension)       |
| `recipesForOutputAt()`    | not present                                   | needed (recipe store extension) |
| Trajectory index          | `netAvailableQty(spec, { atLocation, asOf })` | same                            |

---

## 6. Design Principle

> **Exact location match is right.** The netting layer should never invent implicit
> transport. A demand at FactoryB that cannot be satisfied locally surfaces as a purchase
> intent — which is the correct signal that something must be sourced. Transport is the
> recipe that converts "cotton @FarmA" into "cotton @FactoryB". Modelling it as a recipe
> keeps the planner uniform: every gap is closed by either inventory, a scheduled output,
> or a recipe — transport is just a recipe whose output changes location instead of form.
