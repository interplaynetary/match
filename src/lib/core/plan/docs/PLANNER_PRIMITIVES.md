# Planner ↔ Space-Time Primitives

How `planner.ts` interacts with the dual-engine architecture to run a **bottom-up, hex-iterative planning loop** that scales gracefully from a single neighbourhood to continental coordination.

---

## Core Design Principle: Bottom-Up Subsidiarity

> Satisfy locally first. Propagate deficits upward. Each higher resolution is a coordination layer of last resort.

The planner does **not** try to solve the global problem in one pass. Instead it runs the same local solver at finer resolutions first, records what was committed, then moves up the hex hierarchy — where it can see cross-region substitutions that were invisible at smaller scales (e.g. a surplus of winter wheat in one district filling a bread deficit in a neighbouring one).

This makes the system:

- **Resilient at small scale** — a single commune running at res 9 works with no knowledge of anything wider
- **Emergent at large scale** — substitutions discovered at res 5 (regional) wouldn't have been visible at res 9 (neighbourhood)
- **Grounded in reality** — commitments track what is _actually_ available after finer-level allocations, preventing double-counting

---

## The Primitives

### Discovery / Index Layer (`space-time-index.ts`)

```ts
// Read aggregated stats for any H3 cell (O(1))
queryHexIndex(index, cell): HexNode<T> | null

// Get all item IDs within a radius
queryHexIndexRadius(index, { h3_index?, latitude?, longitude?, radius_km? }): Set<string>

// Resolve item IDs to full objects
getItemsInCell(index, cell): T[]
```

### State Indexers

```ts
// Labor
buildLaborIndex(persons): LaborIndex
queryLaborByLocation(laborIndex, location): PersonCapacity[]
queryLaborBySkillAndLocation(laborIndex, skillId, location): PersonCapacity[]

// Needs
buildNeedIndex(needs): NeedIndex
queryNeedsByHex(needIndex, cell): HexNode<Need> | null
queryNeedsByTypeAndLocation(needIndex, typeId, location): Need[]

// Resources
buildResourceIndex(resources): ResourceIndex
queryResourcesByHex(resourceIndex, cell): HexNode<Resource> | null
queryResourcesByTypeAndLocation(resourceIndex, typeId, location): Resource[]
```

### Allocation Tracker (`allocation.ts`)

```ts
// Record a commitment (now spatially indexed)
allocations.commit({ slot_id, contributor_id, quantity, h3_index, latitude, longitude })

// Query what has already been committed in a region
allocations.commitmentsByLocation({ latitude, longitude, radius_km }): Commitment[]

// Coverage: how much of a need is already filled
allocations.allocationCoverage(slot_id, quantity_needed): AllocationCoverage
```

### Compression Engine (`space-time-keys.ts`)

```ts
// Compress a list of slots into canonical buckets by space-time envelope
groupSlotsBySpaceTime(slots, h3Resolution?): Map<signature, { quantity, slots }>
// e.g. 5,000 individual needs → 30 canonical buckets like:
// "recurring|Days:(monday)@(09:00-17:00)::8728347xxxxxxx"

// Single signature for a slot
getSpaceTimeSignature(slot, h3Resolution?): string
```

---

## The Planning Loop

```
for resolution R from LEAF (9) to ROOT (3 or 4):
  for each active cell at resolution R:
    1. SCOPE   — pull local needs, resources, labor from indices
    2. SUBTRACT — exclude quantities already committed at child levels
    3. COMPRESS — group into space-time buckets via getSpaceTimeSignature
    4. SATISFY  — run planFromNeeds() in order of criticality
    5. COMMIT   — record allocations with spatial coordinates
    6. PROPAGATE — compute deficits; they become inputs to the parent level
```

### Step 1: Scope (extract local participants)

```ts
const location = {
  latitude: cell.lat,
  longitude: cell.lon,
  radius_km: cellRadiusKm(R),
};

const localNeeds = queryNeedsByTypeAndLocation(needIndex, typeId, location);
const localLabor = queryLaborByLocation(laborIndex, location);
const localStocks = queryResourcesByLocation(resourceIndex, location);
```

### Step 2: Subtract already-committed quantities

```ts
// What was already allocated by finer-resolution passes?
const alreadyCommitted = allocations.commitmentsByLocation(location);
// Subtract from localStocks / localLabor before passing to the solver
```

### Step 3: Compress

```ts
const needBuckets = groupSlotsBySpaceTime(localNeeds, R);
const laborBuckets = groupSlotsBySpaceTime(localLabor, R);
// 5,000 rows → tens of canonical buckets
```

### Step 4: Satisfy in criticality order

```ts
// planFromNeeds sorts by D4 (administration) > D5 (common needs) > D6 (support)
// Minimize total SNLT while maximising coverage
const production = planFromNeeds(
  finalTargets,
  feasibleSet,
  stocks,
  products,
  insuranceFactor,
);
```

### Step 5: Commit

```ts
for (const selected of production.selectedStrategies) {
  allocations.commit({
    slot_id: selected.strategy.id,
    contributor_id: selected.strategy.id,
    quantity: selected.executions,
    h3_index: cell, // spatial index for parent-level subtraction
  });
}
```

### Step 6: Propagate deficits upward

```ts
const deficits = production.expansionSignals; // { productId, needed, feasible, gap }
// Pass deficits as additional finalTargets to the parent resolution's planFromNeeds()
```

---

## Emergent Substitutions at Higher Resolutions

The key insight: **a substitution that is impossible at res 9 may be trivial at res 7**.

**Example:**

- Res 9, Cell A: bread deficit of 30 units. No local wheat or bakers.
- Res 9, Cell B (neighbour): wheat surplus 200kg, 2 bakers with spare hours.
- Res 7 parent: sees both cells. A regional milling+baking operation spans them.
  → The deficit in A is satisfied by a cross-neighbourhood operation that neither cell
  could have seen on its own.

This works because:

1. Deficits from A bubble up to the res-7 parent as `expansionSignals`
2. At res 7, `queryResourcesByTypeAndLocation` returns the union of A and B's resources
3. The solver at res 7 finds a feasible strategy using B's wheat + B's bakers to fill A's need
4. The allocation is committed with `h3_index = res7_parent_cell`, visible to res 5 above

---

## H3 Traversal Helpers

```ts
// Get parent cell
h3.cellToParent(cell, targetResolution);

// Get radius of a hex cell at a given resolution (approximate)
h3.getHexagonEdgeLengthAvg(resolution, h3.UNITS.km);

// Get all cells at a given resolution within a ring
h3.gridDisk(cell, k);

// Distance between two cells (for substitution feasibility check)
h3.gridDistance(cellA, cellB);
```

---

## What Changes in `planner.ts`

| Current                                              | Target                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `plan(input)` takes flat lists, runs one global pass | `plan(input, indices, resolutions?)` iterates resolutions bottom-up     |
| `buildFeasibleSet` receives `Person[]` directly      | Receives `LaborIndex` + optional spatial scope                          |
| `planFromNeeds` runs once on global needs            | Runs once per hex-level, with scoped needs + deficit carry-over         |
| No commitment tracking                               | `Allocations` records spatial commitments for cross-level deduplication |

### Proposed entry point

```ts
function plan(
  input: PlannerInput,
  indices: {
    laborIndex: LaborIndex;
    needIndex: NeedIndex;
    resourceIndex: ResourceIndex;
  },
  options?: {
    leafResolution?: number; // default: 9
    rootResolution?: number; // default: 4
    focusCells?: string[]; // optional: only plan within these cells
  },
): ProductionPlan;
```
