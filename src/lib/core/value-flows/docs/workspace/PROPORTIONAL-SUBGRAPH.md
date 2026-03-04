# Proportional Subgraph Retraction

> A side exploration: extending binary retract-and-replan to continuous scaling of the
> demand tree. This is not part of the core spec — it is a design note for future work.

---

## Starting Point

REGIONAL-PLANNER.md (Surgical Resolution section) establishes that the retraction unit
is a **process subgraph** — not a single commitment. Every object created by a
`dependentDemand` call is tagged with a `provenanceId`; retraction removes all tagged
objects; re-explosion calls `dependentDemand` again with the same root inputs.

This is **binary**: full retraction, full re-explosion. The re-explosion may find an
alternative supply path, or it may fail and emit a purchase intent.

---

## The Proportional Extension

Instead of retracting the full subgraph and re-exploding at the original root quantity,
retract it and re-explode at a **scaled quantity** — specifically, the share of the
contested resource that is actually available to this demand.

The re-explosion naturally produces a consistent, lower-volume version of the same plan.

---

## Why the Demand Tree Scales Linearly

`dependentDemand` builds the process subgraph by multiplying recipe ratios from the root
quantity downward. If root demand = Q, every downstream process quantity is `Q × ratio`.
Changing Q to `α × Q` produces a consistent subgraph at `α × Q` throughout — no recipe
ratio changes, no structural changes, just lower numbers at every node.

This is exactly how `dependentSupply` works in the forward direction: scale the supply
quantity and all downstream product quantities scale with it. Proportional re-explosion
is simply `dependentDemand({ qty: α × Q, ... })` — no new algorithm needed.

---

## Priority-Weighted Share Allocation

When two demands compete for a contested resource, the allocation is:

```
available = 100 kg of spec S

Claim A: D1 priority, wants 60 kg
  → full allocation (priority wins first claim)
  → running total: 60 kg ≤ 100 kg

Claim B: D5 priority, wants 50 kg
  → remaining = 100 − 60 = 40 kg
  → share = 40 / 50 = 0.8
  → retract B's subgraph; re-explode at 0.8 × 50 = 40 kg
```

Claim B's entire process subgraph rebuilds at 80% scale. No alternative supply path is
required; the plan delivers 80% of the intended output.

The priority ordering is the same as the retraction-set ordering already described in
the Surgical Resolution section (D-category, then due date). The only change is what
happens after retraction: instead of seeking a substitute supply path, we scale the
quantity and re-explode into the same path.

---

## Viability Constraints — When Binary Is Still Needed

Proportional scaling fails silently when the scaled quantity violates a process
constraint. These cases require fall-back to binary retraction and full re-explosion
seeking an alternative supply path.

### Minimum batch size

A recipe step may have a `minQuantity` on its input spec. If `α × Q` falls below this
threshold, the process cannot run at all. Proportional scaling produces an invalid plan.

```
minBatch = recipeInput.minQuantity ?? 0
if (scaledQty < minBatch): fall back to binary
```

### Indivisible output goods

If the output spec requires integer units (10 chairs, not 8.3 chairs), round the scaled
quantity down and issue a **residual demand fragment** for the remainder:

```
scaledQty = Math.floor(α × Q)
residual  = (α × Q) - scaledQty   // fractional remainder
// emit purchase intent or unmet-demand signal for residual
```

### Threshold processes

Some processes yield zero output below a minimum input level — a fermentation batch
needs ≥ N liters to be viable, a kiln needs ≥ M kg to be worth firing. These processes
define a viability floor. Detect via a `minInput` field on the recipe step; fall back to
binary below it.

### Fixed-cost logistics

Transport cost is often the same for 30 kg or 50 kg (same truck, same trip). Proportional
scaling to 30 kg does not save the trip; it just delivers less. Binary allocation
preserves trip efficiency: deliver the full amount or nothing, and seek an alternative
supply path for the retracted demand.

---

## When Proportional Is Better

Proportional scaling is appropriate when the output is continuously divisible and every
unit produced is useful:

- Fungible bulk materials with no minimum batch: grain, steel coil, fuel, water
- Labor hours: any fractional hours is a valid commitment
- Divisible services and information goods: consulting hours, software licenses
- Intermediate process outputs that feed continuously into the next stage

The common thread: there is no threshold below which the output becomes worthless or
physically impossible. Every unit of `α × Q` is as useful as a unit of `Q`.

---

## VF Model Fit

`resourceQuantity.hasNumericalValue` and `effortQuantity.hasNumericalValue` are real
numbers in the Value Flows spec — fractional quantities are natively valid. No model
changes are required. The planner simply passes the scaled quantity to `dependentDemand`;
every downstream commitment and intent inherits the proportionally reduced quantity from
the recipe ratios.

---

## The Hybrid Decision

Check viability before choosing between proportional and binary:

```ts
const share = availableForThisDemand / originallyRequestedQty; // 0 < share ≤ 1
const scaledQty = share * originallyRequestedQty;

const minBatch = getMinBatch(rootSpec, recipeStore); // 0 if unconstrained
const outputIsDivisible = isDivisible(rootSpec);     // true for bulk/labor

if (scaledQty >= minBatch && outputIsDivisible) {
  // Proportional: re-explode at scaled quantity
  retractSubgraph(provenanceId, planStore, processes);
  dependentDemand({ qty: scaledQty, provenanceId: newId, ... });
} else {
  // Binary: full re-explosion seeking alternative supply
  retractSubgraph(provenanceId, planStore, processes);
  dependentDemand({ qty: originallyRequestedQty, provenanceId: newId, ... });
  // dependentDemand's fallback ladder will route around the contested resource
}
```

The two branches share the same retraction step. Only the `qty` argument differs.

---

## Partial Proportional — Keeping a Viable Core

A subtler variant: instead of scaling the entire demand tree uniformly, keep as much of
the original subgraph as the available resource allows and retract only the fraction that
exceeds availability.

```
original subgraph produces 100 units, requires 50 kg of S
only 30 kg available → can produce (30/50) × 100 = 60 units proportionally

Option A (uniform scale):   retract entire subgraph, re-explode at 60 units
Option B (partial retract): leave 60% of commitments in place, retract 40%
```

Option A is simpler and is what the hybrid decision above implements. Option B requires
splitting commitments, which the current PlanStore model does not support. Option A is
therefore the recommended approach; Option B is noted for completeness.

---

## Interaction with the Merge Planner

In the merge planner context (REGIONAL-PLANNER.md § Merge Planners and Conflict
Resolution), proportional allocation fits naturally at Step 4 (re-explosion):

```
t=3  retract C3's process subgraph (provenanceId=P3-root-demand)
     resolutionNetter sees: C1+C2 allocated; 10 kg steel-beam-42 still free

t=4  available = 10 kg; originally_requested = 50 kg; share = 0.2
     if 0.2 × 50 = 10 kg ≥ minBatch and spec is divisible:
       re-explode at 10 kg (proportional)
       Plan-P3 now produces 20% of intended output using available steel
     else:
       re-explode at 50 kg (binary, seeks transport or purchase intent)
```

This is a local decision per retracted subgraph — different demands in the same conflict
resolution pass can independently choose proportional or binary based on their own
viability constraints.

---

## Academic Connections

**Kelly's proportional fairness** — network resource allocation theory; bandwidth shares
proportional to weight. Proportional subgraph retraction is the discrete-goods analogue.

**Weighted Fair Queuing (WFQ)** — packet scheduling with proportional bandwidth shares by
flow priority. The D-category priority ordering combined with proportional shares is
directly analogous.

**Linear programming / min-cost flow** — global optimality at O(n³) cost. Proportional
scaling is a fast greedy heuristic that approximates the LP solution in cases where the
demand tree structure is fixed and resources are the only variable.

**MRP II pegging** — linking specific demand records to the supply records that serve
them. Provenance tagging is the graph-based MRP equivalent; proportional retraction is
pegging-aware partial satisfaction.

**Robust / fuzzy planning** — representing plans as quantity ranges rather than point
estimates. A proportionally scaled plan at `α × Q` is exactly a point within the range
`[0, Q]`; the hybrid decision defines which points in that range are viable.

---

## Summary

| Dimension | Binary retract | Proportional retract |
|---|---|---|
| Re-explosion quantity | Original Q | Scaled α × Q |
| Supply path | Algorithm seeks alternative | Same path at lower volume |
| Viability check | Not needed | Required (minBatch, divisibility) |
| Output delivered | 0% or 100% of intent | α% of intent |
| Implementation | Already in place | Scale qty arg to dependentDemand |
| Best for | Discrete goods, fixed-cost logistics | Fungible bulk, labor, divisible services |

The proportional extension requires no new algorithm — only a scaled `qty` argument and
a viability check before choosing which mode to use.
