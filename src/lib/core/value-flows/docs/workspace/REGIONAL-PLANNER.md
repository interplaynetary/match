# Regional Planner

> How `IndependentDemandIndex` and `IndependentSupplyIndex` constrain the planning space,
> and how a region-scoped orchestrator would drive `dependent-demand`, `dependent-supply`,
> and `PlanStore` to formulate real operational plans.

---

## The Core Idea

The planner receives a **set of H3 hexagons** — at any mix of resolutions — and attempts to
formulate Plans that match supply to demand within that geographic region. The two planning
indexes act as the scope gate: they tell the planner _what exists and where_, before any
allocations are made. The algorithms then do the actual planning within that constrained
space.

```
Region (H3 cells)
      │
      ▼
IndependentDemandIndex ──► "what demand exists here?"
IndependentSupplyIndex ──► "what supply exists here?"
      │
      ▼
  Classify + Prioritize
      │
      ├── locally satisfiable → dependent-demand (Mode A/C)
      ├── transport candidate → dependent-demand with transport recipe
      └── external dependency → purchase Intent (no local plan)
      │
      ▼
 PlanStore ◄── Plans / Processes / Intents / Commitments
```

### PlanStore is region-scoped

Each planning invocation owns its own `PlanStore`, corresponding to the region it was
asked to plan. The store is sparse — it holds only the Plans committed by that invocation;
most supply/demand lives in Observer inventory and the index snapshots.

There is no global PlanStore. Coordination between planners happens by creating a
**higher-order planner** for the region that spans both:

```
Leaf planners (fully parallel, zero coordination):

  planForRegion(A) ──► PlanStore-A
  planForRegion(B) ──► PlanStore-B
  planForRegion(C) ──► PlanStore-C

Higher-order planner (triggered when a region spans existing ones):

  planForRegion(A∪B, subStores=[PlanStore-A, PlanStore-B])
    → merge PlanStore-A + PlanStore-B into PlanStore-AB
    → detect conflicts within PlanStore-AB
    → resolve surgically (same algorithm, higher-order scope)
    → PlanStore-AB (coherent for region A∪B)
```

The higher-order planner is not a special pass — it is the same `planForRegion` function
receiving sub-PlanStores to merge from. A leaf planner receives none. The algorithm is
identical; only the starting state of the PlanStore differs.

This structure is recursive. If two higher-order planners' regions overlap, a planner for
their union resolves that level — and so on up. In practice the hierarchy is shallow: most
conflicts are between adjacent leaf regions and resolve in one merge step.

---

## Phase 0: Region Normalization (H3 Deduplication)

The input cell set may be dirty — a mix of coarse cells (res 4, city-scale) and fine cells
(res 7, neighborhood-scale), some of which are parent/child of each other. Because
`HexIndex` stores item IDs at **all ancestor levels**, querying both a parent and a child
that covers the same point would return the same demand/supply slot twice.

**Normalization rule**: A cell is _dominated_ if any of its H3 ancestors also appears in
the input set. Remove all dominated cells. The result is a non-overlapping canonical cover
of the target region — every point falls under exactly one canonical cell.

```ts
function normalize(cells: string[]): string[] {
  const cellSet = new Set(cells);
  return cells.filter((cell) => {
    const res = h3.getResolution(cell);
    for (let r = res - 1; r >= 0; r--) {
      if (cellSet.has(h3.cellToParent(cell, r))) return false; // dominated
    }
    return true;
  });
}
```

The cost is O(cells × 15) — 15 is the maximum number of H3 resolutions. Negligible.

After normalization: querying `queryDemandByHex(index, cell)` for each canonical cell
returns a `HexNode` whose `items` contains ALL demand intent IDs at that cell AND all
finer sub-cells within it. The union across canonical cells is the complete regional
demand set. A `seen: Set<string>` at the query loop level handles any edge-case overlap
defensively.

---

## Phase 1: Regional Demand and Supply Extraction

```ts
function queryDemandByRegion(
  index: IndependentDemandIndex,
  canonicalCells: string[],
  opts?: { horizon?: { from: Date; to: Date } },
): DemandSlot[] {
  const seen = new Set<string>();
  const result: DemandSlot[] = [];

  for (const cell of canonicalCells) {
    const node = queryDemandByHex(index, cell);
    if (!node) continue;
    for (const intentId of node.items) {
      if (seen.has(intentId)) continue;
      seen.add(intentId);
      const slot = index.demands.get(intentId);
      if (!slot) continue;
      if (opts?.horizon && slot.due) {
        const due = new Date(slot.due);
        if (opts.horizon.from && due < opts.horizon.from) continue;
        if (opts.horizon.to && due > opts.horizon.to) continue;
      }
      result.push(slot);
    }
  }

  return result;
}
```

The same pattern applies to `querySupplyByRegion(supplyIndex, canonicalCells)`.

### What these sets tell you before planning begins

| Regional demand                                                 | Regional supply                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `slot.remaining_quantity` — how much of each spec still needed  | `slot.quantity` — on-hand inventory in region                |
| `slot.fulfilled_quantity` — how much has already been committed | `slot.hours` — labor capacity available                      |
| `slot.due` — when each demand is needed                         | `slot.available_from` — when scheduled receipts arrive       |
| `slot.spec_id` — what type of resource is needed                | `slot.slot_type` — whether it's inventory, receipt, or labor |
| `slot.h3_cell` — where the demand is located                    | `slot.h3_cell` — where the supply is located                 |

This view is a **pre-planning snapshot** — correct as of index-build time, before any
soft-allocation runs. It answers feasibility questions without touching `PlanStore`:

- "Does any supply of spec X exist within this region?"
- "What is the total gap (required − supplied) for each spec?"
- "Which cells have labor but no material supply?"

---

## Phase 2: Demand Classification

For each open demand slot from `queryOpenDemands` in the region:

```
1. localSupply = querySupplyBySpecAndLocation(supplyIndex, slot.spec_id, { h3_index: slot.h3_cell })
   localSupply.filter(s => s.slot_type === 'inventory' || s.slot_type === 'scheduled_receipt')

   if localSupply has enough quantity:
     → "locally satisfiable"
     → run dependent-demand with shared netter (Mode C)

2. elif supply exists in the region at a different cell:
     → "transport candidate"
     → dependent-demand will find a transport recipe when atLocation differs from supply location
     → the algorithm's transport path (step 1.5 in dependent-demand.ts) handles this

3. elif recipeStore.recipesForOutput(slot.spec_id) exists:
     → "producible with imports"
     → dependent-demand will create purchaseIntents for material inputs
     → local labor (from AgentIndex) may still be usable

4. else:
     → "external dependency"
     → no local supply, no recipe → purchase Intent only, no process planning
```

This classification prevents wasted algorithm invocations and allows priority ordering:
locally satisfiable demands are planned first (cheaper, faster); external dependencies are
flagged for procurement without recipe explosion overhead.

---

## Phase 3: Plan Formulation

### Three orthogonal concepts: H3 cells, PlanStore, Plans

These are independent:

- **H3 cells** determine _what data gets loaded_ — they are the filter applied in Phases 0–2.
  They have no structural role in Plans.
- **PlanStore** is owned by a planning invocation and corresponds to its region. It holds
  only the Plans committed by that invocation — sparse because most supply/demand lives
  in Observer inventory and the index snapshots.
- **Plans** are logical coordination units — a named grouping of Processes and Commitments
  that serve a related set of demands. A Plan can span many H3 cells, or many Plans can
  exist within one cell. The caller decides plan granularity based on organizational logic
  (by due date, by responsible agent, by process cluster, etc.), not by grid boundaries.

The `PlanNetter` is the consistency boundary, not the Plan. One netter can span multiple
Plans; the `allocated` Set tracks what has been soft-allocated regardless of which Plan
each commitment belongs to.

### What Phase 3 actually does

Phase 3 takes the classified, prioritised demand slots from Phase 2 and runs
`dependentDemand` on each one. The `planId` for each call is a policy decision — the
caller may group demands into one Plan, several Plans, or one-per-demand. What matters is
that all calls within a single invocation share the same `PlanNetter`, so the
soft-allocation ledger is consistent across all of them.

```ts
// planStore and planId(s) are passed in — callers decide Plan granularity
const netter = new PlanNetter(planStore, observer); // one netter per invocation

// ── Phase A: Demand explosion ─────────────────────────────────────────────
// Sorted by D-category then due date: highest-priority, most urgent first.
// This order is what gives well-defined priority when two demands compete
// for the same supply — the netter's allocated Set grows from the top.
const sortedDemands = openDemands.sort(byDCategoryThenDueDate);

for (const slot of sortedDemands) {
  if (slot.remaining_quantity <= 0 && slot.remaining_hours <= 0) continue;

  // atLocation comes from the original Intent, not the H3 cell.
  // The slot's h3_cell was derived FROM intent.atLocation at index-build time;
  // for planning we pass the real SpatialThing ID so the PlanNetter spatial guard works.
  const intent = observer.getIntent?.(slot.intent_id);

  dependentDemand({
    planId: assignPlan(slot), // caller policy — not grid-derived
    demandSpecId: slot.spec_id!,
    demandQuantity: slot.remaining_quantity || slot.remaining_hours,
    dueDate: slot.due ? new Date(slot.due) : horizon.to,
    recipeStore,
    planStore,
    processes,
    observer,
    netter,
    atLocation: intent?.atLocation,
  });
}

// ── Phase B: Supply explosion ─────────────────────────────────────────────
// Forward-schedule any supply not absorbed by Phase A.
// The netter's allocated Set tells us what Phase A already claimed.
const unabsorbedSupply = regionalSupply.filter(
  (s) =>
    s.slot_type !== "labor" && // labor is a constraint, not a starting point
    !netter.allocated.has(s.source_id), // not claimed by demand explosion
);

for (const slot of unabsorbedSupply) {
  if (slot.quantity <= 0) continue;

  const supplyAtLocation =
    slot.slot_type === "inventory"
      ? observer.getResource?.(slot.source_id)?.currentLocation
      : (
          observer.getIntent?.(slot.source_id) ??
          observer.getCommitment?.(slot.source_id)
        )?.atLocation;

  dependentSupply({
    planId: assignPlan(slot),
    supplySpecId: slot.spec_id!,
    supplyQuantity: slot.quantity,
    availableFrom: slot.available_from
      ? new Date(slot.available_from)
      : horizon.from,
    recipeStore,
    planStore,
    processes,
    observer,
    netter, // absorbs pre-claimed consumptions from Phase A
    atLocation: supplyAtLocation,
  });
}
```

### Mode C semantics

The single shared `PlanNetter` implements Mode C across the whole invocation:

- **Phase A** runs `netDemand` → marks inventory + scheduled-output flows as allocated
- **Phase B** runs `netSupply` → deducts pre-claimed consumptions before routing surplus
  into recipes

The `netter.allocated` Set is the bridge. An inventory item claimed by Phase A will not
be double-claimed by Phase B; supply absorbed by Phase A's demand explosion will be
visible to Phase B as a scheduled consumption that reduces available quantity.

---

## Phase 4: Result Collection

```ts
interface RegionalPlanResult {
  plans: Plan[];
  purchaseIntents: Intent[]; // gaps: demand with no local supply AND no recipe
  surplus: SupplySlot[]; // unconverted: supply with no recipe to absorb it
  unmetDemand: DemandSlot[]; // demand that produced only purchaseIntents
  laborGaps: {
    // cells where labor demand > labor supply
    cell: string;
    specId: string;
    missingHours: number;
  }[];
}
```

**`purchaseIntents`** come from `dependent-demand`'s `purchaseIntents[]` — specs with no
recipe and no local inventory. These are signals to procurement, not locally plannable.

**`surplus`** comes from `dependent-supply`'s `surplus[]` — supply that no recipe could
absorb. This could be routed to adjacent regions (see §Cross-Region Edges below).

**`unmetDemand`** are demand slots where Phase A produced purchaseIntents but no
committed processes. These need either: (a) external sourcing via the purchaseIntent, (b)
transport from another region, or (c) expansion signals (new production capacity needed).

**`laborGaps`** are detected by comparing `getTotalSupplyHours(querySupplyBySpec(supplyIndex, specId))` against what the demand explosion needed. When `remaining_hours > available_hours`, a D2 expansion signal is appropriate.

---

## Cross-Region Edges

H3 cells have neighbors. A demand near the boundary of the region might be satisfiable by
supply in an adjacent cell just outside the region.

### Expanded radius query (within-pass)

During Phase 2 classification, expand the supply search to the immediate H3 neighbors of
the demand cell — one grid ring catches all six adjacent cells without coordinate
round-tripping or manual edge-length arithmetic.

`src/lib/core/value-flows/utils/space.ts` already exposes the needed primitives:

```ts
import { getCellsInRadius, cellsCompatible, H3_EDGE_LENGTHS_KM } from '../utils/space';

// Edge length at the canonical resolution (e.g. 1.22 km at res 7)
const edgeKm = H3_EDGE_LENGTHS_KM[canonicalResolution];

// All H3 cells within 2× the edge length — wraps h3.gridDisk internally,
// converting the km budget into the correct ring count automatically.
const broadCells = getCellsInRadius(slot.h3_cell, edgeKm * 2);

const nearbySupply = supplySlots.filter((s) => broadCells.includes(s.h3_cell));

// Per-slot compatibility check (demand cell vs. supply cell):
if (cellsCompatible(demandSlot.h3_cell, supplySlot.h3_cell, edgeKm * 2)) { ... }
```

`getCellsInRadius` is already used by the index layers; the planner should not reach for
raw H3 methods or centroid lat/lon when `space.ts` provides the same operations.
`H3_EDGE_LENGTHS_KM[res]` replaces the former `h3.getHexagonEdgeLengthAvg(res, 'km')`
call (which is not available in the h3-js build used by this project).
`cellsCompatible` uses `h3.gridDistance` with a Haversine fallback for the rare case
where cells fall on different icosahedron faces.

### Cross-region routing via the merge planner

Deeper cross-region coordination falls naturally out of a merge planner for the union
region. After the two leaf planners have produced their PlanStores:

- **PlanStore-A** contains surplus for spec:wool (supply that no recipe absorbed)
- **PlanStore-B** contains unmetDemand for spec:wool (demand that produced only a purchase intent)

The merge planner for A∪B starts from the merged PlanStore, which now contains Region A's
committed output as a scheduled-receipt intent. When the merge planner's PlanNetter
re-explodes Region B's unmet demand fragment, it sees Region A's surplus as available
supply — and if a transport recipe exists, routes the demand through it.

```
planForRegion(A∪B, subStores=[PlanStore-A, PlanStore-B]):

  merged PlanStore contains Region A's surplus intent (as scheduled output)

  re-explode Region B's unmet demand fragment:
    netAvailableQty('spec:wool', { atLocation: B.location })
      → finds Region A's surplus via PlanStore intents scan
      → transport recipe: pickup(A.location) → dropoff(B.location)
      → resolves via cross-region transport, written into PlanStore-AB
```

No special cross-region bookkeeping is needed. It emerges from the merge planner's
PlanNetter seeing both regions' committed state simultaneously. The transport recipe
support already exists in `dependent-demand.ts`.

---

## Merge Planners and Conflict Resolution

### How conflicts arise

Leaf planners see only the **index snapshot** — a pre-planning view of what exists. Two
planners with overlapping regions may independently claim the same inventory item, the
same scheduled receipt, or the same labor window. Their PlanStores, taken individually,
are each internally consistent; the conflict only becomes visible when you look at both
together.

Conflict types:

| Conflict type            | Signal                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Inventory over-claim** | Commitments across the two PlanStores referencing the same resource total more than its `onhandQuantity`                |
| **Receipt over-claim**   | Commitments across the two PlanStores consuming the same scheduled-output intent/commitment exceed its planned quantity |
| **Labor double-booking** | Commitments across the two PlanStores assign the same agent to overlapping time windows                                 |

### The merge planner

When you detect that two PlanStores conflict — or when you simply want to plan a region
that spans both — you create a **merge planner** for the higher-order region:

```ts
function planForRegion(
  cells: string[],
  horizon: Horizon,
  context: PlanningContext,
  subStores: PlanStore[] = [], // sub-region PlanStores to merge from
): PlanStore {
  const planStore = new PlanStore();

  // If sub-stores provided, start from their merged state
  for (const sub of subStores) planStore.merge(sub);

  // Detect conflicts in the merged state
  const conflicts = detectConflicts(planStore, context.observer);

  if (conflicts.length > 0) {
    resolveConflicts(planStore, conflicts, context);
  }

  // Then continue with normal phases for any demand in this region
  // not already covered by the sub-stores
  const netter = new PlanNetter(planStore, context.observer);
  // ... Phases 1–4 for the higher-order region
  return planStore;
}
```

A leaf planner is just `planForRegion(cells, horizon, ctx)` with no subStores — it starts
from an empty PlanStore and runs Phases 0–4. A merge planner provides subStores; it starts
from the merged state, resolves conflicts, then optionally continues planning for demand
in the union region not yet covered.

The same function handles both. The only difference is the starting state of the PlanStore.

### Conflict detection

Detection is a pure scan of the merged PlanStore — no planning required:

```ts
function detectConflicts(
  planStore: PlanStore,
  observer: Observer,
): CommitmentConflict[] {
  const claimsByResource = new Map<string, CommitmentClaim[]>();

  for (const c of planStore.allCommitments()) {
    if (!c.resourceInventoriedAs) continue;
    const bucket = claimsByResource.get(c.resourceInventoriedAs) ?? [];
    bucket.push({
      commitmentId: c.id,
      planId: c.independentDemandOf,
      qty: c.resourceQuantity?.hasNumericalValue ?? 0,
      priority: dCategoryOf(c),
      due: c.due,
      specId: c.resourceConformsTo,
      atLocation: c.atLocation,
      satisfies: c.satisfies,
    });
    claimsByResource.set(c.resourceInventoriedAs, bucket);
  }

  const conflicts: CommitmentConflict[] = [];
  for (const [resourceId, claims] of claimsByResource) {
    const available =
      observer.getResource(resourceId)?.onhandQuantity?.hasNumericalValue ?? 0;
    const totalClaimed = claims.reduce((s, c) => s + c.qty, 0);
    if (totalClaimed > available) {
      conflicts.push({
        resourceId,
        available,
        overBy: totalClaimed - available,
        claims,
      });
    }
  }
  return conflicts;
}
```

### Surgical resolution: minimum intervention

The resolution pass does **not** re-run the planner from scratch over a wider region.
That would discard good work and fail to distinguish between the parts of each Plan that
are valid and the parts that aren't. Instead, resolution is surgical:

**The principle**: retract only the demand subgraph that is over the limit. Recover
exactly the demand entry point that subgraph was serving. Re-explode only that
demand — letting the algorithm find a substitute path on its own. Write the new
subgraph back into the same Plan it came from.

**Retraction unit — a process subgraph, not a single commitment**

`dependentDemand` does not create isolated Commitments — it creates a connected subgraph:
one **Process** per recipe step, and one **Commitment or Intent per I/O** of each process
(`inputOf` / `outputOf`). Retracting only the leaf Commitment that claims the
over-subscribed resource leaves the rest of that process's inputs and its output flow
still in the PlanStore, pointing to a process that can no longer run. The next process's
input would appear satisfied by an output that will never be produced. The retraction unit
must therefore be the **process and all of its inputOf/outputOf records**, plus any
upstream processes whose inputs now become orphaned.

The cascade identification:

```
1. Find commitment C that claims the over-subscribed resource.
2. Find process P = C.inputOf (the process that consumes this resource as an input).
3. Retract ALL commitments/intents where inputOf === P or outputOf === P.
4. Retract P itself from the ProcessRegistry.
5. For each remaining process Q: if any of Q's input commitments has
   resourceConformsTo equal to P's output spec (it depended on P's output),
   Q is now orphaned — retract Q and its flows recursively (go to step 3 for Q).
6. Stop when no more orphaned processes exist.
```

The `DemandFragment` recovered is NOT the leaf commitment's spec — it is the **demand
re-entry point**: the original spec and quantity that was passed to the `dependentDemand`
call that created this process chain, derivable from the output of the topmost retracted
process (the one whose output feeds into a still-intact downstream process, or the root
demand intent itself).

**Provenance tagging — the clean implementation approach**

Graph traversal for cascade detection is O(n²) in the worst case. A cleaner alternative:
tag every object created by a `dependentDemand` call with a `provenance_id` equal to the
root demand intent ID.

```ts
// At call time:
dependentDemand({ provenanceId: rootDemandIntentId, ... });

// Inside the algorithm, every Process and flow it registers gets:
process.provenanceId = provenanceId;
commitment.provenanceId = provenanceId;
intent.provenanceId = provenanceId;
```

Retraction then becomes a single-pass filter:

```ts
planStore.removeWhere((obj) => obj.provenanceId === targetProvenanceId);
processes.removeWhere((p) => p.provenanceId === targetProvenanceId);
```

This is O(n) over the tagged objects and requires no graph traversal. Re-explosion calls
`dependentDemand` again with the same root inputs and a fresh `provenanceId`. The
algorithm naturally rebuilds the correct subgraph.

**Note on Plans**: a Plan is an organizational container — it is never retracted. Only
the Processes and flows (Commitments/Intents) within it are removed. The Plan persists;
the re-explosion writes new Processes and flows into the same Plan.

#### Step 1 — Build the retraction set

For each conflict, sort the competing claims by priority (D-category, then due date).
Walk down the sorted list, accumulating claimed quantity until the running total exceeds
`available`. Everything above that threshold goes into the retraction set — just those
specific commitments, nothing else.

```
Conflict: resource:steel-beam-42, available=100kg, over-claimed by 40kg

Claims (sorted by priority):
  C1: planId=P1, D1, due=Mar 1,  qty=60  → keep (running total: 60, within 100)
  C2: planId=P2, D5, due=Mar 3,  qty=30  → keep (running total: 90, within 100)
  C3: planId=P3, D5, due=Mar 10, qty=50  → RETRACT (would push to 140; over by 40)
                                            fragment: { spec:steel-beam, qty:50, ... }
```

A claim may be **partially retracted** when the over-subscription is smaller than the
full claim — `retractQty = min(claim.qty, overBy)` — leaving the rest in place. This
avoids discarding work unnecessarily.

#### Step 2 — Recover demand re-entry points

Each retraction target has an associated `provenanceId` (the root demand intent ID).
The demand re-entry point is recovered from the topmost retracted process in the subgraph:

```ts
interface DemandFragment {
  specId: string;       // output spec of the topmost retracted process (= original root demand spec)
  qty: number;          // quantity at the root — full re-explosion quantity (not the leaf qty)
  atLocation?: string;  // from the root demand intent's atLocation
  due?: string;         // from the root demand intent's due date
  planId: string;       // write back into the SAME Plan
  provenanceId: string; // root demand intent ID — passed to re-explosion call
  priority: DCategory;
}
```

The `qty` here is the **root demand quantity**, not the quantity of the leaf commitment
that was over-subscribed. The re-explosion will call `dependentDemand` with this qty,
and the algorithm will naturally only consume as much of each resource as the new
allocation permits (via the netter's `allocated` Set). No manual scaling is needed.

#### Step 3 — Retract the process subgraph

Remove the entire subgraph tagged with `provenanceId` from PlanStore atomically:

```ts
// Retract all flows and processes created by this demand call
planStore.removeWhere((obj) => obj.provenanceId === retractedProvenanceId);
processes.removeWhere((p) => p.provenanceId === retractedProvenanceId);
```

Then build a fresh `PlanNetter` from the post-retraction PlanStore state. This netter
now sees the vacated supply as available again — but also sees all the untouched
commitments from all other Plans, so it won't re-introduce the conflict.

If provenance tagging is not yet implemented, fall back to graph traversal: starting from
the leaf commitment, walk `inputOf` to find its process, then cascade upstream through
any process whose output fed into the retracted chain (see the cascade identification
steps in the "Retraction unit" note above).

#### Step 4 — Re-explode fragments, in priority order

Process the demand fragment queue from highest-priority to lowest. For each fragment,
call `dependentDemand` with the fragment's spec, quantity, location, and due date —
writing into the **same `planId`** the commitment came from.

`dependentDemand` naturally tries substitutes in order:

```
1. Local inventory of spec (now available — the high-priority plan's steel-beam-42 is
   allocated by the netter, so this one is skipped)
2. Alternative inventory of the same spec at a different location
3. Transport: bring the spec from a nearby location via a transport recipe
4. Scheduled receipt: a planned production output arriving before the due date
5. Production recipe: make it from inputs (which may themselves require re-explosion)
6. Purchase intent: external sourcing signal — the demand cannot be met locally
```

No special substitution logic is needed in the resolution pass — the fallback ladder
already exists inside `dependentDemand`. The difference is simply that the netter's
`allocated` Set now excludes the retracted resource, making the algorithm route around
it naturally.

The new commitments from re-explosion are written back into the original Plan. From the
outside, Plan P3 transitions from "uses steel-beam-42" to "uses transport-from-yard-7"
(or "triggers a purchase intent") — the Plan still exists and is mostly unchanged; only
the conflicting fragment was surgically replaced.

#### Step 5 — Check for cascades, iterate if needed

After each re-explosion, check whether any new commitments introduced by the substitution
create new conflicts. If so, add those to the retraction queue and continue.

Cascades are rare and shallow — they occur only when the substitute supply path also
happened to be claimed by another Plan. The cascade depth is bounded by the number of
independent supply paths for the spec in the region (typically 2–3). Each iteration
strictly reduces the over-subscription count for already-resolved resources.

```
Termination: detectConflicts(planStore, observer) returns [] → done.
```

#### What this looks like end-to-end

```
t=0  Leaf planners run in parallel (no coordination):
     planForRegion(A) → PlanStore-A:
       Plan-P1: uses steel-beam-42 (60kg, D1)
       Plan-P2: uses steel-beam-42 (30kg, D5, Mar 3)

     planForRegion(B) → PlanStore-B:
       Plan-P3: uses steel-beam-42 (50kg, D5, Mar 10)

     Each PlanStore is internally consistent.
     resource:steel-beam-42 has 100kg — over-claimed by 40kg across both stores.

t=1  Someone requests planForRegion(A∪B, subStores=[PlanStore-A, PlanStore-B]):
     PlanStore-AB = merge(PlanStore-A, PlanStore-B)
     detectConflicts(PlanStore-AB): over-subscription on steel-beam-42

t=2  Build retraction set (priority order):
     Keep C1 (60kg, D1) + C2 (30kg, D5-Mar3) = 90kg ≤ 100kg
     Retract C3 (50kg, D5-Mar10) — came from PlanStore-B
     Fragment: { spec:steel-beam, qty:50, atLocation:loc-B, planId:P3, due:Mar10 }

t=3  Remove C3 from PlanStore-AB.
     resolutionNetter = new PlanNetter(PlanStore-AB, observer)
     → sees C1+C2 allocated; 10kg of steel-beam-42 still free

t=4  Re-explode fragment → dependentDemand:
     only 10kg steel-beam-42 left → transport recipe from yard-7
     New commitment C3': { spec:steel-beam, qty:50, via:transport-from-yard-7, planId:P3 }
     Written into PlanStore-AB.

t=5  detectConflicts(PlanStore-AB): [] — converged

     PlanStore-AB is coherent for region A∪B.
     PlanStore-A and PlanStore-B remain unchanged (they are their own records).
     Plan-P3 in PlanStore-AB now uses transport instead of direct inventory.
```

### Surgical resolution vs. re-running the planner from scratch

|                     | Re-run from scratch                 | Surgical resolution in merge planner                             |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| **Scope**           | All demands in the union region     | Only the affected demand fragments                               |
| **Plans preserved** | None — everything recomputed        | Sub-PlanStores unchanged; only conflicts patched in PlanStore-AB |
| **Write target**    | New Plans                           | Existing Plans — conflicting fragments replaced in place         |
| **Substitution**    | Algorithm re-discovers from scratch | Algorithm re-discovers from scratch (same code path)             |
| **Work discarded**  | All leaf planner output             | Only the over-subscribed commitments                             |
| **Cascade risk**    | None (fresh start)                  | Local, bounded by supply path depth per spec                     |

---

## The H3 Resolution Ladder

The canonical cell resolution determines the _granularity of demand/supply data loaded_,
not the Plan structure. Plans are orthogonal to the grid.

| H3 Resolution | Approximate area      | Typical planning horizon loaded               |
| ------------- | --------------------- | --------------------------------------------- |
| 4             | ~1,770 km² (county)   | Multi-day regional supply chain               |
| 5             | ~250 km² (city)       | Weekly city-level demand                      |
| 6             | ~36 km² (district)    | Daily district-level demand                   |
| 7             | ~5 km² (neighborhood) | Shift-level demand                            |
| 9             | ~0.1 km² (block)      | Single process atom (Integrated Planner leaf) |

A coarser canonical resolution loads a wider dataset with less spatial precision; a finer
resolution loads a more targeted dataset. The Plans that emerge from the demand explosion
may still span multiple cells — e.g. a supply chain process in one neighborhood may
source inputs from another. The H3 filter only determines _which demand and supply slots
are visible to the planner at the start_; the demand explosion itself is unconstrained by
the grid once it runs.

The user provides cells at any resolution; normalization ensures no slot is loaded twice
when the input includes nested cells.

---

## Summary: Data Flow

```
Shared read-only context (rebuilt at the start of each planning horizon)
  observer    ← live inventory + committed events
  demandIndex ← IndependentDemandIndex (snapshot)
  supplyIndex ← IndependentSupplyIndex (snapshot)
  recipeStore ← how things are made
  processes   ← ProcessRegistry

── LEAF PLANNER: planForRegion(cells, horizon, ctx) → PlanStore ─────────────────

  inputs: cells: H3Cell[], horizon: { from, to }
  subStores: []   ← none; starts from empty PlanStore

  Phase 0: normalize(cells)
    → canonical: non-overlapping H3 cover

  Phase 1: Extract — H3 cells used ONLY here as a data filter
    regionalDemands = queryDemandByRegion(demandIndex, canonical, horizon)
    openDemands     = queryOpenDemands(demandIndex) ∩ regionalDemands
    regionalSupply  = querySupplyByRegion(supplyIndex, canonical, horizon)

  Phase 2: Classify openDemands
    → locally satisfiable / transport candidate / producible / external

  Phase 3: Plan — H3 cells no longer involved; PlanStore, Plans, netter are orthogonal
    netter = new PlanNetter(planStore, observer)
    for each demand slot (D-category order, then due date):
      dependentDemand({ planId: assignPlan(slot), netter, atLocation: intent.atLocation, ... })
    for each unabsorbed supply slot:
      dependentSupply({ planId: assignPlan(slot), netter, ... })

  Phase 4: Collect signals
    purchaseIntents[] / surplus[] / unmetDemand[] / laborGaps[]

  returns: PlanStore (internally consistent for this region)

── MERGE PLANNER: planForRegion(cells, horizon, ctx, subStores) → PlanStore ─────

  inputs: cells = union of sub-regions, subStores = [PlanStore-A, PlanStore-B, ...]

  planStore = new PlanStore()
  for each sub of subStores: planStore.merge(sub)

  Detect:
    conflicts = detectConflicts(planStore, observer)

  Resolve (if conflicts exist):
    build retraction set: walk claims by priority; keep until running total ≤ available
    for each retracted claim: record DemandFragment { spec, qty, atLocation, planId, provenanceId, due }
    retract full process subgraph (all objects with provenanceId) from planStore atomically
    resolutionNetter = new PlanNetter(planStore, observer)
    for each fragment (priority order):
      dependentDemand({ planId: fragment.planId,   ← same Plan, not a new one
                        netter: resolutionNetter, atLocation: fragment.atLocation, ... })
      → finds substitute: alt inventory → transport → production → purchase intent
    cascade check: if new conflicts → add to retraction set, repeat
    termination: detectConflicts(planStore, observer) == []

  Continue (optional):
    run Phases 1–4 for demand in the union region not covered by sub-stores

  returns: PlanStore-AB (coherent for region A∪B)

── RECURSION ─────────────────────────────────────────────────────────────────────

  If two merge planners' PlanStores conflict:
    planForRegion(A∪B∪C, subStores=[PlanStore-AB, PlanStore-C])
    → same pattern, one level up

  Depth is bounded: most conflicts are between adjacent leaf regions (1 merge step).
```

---

## Key Properties

**Three orthogonal axes**: H3 cells, PlanStore, and Plans do not constrain each other.
Cells scope what data gets loaded (Phases 0–2). PlanStore is owned by an invocation and
corresponds to its region. Plans are organizational labels for logical work groupings —
they can span many cells or many Plans can exist within one cell. The PlanNetter is the
consistency boundary, not the Plan.

**PlanStore is region-scoped, not global**: Each `planForRegion` invocation owns its own
PlanStore corresponding to its region. There is no single global store. Coordination
between planners happens only when a merge planner is created for a region that spans both.

**Parallelism is maximal at the leaf**: Leaf planners share nothing — no coordination, no
shared state, no locks. Conflicts between them are only visible (and only matter) when
someone asks for a higher-order region that spans both. If no one ever asks for that
larger region, the leaf PlanStores coexist independently.

**Merge = a planner for the union region**: Resolving conflicts is not a special operation
— it is a `planForRegion` call that happens to receive sub-PlanStores. The function is
the same. The difference is the starting state of the PlanStore (merged vs. empty).

**Resolution is surgical, not global re-computation**: The merge planner retracts only
the specific commitments above the availability threshold and re-explodes only the demand
fragments those commitments were serving. Sub-PlanStores are not modified. The rest of
every Plan is preserved in the merged PlanStore.

**Substitution is emergent**: When a retracted fragment is re-exploded, `dependentDemand`
tries the next available option on its own fallback ladder — alt inventory → transport →
scheduled receipt → production recipe → purchase intent. The merge planner provides no
guidance on which substitute to use; it only ensures the retracted resource is no longer
available in the netter.

**Recursion is shallow in practice**: Most conflicts are between adjacent leaf regions
and resolve in a single merge step. The hierarchy only recurses up when a merge planner's
PlanStore itself conflicts with another region's — bounded by the nesting depth of
overlapping regions, typically 2–3 levels.

**Indexes are the scoping filter; they are never mutated**: The demand and supply indexes
tell the planner what exists and where — before any allocation. After a planning cycle,
rebuild the indexes from the updated PlanStore state(s) before the next horizon.
