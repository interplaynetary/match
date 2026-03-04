# Value-Flows Planner — System Overview

This document describes the planning stack built on the [Value Flows](https://valueflo.ws) ontology. The system takes a region of H3 cells and a time horizon, looks at what people need and what is available, and produces a concrete plan: which processes to run, who does what, what to buy externally, and where capacity is genuinely short.

---

## Conceptual Model

Planning in this system is **backward demand explosion** (MRP) layered on top of **forward supply routing**, tied together by a shared netting state so the two passes never double-count the same inventory.

```
Independent Demands              Independent Supply
(what people need)               (what exists / is scheduled)
        │                                │
        ▼                                ▼
┌────────────────────────────────────────────────┐
│              planForRegion()                   │
│                                                │
│  Phase 0  ──  Normalise H3 cells               │
│  Phase 1  ──  Extract demand + supply slots    │
│  Phase 2  ──  Classify each demand slot        │
│  Phase 3                                       │
│    Pass 1  ──  Explode primary demands         │
│    Derived ──  Replenishment demands           │
│    Pass 2  ──  Explode replenishment           │
│    Backtrack ─ Retract low-priority if needed  │
│  Phase B  ──  Forward-schedule surplus supply  │
│  Phase 4  ──  Collect result                   │
└────────────────────────────────────────────────┘
        │
        ▼
   RegionPlanResult
   ├── planStore       ← all Processes, Intents, Commitments
   ├── purchaseIntents ← external sourcing needed
   ├── surplus         ← supply with no recipe to absorb it
   ├── unmetDemand     ← demands that were retracted
   ├── metabolicDebt   ← replenishment specs with no recipe
   └── laborGaps       ← work intents with no assigned agent
```

---

## Directory Layout

```
value-flows/
├── planning/
│   ├── plan-for-region.ts    ← top-level orchestrator  ★
│   ├── planning.ts           ← PlanStore (working memory)
│   ├── netting.ts            ← PlanNetter (shared allocation state)
│   ├── schedule-book.ts      ← per-entity schedule queries
│   └── integrated-planner.ts ← earlier generator-loop planner
│
├── algorithms/
│   ├── dependent-demand.ts   ← backward MRP explosion
│   ├── dependent-supply.ts   ← forward supply routing
│   └── SNE.ts                ← Socially Necessary Effort index
│
├── indexes/
│   ├── independent-demand.ts ← demand snapshot (spatially indexed)
│   ├── independent-supply.ts ← supply snapshot (inventory + receipts + labor)
│   └── agents.ts             ← agent capacity index
│
├── knowledge/
│   └── recipes.ts            ← RecipeStore (production templates)
│
├── observation/
│   └── observer.ts           ← event ledger → derived resource state
│
├── process-registry.ts       ← shared Process store
└── schemas.ts                ← VF entity types + action effect rules
```

---

## Layer 1 — Knowledge: RecipeStore

Everything the planner knows about *how to produce things* lives in `RecipeStore`.

```
Recipe
 └── RecipeProcess[]       (ordered steps in the chain)
      └── RecipeFlow[]     (inputs and outputs for each step)
           ├── action       (consume / produce / use / work / cite …)
           ├── resourceConformsTo  (which ResourceSpecification)
           ├── resourceQuantity    (how much per process run)
           ├── effortQuantity      (hours for work/use)
           └── stage / state       (resource refinement requirements)
```

A `RecipeProcess` is a **template**. When the planner schedules it, it becomes a concrete `Process` with real start/end dates. The `RecipeStore` also holds `ResourceSpecification` and `ProcessSpecification` catalog entries — these are the spec types, not the instances.

Key queries used during planning:
- `recipesForOutput(specId)` — what recipes produce this?
- `recipesForInput(specId)` — what recipes consume this?
- `recipesForTransport(specId)` — transport recipes (pickup/dropoff pairs)
- `getProcessChain(recipeId)` — topologically ordered process steps

---

## Layer 2 — Observation: Observer

The `Observer` is the event ledger. It records `EconomicEvent`s and derives current resource state from them — it is the stockbook.

```
EconomicEvent (immutable)
  ├── action          (produce / consume / transfer / …)
  ├── resourceInventoriedAs  (the EconomicResource being affected)
  ├── resourceQuantity / effortQuantity
  ├── fulfills        (Commitment)
  └── satisfies       (Intent)

EconomicResource (derived state)
  ├── onhandQuantity       (physical stock)
  ├── accountingQuantity   (rights-based stock)
  ├── currentLocation
  ├── stage / state
  └── primaryAccountable   (who holds rights)
```

During planning the observer is read-only: `conformingResources(specId)` returns what is currently in stock, which the planner can soft-allocate against.

---

## Layer 3 — Indexes: Pre-Planning Snapshots

Before `planForRegion` runs, two read-only indexes are built from the observer state:

### IndependentDemandIndex

Built from unfinished `Intent`s (requests or offers not yet fulfilled).

Each intent becomes a **DemandSlot**:

| field | meaning |
|-------|---------|
| `spec_id` | what is needed |
| `remaining_quantity` | how much is still open |
| `h3_cell` | where it is needed (H3 at planning resolution) |
| `due` | by when |
| `action` | consume / work / use … |

Slots are spatially indexed so `queryDemandByLocation(index, { h3_index: cell })` is an O(1) lookup. Intents without `atLocation` are not spatially indexed and will not appear in regional queries.

### IndependentSupplyIndex

Three strata of supply, all collapsed into **SupplySlot**s:

| stratum | source | slot_type |
|---------|--------|-----------|
| On-hand inventory | EconomicResources with onhand qty > 0 | `'inventory'` |
| Scheduled receipts | output-of Intents / Commitments (future production) | `'scheduled_receipt'` |
| Labor capacity | AgentCapacity nodes from AgentIndex (remaining effort hours) | `'labor'` |

### AgentIndex

Collapses multiple work Intents from the same agent in the same space-time window into one `AgentCapacity` node (avoids double-counting available hours when querying by skill).

---

## Layer 4 — Netting: PlanNetter

`PlanNetter` is the shared soft-allocation state that prevents the same inventory or scheduled output from being claimed twice across algorithm calls.

```typescript
const netter = new PlanNetter(planStore, observer);
```

Three methods:

| method | direction | mutates |
|--------|-----------|---------|
| `netDemand(specId, qty, opts?)` | absorbs inventory + scheduled outputs | yes — marks intent IDs in `allocated` |
| `netSupply(specId, qty, …)` | deducts scheduled consumptions | yes — marks intent IDs in `allocated` |
| `netAvailableQty(specId, opts?)` | inventory + outputs − consumptions | no — read-only |

**Mode C** (demand + supply in one session):

```
netter = new PlanNetter(planStore, observer)
dependentDemand({…, netter})   // books consumption intents
dependentSupply({…, netter})   // sees those consumptions; only routes remaining supply
```

**Spatial guard:** `atLocation && r.currentLocation && r.currentLocation !== atLocation → skip`. An intent/resource with no location matches everywhere (conservative).

**Temporal guard:**
- `netDemand`: scheduled output whose `due` is after `neededBy` is skipped
- `netSupply`: consumption whose `due` is before `availableFrom` is skipped

**`netUse(resourceId, from, to)`** handles time-slot scheduling for `use` actions (tool reservations), checked against both in-session reservations and the pre-existing `ScheduleBook`.

---

## Layer 5 — Algorithms

### dependent-demand — Backward MRP

Starts from a single demand `(specId, qty, dueDate)` and walks backward through recipes, back-scheduling processes.

```
demand: (spec:bread, 10kg, 2026-09-01)
  │
  ├─ netDemand → 3kg from inventory
  │
  └─ remaining 7kg → find recipe "Bake Bread"
       │
       ├─ back-schedule: Bake process (due 2026-09-01, begin 2026-08-31)
       ├─ output intent: produce spec:bread 7kg
       ├─ input intent:  consume spec:wheat 7kg  ←── sub-demand queued
       └─ input intent:  work 1h
            │
            └─ sub-demand: (spec:wheat, 7kg, 2026-08-31)
                  │
                  ├─ netDemand → 7kg from inventory ✓
                  └─ remaining 0 → done
```

**Special handling:**
- `use` inputs → time-slot scheduling via `netter.netUse`; purchase intent if no slot available
- `cite` inputs → existence gate only; no sub-demand if resource already exists
- `work` inputs → labour record, no recursion into sub-demands
- No recipe found → purchase intent created (external sourcing needed)
- Transport candidate (resource exists at different location) → transport recipe tried first

**Recipe ranking:** SNE (embodied labor, when index provided) or SNLT (direct labor, fallback). Lower score = more efficient = preferred.

**Returns:** `DependentDemandResult`
```
{
  processes:        Process[]       // scheduled process instances
  intents:          Intent[]        // flow records (no agents)
  commitments:      Commitment[]    // flow records (both agents known)
  purchaseIntents:  Intent[]        // external sourcing needed
  allocated:        DemandAllocation[]  // {specId, resourceId, quantity}
}
```

### dependent-supply — Forward Supply Routing

The dual algorithm. Starts from available supply and routes it forward through recipes that consume it.

```
supply: (spec:wheat, 20kg, available 2026-08-01)
  │
  ├─ netSupply → 7kg already claimed by Pass 1 consumptions
  │
  └─ remaining 13kg → find recipes consuming spec:wheat
       │
       └─ recipe "Bake Bread" consumes spec:wheat
            │
            ├─ cap: max batches by complementary materials (water, yeast)
            ├─ forward-schedule: Bake process (begin 2026-08-01)
            ├─ output: 13kg bread → queued as derived supply
            └─ derived supply: (spec:bread, 13kg)
                  └─ no recipe consuming bread → terminal → surplus[]
```

**Returns:** `DependentSupplyResult`
```
{
  processes:       Process[]
  intents:         Intent[]
  commitments:     Commitment[]
  surplus:         Array<{specId, quantity}>   // unabsorbed supply
  purchaseIntents: Intent[]                    // missing complementary inputs
}
```

### SNE — Socially Necessary Effort

Pre-computed index of labor hours embodied in one unit of a spec:

```
SNE(spec) = (Σ direct_work_hours
           + Σ qty_consumed × SNE(input_spec)
           + Σ duration/lifespan × SNE(equipment_spec))
           / primary_output_qty
```

Used in `dependent-demand` for recipe ranking when an SNE index is provided. Falls back to SNLT (direct labour only) otherwise.

---

## Layer 6 — Orchestration: planForRegion

`planForRegion(cells, horizon, ctx, subStores?)` is the top-level entry point.

```typescript
const result = planForRegion(
  ['87195da49ffffff', '871fb4662ffffff'],   // H3 cells
  { from: new Date('2026-01-01'), to: new Date('2026-12-31') },
  {
    recipeStore,
    observer,
    demandIndex,
    supplyIndex,
    generateId,
    agents: { provider: 'agent:alice', receiver: 'agent:coop' },
    config: { insuranceFactor: 0.10 },
  },
);
```

### Phase 0 — Normalise Cells

```typescript
normalizeCells(['87…', '86…', '87…'])
// deduplicates + drops child cells when ancestor is present
// '87…' is a child of '86…' → dropped
```

### Phase 1 — Extract Slots

Queries `queryDemandByLocation` and `querySupplyByLocation` for each canonical cell. Applies horizon filter on `slot.due`. Returns `DemandSlot[]` and `SupplySlot[]`.

### Phase 2 — Classify Demand Slots

Each demand slot is assigned a `DemandSlotClass`:

| class | condition |
|-------|-----------|
| `locally-satisfiable` | supply of this spec exists in canonical cells |
| `transport-candidate` | supply exists elsewhere in the region |
| `producible-with-imports` | a recipe exists to produce it |
| `external-dependency` | no recipe and no supply anywhere |

Slots are sorted for planning: class order (locally-satisfiable first) → due date (earliest first).

### Phase 3 — Formulate

#### Pass 1: Primary Demands

For each sorted demand slot, call `dependentDemand`. The shared `netter` accumulates allocations so later slots cannot claim the same inventory.

Within the same classification class, slots with earlier due dates are planned first and claim inventory first.

#### Derived Replenishment Demands

After Pass 1, any resource tagged `tag:plan:replenishment-required` that was consumed from inventory gets a derived demand for the same quantity. These are resources that must be replenished (soil nutrients, energy reserves, etc.) not just consumed.

```
Pass 1 allocated: { spec:soil-nutrients: 3kg }
spec:soil-nutrients has tag:plan:replenishment-required
→ derivedDemands: [{ specId: 'spec:soil-nutrients', qty: 3 }]
```

#### Pass 2: Replenishment

Runs `dependentDemand` for each derived demand using a **production-only netter** (no observer). This forces the algorithm to find a recipe rather than re-netting from existing inventory — the question is *can we replenish this*, not *do we currently have it*.

If no recipe exists → purchase intent → **MetabolicDebt**:

```typescript
// MetabolicDebt: replenishment-required spec with no production path
metabolicDebt.push({ specId: 'spec:rare-nutrients', shortfall: 3 })
```

#### Backtracking

If `metabolicDebt` is non-empty, the planner walks Pass 1 records in **latest-due-first order** and retracts them:

1. `planStore.removeRecords({ processIds, commitmentIds, intentIds })` — removes the exact records accumulated in `DependentDemandResult` (no BFS needed; the result already contains every record the explosion created)
2. Retry replenishment with freed capacity (production-only netter — no observer)
3. If debt resolved → retracted demand goes to `unmetDemand`; loop stops
4. If not resolved → continue to next candidate

### Phase B — Forward Supply

Remaining unallocated supply slots are passed to `dependentSupply`. The shared netter has already recorded Pass 1 consumption intents, so `dependentSupply` sees only the genuinely available portion.

```
supplySlot.quantity → dependentSupply → surplus[] (unabsorbed)
                                     → additional processes + intents
```

### Phase 4 — Collect

```typescript
return {
  planStore,         // all processes, intents, commitments
  purchaseIntents,   // all external sourcing across all passes
  surplus,           // unabsorbed supply from Phase B
  unmetDemand,       // retracted Pass 1 demands
  metabolicDebt,     // replenishment specs with no recipe
  laborGaps,         // work intents with no assigned agent
};
```

---

## Merge Planner (Hierarchical Planning)

When `subStores` are provided, `planForRegion` operates as a **merge planner** rather than a leaf planner:

```
Region A (leaf)  →  planStore_A
Region B (leaf)  →  planStore_B
                         │
                         ▼
        planForRegion([A ∪ B], horizon, ctx, [planStore_A, planStore_B])
```

1. `mergePlanStores(subStores)` — combines all leaf stores into one
2. New `PlanNetter` pre-loaded with all leaf allocations
3. Leaf `unmetDemand` + `metabolicDebt` treated as new demand inputs
4. Phase 3 runs again with inter-region visibility (full union of cells)
5. **Conflict detection** after Phase B:
   - *Inventory overclaim:* sum of committed quantities for a resource > its `onhandQuantity`
   - *Capacity contention:* multiple processes competing for the same agent's time
6. **Surgical resolution:** retract latest-due competing process subgraph → re-explode at merge scope → repeat until no conflicts

This is recursive: a merge planner can itself be merged with other planners at a higher H3 resolution level, bounded by the H3 hierarchy depth.

---

## PlanStore and ProcessRegistry

`PlanStore` is the working memory of a planning session.

```
PlanStore
  ├── plans:       Map<id, Plan>
  ├── processes:   ProcessRegistry       ← shared with Observer
  ├── intents:     Map<id, Intent>
  └── commitments: Map<id, Commitment>
```

**Important:** `planStore.addPlan({ id, name })` must be called before any `dependentDemand` or `dependentSupply` call using that planId. The algorithms validate the plan exists and throw if not.

`ProcessRegistry` is the single source of truth for `Process` instances — the same object whether planned or observed. Both `PlanStore` and `Observer` reference the same registry.

Key bulk operations added for the orchestrator:
- `planStore.merge(sub)` — imports all records from a sub-store (merge planner)
- `planStore.removeRecords({ processIds, commitmentIds, intentIds })` — surgical retraction
- `planStore.allProcesses()` / `allIntents()` / `allCommitments()` — full enumeration

---

## Data Flow Summary

```
RecipeStore ──────────────────────────────────────┐
                                                   │
Observer ─────► IndependentSupplyIndex             │
Observer ─────► IndependentDemandIndex             │
                         │                         │
                         ▼                         ▼
                   planForRegion() ─────────► dependentDemand()
                         │                   dependentSupply()
                         │                         │
                         │              PlanNetter (shared)
                         │                         │
                         ▼                         ▼
                     PlanStore ◄──────────── ProcessRegistry
                         │
                         ▼
                  RegionPlanResult
```

The observer is read during planning (inventory queries) but never written to. All plan state accumulates in `PlanStore` (Intents/Commitments/Processes). When planning is complete and execution begins, `EconomicEvent`s are recorded against the Observer — fulfilling Commitments, satisfying Intents, and advancing Process state.

---

## Test Coverage

All tests live in `value-flows/tests/`.

| file | tests | covers |
|------|-------|--------|
| `plan-for-region.test.ts` | 20 | orchestrator phases, metabolicDebt, backtracking, Phase B, merge planner |
| `dependent-demand.test.ts` | ~40 | backward MRP, use/cite/work handling, transport |
| `dependent-supply.test.ts` | ~30 | forward supply, Mode C, surplus |
| `observer-actions.test.ts` | 301 | all 19 VF actions, split-custody, corrections |
| `observer-gaps.test.ts` | 31 | 14 behavioral gaps |
| `vf-examples.test.ts` | 48 | all 29 VF spec XML examples |
| *(others)* | ~58 | netting, SNE, indexes, schedule-book, recipes |
