---
Test suite: 125 passing across 14 files.

Where would you like to go next? Options:
  - Continue writing tests for untested modules (spatial
    indexing, space.ts H3 utilities, observer advanced scenarios,
    integrated-planner.ts)
  - Fix the Commitment.satisfies bilateral schema
  - Apply the observer action bugs from the plan file (implied
    transfer double-applies, copy location bug)
---

How do we deal with time horizons? and metabolism?
// I suppose we must make our algorithm:

- prioritize creating a more sustainable metabolism over time.
- so if short term desire, leads to long term depletion, we favor strategies that:
  - make metabolism more sustainable over time
  - even if it means present needs are not fully met
  - although what happens if we cant make metabolism more sustainable without depleting all our current resources to the point of having no future at all?

---

Fully formulate metabolic planner.

Independent demands and recipes are the entry point to the planning problem.

Dependant Demands arise from composing recipes to satisfy independent demands.

- This corresponds also to expansion of production.

Derived Dependant Demands: Replenish net-loss of resources (including natural) up to desired-levels.

Derived Dependant Demands: make sure reserves (for all demands (dependant/independant)) are not planned to be consumed, they are the buffer!
classifiedAs reserves are not to be touched unless in emergency.

When surplus-reserves: carry-over to next period - as economic resource?.

Primary Objective: Maximize need satisfaction
Primary Constraint: Maximize metabolism sustainability over time
Secondary Constraint: Minimize SNLT

---

Solve Independent Demands
Identify Reserve Demands
Additional Operations

---

**Core Principles**
Independent demands (stock-levels across space-time) are the entry point—the reason we plan
Recipes define how to transform resources to satisfy demands
Dependent demands emerge from composing recipes (this is production expansion)

- Replenishment demands (classifiedAs) restore net-losses created by the plan (up to - if specified - desired stock levels)
- Reserves/buffers (classifiedAs) are untouchable except in emergency

**Planner Nested Optimizations**
Maximize need satisfaction (ranked by criticality)
Maximize metabolic sustainability (replenishment demands) over time
Satisfy Reserve/Buffers across space-time
Minimize SNLT (socially necessary labor time)

**Planner Recursion**
Given most critical independent demand: create a plan, solving for fixed point of metabolic sustainability.
If fixed point is not satisfied in X iterations:

- start other branch in search-space.
- if no other branch: fail.
  If Satisfied:
- repeat adding next most critical independent demand, replacing subgraphs of plan to satisfy all constraints:
  - metabolic sustainability
  - reserve/buffer satisfaction
  - SNLT minimization
    If Failure:
    - roll back to previous plan

**This transforms "sustainability" from a vague goal into a computable property: a plan is sustainable if and only if all its replenishment demands can be satisfied without generating new replenishment demands that cannot be satisfied, recursively.**

The planner must check: can replenishment demands themselves be met sustainably? This creates a fixed-point condition:

A plan is sustainable iff:

- ∀ resources consumed:
  - replenishment_demand is itself satisfiable
  - AND that replenishment's replenishment is satisfiable
  - AND ... (recursively)

This is a recursive constraint system. The fixed point is the set of resource flows that can be sustained indefinitely without drawing down stocks or breaching reserves.

---

11. Transform Search Space Representation

Instead of:

Recursive plan construction

Use:

AND-OR graph with memoized subproblem values.

This turns exponential recursion into dynamic programming when substructure repeats.

---

1. Contractive Behavior
   The system converges if each level of replenishment demands strictly less than the previous level:

text
replenishment*demand(r_n) < replenishment_demand(r*{n-1}) × α
where α < 1
This happens naturally if:

Recipes have efficiency gains (output > input in SNLT terms)

Processes have feedback loops that regenerate more than they consume

There's technological improvement over time

The Fixed Point Iteration
Your algorithm implicitly performs:

text
x*{t+1} = A x_t + d_t
s*{t+1} = update*sustainability(x_t)
Check: x*{t+1} ≤ s\_{t+1}
This is a fixed point iteration that converges if the spectral radius ρ(A) < 1—meaning each production cycle requires less total resources than it produces.

Time-to-desired-stock-levels:
i.e. when C02 reaches certain level.

---

How do we approach subgraph replacement?

---

Lets implement Index pipeline:

- hex-layers:
  - select hexes: name

- translation schema

---

Our dependent supply seems to be spec based? but it should be economic-resource-based? so as to be location aware right?

---

VSM?

---

BowTie
