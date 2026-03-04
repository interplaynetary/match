Conflicts and Inconsistencies

1. "Evenly distributed sacrifice" vs. strict priority  
   retraction — conceptual conflict  


Design Goals (local/global inversion paragraph):
"attempting to distribute the load of net-sacrifice evenly:
sacrifice determined by independent demand priority"

Planner Spec (Backtrack + Surgical Resolution): "retract in
reverse priority (lowest D-category first, latest due date
first within category). Stop retracting as soon as freed
capacity resolves each contention."

These are two different optimization criteria. "Distribute
evenly" implies proportional burden-sharing across demands
of similar priority. "Retract lowest D-category first, stop
as soon as freed" is greedy and concentrates sacrifice
entirely on the lowest-priority demands. The greedy
approach minimizes the count of sacrificed demands, but
distributes sacrifice maximally unequally. If the intent is
that people bearing the same priority should share
sacrifice proportionally, the spec fails to implement that.

The phrase "sacrifice determined by independent demand
priority" in the design goals could be read as "priority
determines the ordering of who bears sacrifice" — which
aligns with the spec — but then the word "evenly" becomes
misleading. The two readings need to be made explicit and
one chosen.

---

2. Observer mergeability — stated requirement with no
   design

Planner Spec (PlanStore section): "Observer must also be
mergeable across regions — the same compositionality that
applies to PlanStore applies to the observation layer
beneath it."

This is stated as a requirement, but:

- No merge protocol is defined anywhere in the spec
- Observer is currently a single shared append-only event
  log per invocation
- The design goal says planners "operate completely
  independently and simultaneously" — if each leaf has its
  own Observer (necessary for true independence), those
  observers need a merge protocol before a merge planner can
  initialize its PlanNetter from the combined actuals

This is the most architecturally significant gap. The
design goal of massive parallelism implies distributed
Observers; the spec acknowledges this but defers the entire
design. Without this, the "leaf planners share nothing"
guarantee (stated in Key Properties) cannot be true — they
all share the same Observer instance.

---

3. Backtracking loop creates an implicit re-derivation
   requirement — spec incompleteness

Phase 3 sequence:

1. Pass 1 → consumption records
2. Compute endogenous replenishment demands from Pass 1
   consumption
3. Pass 2 (derived demands) → metabolicDebt if capacity
   insufficient
4. Backtrack: retract Pass 1 subgraphs, re-explode
   retracted demands

After step 4, the re-exploded Pass 1 demands produce
different consumption records than the original Pass 1 did.
Those different consumption records mean the endogenous
replenishment quantities computed in step 2 are now stale.
The spec says "Re-explode retracted demands against newly
freed capacity — their shortfall becomes unmetDemand[]" but
never says: do you then recompute derived demands and
re-run Pass 2?

If you don't, the metabolicDebt calculation is based on
consumption patterns that no longer match the plan. If you
do, you have an iterative loop with no guaranteed
termination condition stated. Either way the spec is
incomplete here.

---

4. Derived demands skip Phase 2 spatial classification —
   silent gap

Phase 1 extracts slots from the H3 index. Phase 2
classifies each slot: locally-satisfiable |
transport-candidate | producible-with-imports |
external-dependency. This classification determines whether
the planner tries local supply first or routes transport
recipes.

Pass 2 derived demands are computed after Phase 1 and Phase
2 have run — they bypass both. They land directly in Phase
3 with no spatial classification. A replenishment demand
for soil nutrients (classic example in the doc) might
require transport from another region, but it will never be
classified as a transport-candidate — it'll be planned
against local supply only, and if that fails it becomes
metabolicDebt without having tried inter-region resolution.

This is a systematic bias: derived demands are harder to
satisfy than the spec implies, because they lack the
spatial routing that independent demands receive.

---

5. "Exponential residual reduction" vs. full PlanStore scan
   — design claim vs. spec behavior

Design Goals: "exponential residual reduction (meaning that
at each level we try to only deal with the smallest
possible scope we need to resolve conflicts)"

Conflict Detection (Merge Planner): "Scan merged PlanStore
after formulation."

The scan is over the entire merged PlanStore — which
contains all leaf allocations from all sub-regions. The
"smallest possible scope" would be scanning only the
records on the dependency path of the newly added
inter-regional demand, not the full store. Surgical
Resolution does narrow the resolution to the dependency
path, but detection is still global.

For a claim of exponential residual reduction to hold,
conflict detection itself would need to be bounded to the
intersection of the new inter-region demand's dependency
graph and existing allocations. The spec says "Resolution
is surgical" but doesn't make the same claim about
detection.

---

6. "Administration demands" classification inconsistency —
   two contradictory definitions

In the General Process Draft Specification, administration
demands are listed under "Derived Dependent demands": they
emerge from the plan, computed from consumption records.
The passage reads: "Administration demands (classifiedAs)
for Plan coordination & enforcement of resource
usage-rights & responsibilities in accordance with Plan."

But in the implementation layer (memory, D-category
system), administration is D4-Administration — a
pre-existing independent demand category, sorted alongside
D1/D5/D6 in Pass 1. This means coordination resources
(office tools, communication infrastructure, delegate time)
are treated as pre-existing desires, not as endogenous
outputs of planning.

These are genuinely different semantics. If administration
demands are derived (emerge from the plan's scope), they
belong in Pass 2 alongside replenishment. If they are
independent (a commune has standing resource needs for
coordination regardless of what is being planned), they
belong in Pass 1 at D4 priority. Both are defensible
positions, but the document holds both simultaneously
without acknowledging the tension.

---

7. "Derived Independent Demands" have no technical pathway

General Process Draft Specification introduces: "Derived
Independent demands: derived from network data. For
example: food/nutritional demand in a region as a function
of population density/age."

The Planner Process Draft Technical Specification never
mentions these. Phase 1 (Extract) loads slots from
IndependentDemandIndex, but who computes the
nutrition-from-population-density demand and inserts it
into that index? There is no Aggregator, Derivation Engine,
or preprocessing step described. The General Process
section introduces this category but the Technical
Specification treats all independent demands as
pre-existing user-submitted slots.

This is not a contradiction per se — it could be an
intentional deferral — but it means a significant portion
of the design goal (planners working from derived
population-scale needs rather than individually-submitted
demands) has no technical pathway in the current spec.

---

8. D-category priority vs. SNE minimization objective —
   ordering tension

The objectives list includes both:

- "Maximize Independent Demand satisfaction (ranked by
  criticality)"
- "Minimize Total Socially Necessary Effort (SNE)"

Phase 3 sorts demands by D-category then due date, and for
each demand picks the recipe via SNE ranking. But
D-category ordering means a D1 demand is always planned
before D5 — even if the D1 demand consumes a high-SNE
recipe that blocks three low-SNE D5 demands. The total plan
SNE may be higher than if demands were ordered
differently.

The spec treats these two objectives as non-competing
(priority ordering for which demand gets planned; SNE
ranking for which recipe serves it). But they interact:
planning order determines what capacity is left for
subsequent demands, which affects which recipes are
feasible, which affects total SNE. The design goal implies
SNE minimization is a global objective, but the spec only
applies SNE locally (per recipe selection), not globally
across the demand ordering.

---

Summary by severity

┌─────┬─────────────────────────────┬──────────────────┐
│ # │ Issue │ Severity │
├─────┼─────────────────────────────┼──────────────────┤
│ 2 │ Observer mergeability │ Architectural │
│ │ required but not designed │ gap │
├─────┼─────────────────────────────┼──────────────────┤
│ │ Backtracking loop may │ │
│ 3 │ require iterative │ Spec incomplete │
│ │ re-derivation of Pass 2 │ │
├─────┼─────────────────────────────┼──────────────────┤
│ │ "Evenly distributed │ Conceptual │
│ 1 │ sacrifice" vs. greedy │ conflict │
│ │ priority retraction │ │
├─────┼─────────────────────────────┼──────────────────┤
│ │ Administration = derived │ Definitional │
│ 6 │ (spec text) vs. independent │ conflict │
│ │ (implementation) │ │
├─────┼─────────────────────────────┼──────────────────┤
│ 4 │ Derived demands skip │ Silent │
│ │ spatial classification │ behavioral gap │
├─────┼─────────────────────────────┼──────────────────┤
│ 7 │ Derived Independent Demands │ Scope gap │
│ │ have no technical pathway │ │
├─────┼─────────────────────────────┼──────────────────┤
│ │ Full PlanStore scan vs. │ Design claim │
│ 5 │ "smallest possible scope" │ tension │
│ │ claim │ │
├─────┼─────────────────────────────┼──────────────────┤
│ 8 │ SNE minimization applied │ Objective-scope │
│ │ locally, not globally │ mismatch │
└─────┴─────────────────────────────┴──────────────────┘

✻ Sautéed for 3m 1s
