# The Planning System — Plain English

## What the system does

Given a map of **what people want**, **what already exists**, **who can work**,
and **how to make things**, the system figures out the best production schedule
and where to put it.

It doesn't just produce one answer. It searches through many candidate
schedules in parallel — one per neighbourhood — then combines them and picks the best.

---

## The five ingredients

### 1. Demand — what people want

Each open need is an **Intent**: "I need 10 loaves of bread by Friday at cell
87283472". A list of Intents is indexed by geographic cell and resource type
into an **IndependentDemandIndex** so the planner can ask "what does this
neighbourhood need?" without scanning everything.

### 2. Inventory — what already exists

The **Observer** holds a live snapshot of all economic resources. You can ask
it "how many kg of flour exist within this cell?" before deciding whether to
produce more or just use what's there.

### 3. Labour — who can work

Every person who can contribute posts a `work` Intent: "I can give 8 hours of
baking skill on Monday at this location." The **AgentIndex** collapses all
these Intents into one record per _(person, time-window)_ pair, so summing
available hours is safe and doesn't double-count people who listed multiple
skills.

### 4. Recipes — how to make things

A **Recipe** is a template: a chain of **RecipeProcesses** (steps), each with
input flows (materials and work) and output flows (products). The
**RecipeStore** holds all known recipes and can tell you the full process chain
for any recipe, and all the flows for any step.

### 5. D-series priorities — what matters most

Not all needs are equal. Resources are tagged with a **D-category**:

| D   | Name                | Meaning                                                                             |
| --- | ------------------- | ----------------------------------------------------------------------------------- |
| D1  | Means of Production | Tools, equipment — must be maintained to keep producing anything                    |
| D3  | Insurance           | Safety buffer — planned last, on top of everything else                             |
| D4  | Administration      | Coordination resources                                                              |
| D5  | Consumption         | Common everyday needs (the bulk of demand, default)                                 |
| D6  | Support             | Supporting infrastructure                                                           |
| D2  | Expansion signal    | Not planned — emitted when we can't meet demand, signals need for new D1 investment |

The planner processes them in this order: **D1 → D4 → D5 → D6 → D3**.
D1 first because if tools aren't maintained, nothing else can be produced.
D3 last because it's a buffer on top of everything already planned.

---

## The planning pipeline (per neighbourhood cell)

For each H3 leaf cell (roughly 0.1 km²) with open demand, the system runs
four phases:

### Phase 1 — Forward pass: what can we make?

For every recipe in the catalog, check whether we _could_ run it given current
inventory and labour. This produces a **feasibility envelope** per recipe:

- `maxByMaterial` — how many times the recipe can run before we run out of inputs
- `maxByLabor` — how many times we can run it given available work hours
- `snltPerUnit` — how much labour time each output unit costs (lower = more efficient)

Recipes are sorted by `snltPerUnit`. The most labour-efficient recipe gets
tried first. This is the **forward pass** — it scans outward from current
resources to see what's reachable.

### Phase 2 — Backward pass: what do we need to make?

Starting from the open demands (D1 first, then D4, D5, D6, D3), work
backwards:

1. Can we satisfy this demand from existing inventory? Use it first.
2. If not, pick the most efficient feasible recipe and run it as many times
   as needed.
3. That recipe consumes inputs. If those inputs aren't in stock, recurse: they
   become new sub-demands. (This is "dependent demand" — the supply chain
   unfolds automatically, up to 10 levels deep.)
4. If demand still can't be met after trying all recipes, emit a **D2
   expansion signal** — a note saying "we need more capacity here".

The output is a list of **selected recipes** — each one knows how many
executions to run, for what quantity, and _which Intent it's satisfying_.
That last part matters for scoring later.

### Phase 3 — Build the recipe graph (in-memory, no commits yet)

For each selected recipe, call `buildRecipeGraph()`. This creates plain
**Process** and **Commitment** objects in memory — no writes to any store.

A **Process** is one scheduled production step: a name, a start time, an end
time. A **Commitment** is a scheduled flow attached to that process: "input 5 kg
flour into this baking step by 09:00 Monday", or "output 10 loaves from this
step by 10:00 Monday".

The primary output Commitment gets a `satisfies` field pointing back to the
original Intent. This is the link that the scoring step follows to count how
many needs are actually addressed.

### Packaging — wrap in a Scenario

All the Processes and Commitments from this cell are bundled into a
**Scenario**: a candidate plan that hasn't been committed to anything yet.

The Scenario gets a **deterministic ID** — a hash of all its Commitment
signatures (what, where, when). Two independent workers processing the same
inputs will produce the exact same ID. This makes the search safe to
parallelise without coordination.

Then the Scenario is **scored**:

- `intents_satisfied` — how many of the open Intents now have a `satisfies`
  link from a Commitment
- `total_effort_hours` — total labour cost across all Commitments (≈ SNLT)
- `deficit_specs` — which resource types still have no satisfying Commitment

---

## The space-time search

### Why H3 cells?

The map is divided into a hierarchy of **H3 hexagonal cells**. Resolution 9 is
roughly a neighbourhood block. Resolution 3 is a large region. The system
searches from fine to coarse, which means it tries to satisfy demand locally
first and only reaches further out when local capacity is insufficient.

### ScenarioIndex — the search tree

All Scenarios are stored in a **ScenarioIndex**: a tree where each node is
addressed by _(H3 cell, process type)_. When a Scenario is added to the index,
its stats (intents satisfied, effort hours, deficits) bubble up from the leaf
cell to every ancestor cell all the way to the root. This gives you an
aggregated view of planning quality at any resolution without scanning
everything.

// process type?????? Im unsure this is what we should actually be indexing? i though the scenario of a plan? that could contain thousands of processes

### Merge — combining adjacent Scenarios

A Scenario for one block may have a surplus (more bread than the block needs)
while an adjacent block has a deficit (not enough bread). The **merge step**
connects them:

1. Find each deficit in Scenario A that matches a surplus in Scenario B.
2. Create a pair of **transfer Commitments**: B produces and hands off, A
   receives. The receiving Commitment gets `satisfies → deficit.intent_id`.
3. Return a new merged Scenario combining both sets of Processes and
   Commitments, with the deficit removed.

The merged Scenario also gets a deterministic hash — same content, same ID,
regardless of who merged it.

This is done level by level — res 8, then 7, then 6, ... down to res 3. At
each level, the system tries to merge every pair of Scenarios that share a
parent cell. After each level, dominated Scenarios are pruned (see below).

// i mean its good to redistribute intents sure, but i thought the point was also to find the best plan? that includes maybe substituting operations in the larger scenario that are more efficient

### Pareto pruning — keeping only the best candidates

A Scenario **dominates** another if it satisfies _at least as many Intents_
with _at most as much labour_. Dominated Scenarios are dropped from the
frontier at each merge level. This keeps the search tractable — you never
need to keep more than a handful of candidates per region.

The **Pareto front** is the set of Scenarios where no one dominates another.
These are the genuinely different tradeoffs: higher coverage vs lower cost.

### globalParetoFront — the final answer

After all merge levels, `globalParetoFront()` over the entire index gives the
non-dominated Scenarios. The caller picks the winner from this set (by policy —
e.g. "highest coverage" or "lowest effort") and passes it to `promoteToPlan`.

---

## Promoting the winner to a Plan

Up to this point, nothing has been written to any store. The winning Scenario
is a collection of plain in-memory objects.

`promoteToPlan` does three things:

1. **Register Processes** into the ProcessRegistry (shared store). Skips any
   that are already there (idempotent).
2. **Register Commitments** into PlanStore. Same idempotency.
3. **Create the Plan record** and stamp `plannedWithin = plan.id` on every
   Process and Commitment. This is what binds the Scenario to a committed Plan.

After this step, the Processes and Commitments are live VF objects — they can
trigger Events, be observed, and contribute to the next planning cycle.

---

## The boundary: Scenario vs Plan

|               | Scenario                   | Plan                                |
| ------------- | -------------------------- | ----------------------------------- |
| State         | In-memory, never persisted | In PlanStore                        |
| Processes     | No `plannedWithin`         | `plannedWithin = plan.id`           |
| Purpose       | Being evaluated            | Committed agreement                 |
| Identity      | Hash of its Commitments    | planId                              |
| Can be merged | Yes                        | No                                  |
| Discardable   | Yes — losers are dropped   | No — must be fulfilled or cancelled |

The search only ever creates Scenarios. A Plan is created exactly once —
when `promoteToPlan` is called on the winner.

---

## Summary in one paragraph

The system takes a map of open needs, existing stock, available labour, and
production recipes. For each neighbourhood cell it runs a two-pass planner:
forward to compute what's feasible, backward to select the minimum necessary
production in priority order. Each cell's result is packaged as a Scenario — a
candidate plan with a content-addressed ID and a Pareto score. Scenarios from
adjacent cells are then merged bottom-up through the H3 hierarchy, at each
level creating cross-cell transfer Commitments to close local deficits from
neighbouring surpluses. After pruning dominated Scenarios at each level, the
remaining Pareto front is the set of genuinely distinct tradeoffs between
coverage and labour cost. The caller picks the best one and promotes it —
writing Processes, Commitments, and a Plan record to the store for the first
and only time.

// i wonder do our plans operate only on existing stock or do they use observer logic to simulate production of new hypothetical stock?
