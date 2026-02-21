# Space-Time-Plan: Plans as Timelines

> The goal is not to produce _a_ plan. The goal is to explore _the space_ of plans, and select the best one. This requires plans to be first-class objects: constructable, scorable, comparable, mergeable, and prunable — all deterministically.

---

## Why "Plan" Is a Different Kind of Thing

The existing primitives answer two questions:

| Primitive                        | Question answered                                              |
| -------------------------------- | -------------------------------------------------------------- |
| `space.ts` + H3                  | **WHERE** — coordinates to canonical hex cell                  |
| `time.ts` + `space-time-keys.ts` | **WHEN** — availability patterns to canonical bucket           |
| `space-time-index.ts`            | **WHAT EXISTS** — indexed inventory of labor, needs, resources |

None of these answer: **what is this resource/labor/need _intended to become_?**

A wheat surplus at a hex cell is `WHAT EXISTS`. A bread-baking operation scheduled to consume that wheat on Tuesday is `WHAT IS INTENDED`. The gap between them is the planning problem. A **Plan** is a consistent, complete specification of intentions across a region of the space-time grid.

Crucially, there is never just one Plan being build. The planner is always implicitly maintaining multiple candidate Plans — different possible futures — and selecting among them. Making this explicit is what makes the search deterministic and the system understandable.

---

## The Correct Abstraction Hierarchy

```
                 ┌─────────────────────────────────────────────────────┐
                 │                  PLAN (a timeline)                  │
                 │                                                     │
                 │  plan_id: canonical hash of all committed atoms     │
                 │  nodes:   Set<SpaceTimePlanNode>                    │
                 │  score:   { needs_covered, total_snlt, deficits }   │
                 └──────────────────┬──────────────────────────────────┘
                                    │
                   one Plan contains many...
                                    │
                 ┌──────────────────▼──────────────────────────────────┐
                 │           SpaceTimePlanNode  (an atom)              │
                 │                                                     │
                 │  key:       SpaceTimePlanKey  (see below)           │
                 │  executions: number                                  │
                 │  snlt:       number  (social labour time)           │
                 │  inputs:     { product_id, quantity }[]             │
                 │  outputs:    { product_id, quantity }[]             │
                 │  committed:  boolean                                │
                 └──────────────────┬──────────────────────────────────┘
                                    │
                 the atom's address in the search space...
                                    │
                 ┌──────────────────▼──────────────────────────────────┐
                 │            SpaceTimePlanKey  (canonical address)    │
                 │                                                     │
                 │  = SpaceTimeKey  +  "::"  +  strategy_type_key     │
                 │                                                     │
                 │  "recurring|Days:(mon)@09-17::87283472::bread-v2"  │
                 │   └─── WHEN ──────────────┘  └─ WHERE ─┘  └ WHAT ┘ │
                 └─────────────────────────────────────────────────────┘
```

The `SpaceTimePlanKey` is the atomic unit of the search space. It uniquely identifies a _class_ of operation — "this type of work, at this scale of place, during this time pattern." The `SpaceTimePlanNode` is the instantiation (how many times, what flows). The `Plan` is the consistent global assignment of nodes.

---

## Plans as Alternative Timelines

Think of each `Plan` as a possible future — a deterministic timeline forked from the present. Two Plans that assign the same operations to the same cells at the same times are _the same timeline_ (same `plan_id` hash). Two Plans that differ in even one atom are different timelines.

The planner's search algorithm is:

```
1. FORK    — from the current state, generate all candidate 1-cell Plans at leaf resolution
2. EXTEND  — for each Plan, try adding compatible nodes from neighbouring cells
3. PRUNE   — discard dominated Plans (strictly worse SNLT, strictly fewer needs covered)
4. MERGE   — combine compatible Plans from adjacent cells into larger Plans
5. REPEAT  — move up one hex resolution; merged Plans gain visibility of cross-cell ops
6. SELECT  — from the Pareto front of global Plans, commit the best one
```

Each step is deterministic because `SpaceTimePlanKey` is canonical and `plan_id` is a hash of sorted keys. The same search on the same data always produces the same Plans in the same order.

---

## Merging: Where Substitutions Emerge

The key operation is `merge(planA, planB) → Plan | Conflict`.

```
Plan A (cell X, res 9):
  - wheat-milling @ cellX @ sun:08-12
  - outputs: 50kg flour
  - deficit: needs bread but no bakers

Plan B (cell Y, res 9):
  - [empty — no local resources]
  - deficit: needs 30 loaves of bread

merge(A, B) at res 7 (district):
  - wheat-milling @ cellX @ sun:08-12       [from A]
  - bread-baking  @ cellY @ mon:09-12       [NEW — became visible at res 7]
  - material edge: A's flour → B's bread-baking [NEW cross-cell flow]
  - B's bread deficit: SATISFIED
```

The bread-baking operation at `cellY` was not discoverable when the solver ran at `cellX` alone — it requires knowing about resources in `cellY`. The merge at the parent resolution is what makes the operation visible. The substitution is _emergent from the merge_, not pre-planned.

This is the "sometimes finding nice substitutions that wouldn't have been possible to see at a smaller scale" property — baked structurally into the merge operation.

---

## Determinism and the Plan Identity Hash

A Plan's identity is its content, not its construction path:

```ts
function computePlanId(nodes: SpaceTimePlanNode[]): string {
  const sortedKeys = nodes.map((n) => n.key).sort(); // canonical order
  return hash(sortedKeys.join("|"));
}
```

Two consequences:

1. **Cycle detection**: if the search re-generates a Plan already in the frontier (via a different merge path), the hash collision prevents re-exploring it
2. **Sub-plan recognition**: a Plan P is a sub-plan of Q if `P.nodes ⊆ Q.nodes`. You can check this by seeing whether P's hash appears as a confirmed prefix of any node in Q.

---

## Conflict Detection

Two Plans conflict if their node sets are _inconsistent_:

```ts
type Conflict =
  | { type: "double_commitment"; resource_id: string; cell: string }
  // same resource committed in both plans at same time
  | { type: "strategy_clash"; cell: string; time: string }
  // two incompatible strategies assigned to same address
  | { type: "material_imbalance"; product_id: string; shortfall: number };
// merged plan's inputs exceed its outputs + available stocks
```

If `merge(A, B)` produces a conflict, the two timelines are **incompatible** and cannot be unified — either one must be discarded, or the conflict must be resolved by introducing a new operation (e.g. import from a third cell) that bridges the gap.

---

## Scoring and Pareto Optimality

Plans are scored on two axes. There is no single "best" plan — there is a Pareto front:

```ts
interface PlanScore {
  total_snlt: number; // total socially necessary labour time — minimize
  needs_covered: number; // fraction of critical needs satisfied — maximize
  deficits: Array<{ product_id: string; gap: number }>;
  surpluses: Array<{ product_id: string; excess: number }>;
  resolution_depth: number; // how many hex levels contributed — higher = more coordination
}
```

**Dominated**: Plan A dominates Plan B iff A covers ≥ needs and uses ≤ SNLT. Dominated plans get pruned.

**Pareto front**: the surviving set of non-dominated plans. The human (or a policy function) picks from this front — e.g. preferring lower SNLT for routine plans, or maximising coverage for emergency planning.

---

## The Bottom-Up Loop Reframed

With Plans as first-class objects, the bottom-up loop becomes explicit:

```
leafPlans  = [ plan(cell) for each leaf cell at res 9 ]
              ↓ many tiny Plans, each covering one building

res8Plans  = mergeFrontier(leafPlans, resolution=8)
              ↓ Plans that span blocks; new block-scale operations appear

res7Plans  = mergeFrontier(res8Plans, resolution=7)
              ↓ Plans that span neighbourhoods; new shops/clinics visible

res5Plans  = mergeFrontier(res7Plans, resolution=5)
              ↓ Plans that span districts; regional logistics emerge

res3Plans  = mergeFrontier(res5Plans, resolution=3)
              ↓ Global plans; cross-country substitutions visible

selected   = selectFromParetoFront(res3Plans, policy)
             ↓ commit to Allocations
```

At each level, `mergeFrontier`:

1. Finds pairs of Plans whose cells are adjacent (within `gridDisk(cell, 1)`)
2. Attempts `merge(A, B)` — adds cross-cell operations that became visible
3. Prunes dominated results
4. Returns the new, larger Pareto front

---

## Small-Scale Correctness

Because a Plan at res 9 is a valid, complete, self-contained Plan (even if tiny), the system is fully functional at local scale. A single-commune deployment:

- Produces leaf Plans for each building
- Merges them at res 6-7 (neighbourhood/district)
- Selects from the resulting Pareto front
- Never needs to know about higher resolutions

The same code path, the same Plan type, the same merge logic — just fewer cells and a lower `rootResolution`. Scale is a parameter, not a structural difference.

---

## Relationship to Existing Types

| Existing type                                | Role in this model                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Strategy` (planner.ts)                      | source of `strategy_type_key` — defines the WHAT                                   |
| `FeasibleStrategy`                           | a candidate `SpaceTimePlanNode` (not yet committed)                                |
| `Operation` (stockbook.ts)                   | historical evidence that a strategy has been executed at a cell                    |
| `Commitment` (allocation.ts)                 | a `SpaceTimePlanNode` that has been committed to a Plan and written to Allocations |
| `LaborIndex` / `NeedIndex` / `ResourceIndex` | the inventory of WHAT EXISTS, queried during Plan construction                     |
| `getSpaceTimeSignature` (space-time-keys.ts) | produces the `SpaceTimeKey` component of `SpaceTimePlanKey`                        |
| `groupSlotsBySpaceTime` (space-time-keys.ts) | compresses the node set within a Plan before solving                               |

---

## What Needs to Be Built

1. **`SpaceTimePlanKey`** — extend `getSpaceTimeSignature` with a strategy type suffix
2. **`SpaceTimePlanNode`** — the atom: strategy + location + time + execution count + material flows
3. **`Plan`** — the timeline: `{ id, nodes, score, deficits, surpluses }`
4. **`mergePlans(a, b, resolution)`** — produces a new Plan or `Conflict`
5. **`planDominates(a, b)`** — Pareto comparison
6. **`mergeFrontier(plans, resolution)`** — one level of the bottom-up loop
7. **`selectFromParetoFront(plans, policy)`** — terminal selection
8. **Updated `plan()` entry point** — drives the loop from `leafResolution` to `rootResolution`

The existing `planner.ts` (`buildFeasibleSet`, `planFromNeeds`, `assemblePlan`) becomes the implementation of step 1 — generating leaf-level Plans at a single cell. Everything above is new.

---

## Parallelism: The Search Space Partitions Naturally

The `SpaceTimePlanKey` determinism is precisely what makes parallel execution correct — each worker produces a canonical output that can be merged with any other worker's output without coordination during computation.

### Leaf Level Is Embarrassingly Parallel

Each hex cell at res 9 runs its local solver with **zero coordination**. Each worker:

- Reads from the HexIndex (read-only after ingestion — no shared mutable state)
- Produces a Plan with a deterministic `plan_id` hash
- Emits that Plan to the merge layer

A city of 10,000 res-9 cells can run 10,000 solvers simultaneously. Two workers that independently produce identical Plans get the same hash — trivial deduplication.

### Merge Requires Only Neighbour Coordination

At each resolution level, a cell only needs to coordinate with its **6 hexagonal neighbours** (H3 always has exactly 6 adjacent cells). The coordination radius grows slowly as you ascend:

```
res 9  ██ ██ ██ ██ ██ ██ ██ ██  ← embarrassingly parallel, zero coordination
         ↓ merge with 6 neighbours only
res 7   ████   ████   ████      ← parallel within neighbourhoods
         ↓ merge with 6 neighbours only
res 5     ████████   ████       ← parallel within districts
         ↓ merge with 6 neighbours only
res 3          ████             ← few groups, near-serial
```

This maps cleanly onto **distributed computing topologies** — each worker is a node, channels are H3 adjacency edges. The topology is fixed by H3 geometry before any data is loaded, so workers can be pre-assigned.

| Resolution | Coordination scope    | Parallelism                                |
| ---------- | --------------------- | ------------------------------------------ |
| res 9      | None                  | Embarrassingly parallel — O(cells) workers |
| res 7-8    | 6 adjacent cells only | Parallel within `gridDisk(cell, 1)` groups |
| res 5-6    | District-scale groups | Parallel within regions                    |
| res 3-4    | Continental           | Near-serial, few large groups              |

---

## Bidirectional Search: Solving the Rare Resource Problem

For globally scarce resources (a specialist expert, a rare material, a piece of capital equipment), pure bottom-up search is inefficient — every local Plan marks the rare resource as a deficit until the very top level resolves it, paying the cost of all the intermediate merges first.

The fix is to run two traversals **simultaneously**:

**Bottom-up (local satisfaction):**
Leaf workers greedily satisfy what they can locally, raising deficits for what they cannot.

**Top-down (global pre-allocation):**
A separate root-to-leaf pass broadcasts known rare resources downward as "pre-allocated available." A commune that knows a specialist tool exists somewhere in the district receives that knowledge _before_ its local solver finalises, and can plan around it directly rather than generating a deficit.

```
Top-down broadcast:                Bottom-up solving:

res 3: "specialist lathe exists"   res 9: local Plans with deficits
  ↓ broadcast downward               ↑ deficits propagate upward
res 5: district receives signal    res 7: merge, new cross-cell ops visible
  ↓                                  ↑
res 7: neighbourhood aware         res 5: district Plans form
  ↓                                  ↑
res 9: cell plans around lathe   → MEET HERE: deficit resolved without
       without generating deficit      needing to reach root level
```

They meet in the middle — typically res 5-6 — where top-down allocations and bottom-up deficits converge. A bottom-up Plan that encounters a pre-allocated resource incorporates it directly instead of flagging a shortfall. The rare-resource pathology is eliminated without special-casing or global passes.

---

## Plans Are the Serializable Network Message

A `Plan` is just a set of canonically keyed strings with counts and scores — **no mutable pointers, no closures, no shared memory**. It serialises trivially:

```ts
// Ship a Plan to a neighbour over a network
const blob = JSON.stringify({
  plan_id: plan.id,
  nodes: plan.nodes.map((n) => ({ key: n.key, executions: n.executions })),
  score: plan.score,
  deficits: plan.deficits,
});
network.send(blob, neighbourWorker);

// Neighbour merges it with their local Plan
const received = deserialise(blob);
const merged = mergePlans(localPlan, received, currentResolution);
```

The `plan_id` hash prevents cycles — if a Plan blob arrives that's already in your frontier, the hash collision confirms it's been seen and it's discarded without re-computation.

---

## The Peer-to-Peer Economic Coordination Angle

In a peer-to-peer economic network, this isn't only about computational parallelism — it models **organisational parallelism**. Each commune or cooperative is an autonomous economic agent running its own planner. Economic coordination emerges from Plan-merging gossip among peers:

```
1. Commune A computes a local Plan → bread deficit of 30 units
2. A broadcasts deficit announcement to neighbouring communes
3. Commune B has a wheat surplus and spare baker hours
4. B proposes a merge: a bread-baking operation spanning both communes
5. Both evaluate the merged Plan; if accepted, it becomes their shared commitment
6. The merged Plan's deterministic `plan_id` serves as the coordination receipt
   — both parties can verify independently that the merger is valid
```

No central planner is required. Coordination emerges from bilateral Plan merging. The deterministic hash is what makes this **trustworthy in a p2p setting**: any participant can verify that a proposed merged Plan is a valid union of the claimed constituent Plans, without trusting the proposer's computation.

At larger scale, the same mechanism extends to federations of communes (res 5), regions (res 3), and beyond. Each federation layer runs the same merge protocol, just on coarser cells. The global plan is the emergent result of many bilateral merges — not a top-down assignment.

### Why the Hash Makes It Trust-Minimising

```
Commune A claims:  "my plan_id is X, covering these operations"
Commune B verifies: hash(sort(operations)) == X  → accept or reject

No trust required beyond the hash function.
Forgery is computationally equivalent to finding a hash collision.
```

This property extends naturally to cryptographic hash functions if a Byzantine-fault-tolerant variant is needed — the architecture doesn't change, only the hash function does.

---

## Efficiency Summary

| Scenario                  | Naive global pass       | Bottom-up Plans + parallelism                                        |
| ------------------------- | ----------------------- | -------------------------------------------------------------------- |
| Single commune, all local | O(S × N), serial        | O(S × N), same — leaf Plans only                                     |
| City, mostly local needs  | O(S × N_global), serial | O(S × N_local) × cells, parallel — **much faster**                   |
| Rare global material      | O(S × N_global), serial | Same plus merge overhead — bidirectional top-down resolves early     |
| National scale            | Infeasible (too large)  | Bounded by beam width K at each level — **tractable**                |
| Distributed / p2p         | Not applicable          | Naturally distributed; hash ensures correctness without coordination |

The system is more efficient precisely where real economies are structured — locally satisfiable needs dominate, cross-region coordination is the exception. For rare resources, bidirectional search eliminates the pathology. For large scale, beam search bounds the Pareto front size. The Plans-as-Timelines model is not just an algorithmic choice; it is a model of how decentralised economic coordination actually works.
