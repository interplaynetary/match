// Question given a resource-spec, what is the scope of planning for it?
// Especially: Dependent-supply -> Dependent-demands?

// Critical Path: is another scheduling algorithm that analyzes a network of processes to figure out the bottlenecks, the processes that need special attention.

# Planning Scope

> Planning scope is not a geographic question. It is a question about the structure of
> the supply graph for each ResourceSpecification: how are production nodes distributed,
> how well-connected are they to demand nodes, and how far must you traverse before
> finding enough supply?

---

## The Recipe Graph

Every ResourceSpecification sits somewhere in a directed recipe graph:

- **Terminal inputs**: no recipe in the current context produces this spec. It exists
  only as stock — already extracted, grown, or created — or as primary production
  capacity that must be activated.
- **Intermediates**: has both a recipe that produces it and recipes that consume it.
- **Final outputs**: demanded directly; no further recipe consumes it in this context.

"Terminal" is not absolute. It is **context-dependent**: a spec is terminal relative to
whatever re=cipes are loaded. Neodymium is terminal if the planner has no mining recipe.
If the planner has a mining recipe, neodymium becomes an intermediate with its own inputs
(mining equipment, energy, labor, land rights). The recipe store defines the planning
horizon.

This matters: **adding a recipe for primary production changes the planning scope for
all downstream specs**. A cooperative that can grow wheat changes the terminal boundary
for all bread-type specs. A community with solar panels changes the terminal boundary
for all electricity-consuming specs.

---

## Per-Spec Characteristics

Each ResourceSpecification has characteristics that together determine how to plan for it.
These are properties of the spec, not of the demand or the planner.

### Supply node distribution

How are the places that produce or hold this spec arranged in the world?

| Distribution     | Description                                                          | Examples                                                               |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Ubiquitous**   | Producible or holdable at essentially every node                     | General labor, sunlight, rainwater, sand                               |
| **Distributed**  | Many production nodes, spread across large regions                   | Wheat, timber, standard concrete, unskilled regional labor             |
| **Concentrated** | Few production nodes; specific geographic or institutional locations | Iron ore, coal, skilled specialists, licensed processing facilities    |
| **Singular**     | One or a handful of nodes globally                                   | Some rare-earth deposits, a specific patented process, a unique person |

Supply node distribution determines how far the planner must search before it expects to
find supply. For ubiquitous specs, any nearby node likely has supply; the search radius
is small. For singular specs, there is essentially one answer regardless of where the
demand is.

### Transport characteristics

Can this spec move between nodes? At what cost and constraint?

| Axis                   | Range                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Mobility**           | Immovable (site services, land) → costly to move (bulk ore) → standard logistics → frictionless (data, money) |
| **Network constraint** | Point-to-point logistics → requires specific infrastructure (cold chain, grid, pipeline) → unconstrained      |
| **Hazard constraint**  | Unrestricted → requires permits → special handling → prohibited across certain boundaries                     |

Transport characteristics define which edges exist in the supply graph. A spec that
exists at a nearby production node but cannot be transported to the demand node is
effectively as scarce as a spec with no nearby supply at all.

### Perishability

How long does this spec remain usable after production?

Perishability collapses the effective supply radius by imposing a maximum transit time.
The planning scope for a perishable spec is: **supply nodes reachable within the
perishability window**, regardless of geographic extent.

| Perishability                                    | Effective scope collapse                       |
| ------------------------------------------------ | ---------------------------------------------- |
| Seconds (electricity, live audio)                | Must be co-located or on a connected network   |
| Hours (fresh produce, hot food)                  | Immediate neighborhood or fast local logistics |
| Days (most fresh food, some pharmaceuticals)     | City-regional                                  |
| Months (grains, preserved foods, standard goods) | Continental                                    |
| Durable (metals, electronics, minerals)          | Global; perishability does not constrain scope |

Perishability and transport interact: a spec might be perishable in hours but remain
usable if kept under controlled conditions (cold chain). The effective perishability is
therefore a function of available handling infrastructure along the supply path.

### Fungibility

Can any instance of this spec substitute for any other instance?

| Fungibility        | Planning implication                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fully fungible** | Any supply node of the right spec satisfies the demand. The planner can use any path to any supply node. Optimize for proximity, cost, or lead time.                  |
| **Traceable**      | Instances are equivalent but tracked (batch, provenance, certification). The planner must record which specific stock is consumed, but can still choose among stocks. |
| **Unique**         | Each instance is distinct. The demand is for a specific resource, not just a spec. Planning means finding that specific resource.                                     |

Labor is a spectrum: "general labor hours" is fungible within a skill tier; a specific
named expert is unique. A recipe spec `spec:welding-certified` is traceable (any
certified welder satisfies it, but their certification must be checked).

### Substitutability across specs

A spec may be substitutable by a different spec in a given recipe context. If spec A can
replace spec B as an input to a recipe, there is an effective edge between A and B in the
supply graph. This changes the topology: the apparent scarcity of B is reduced by the
availability of A.

Substitutability is a property of the (spec, recipe, context) triple, not of the spec
alone. Neodymium magnets can sometimes be substituted by ferrite magnets at the cost of
performance; the substitution is valid in some recipes and not others.

Where substitutability exists, the planner should try the substitute path before declaring
a terminal node exhausted. This is an extension of the demand algorithm's fallback ladder.

---

## Supply Graph Topology as Planning Scope

The planning scope for a given spec is the **extent of the supply graph that must be
traversed before enough supply is found**. This is not geographic; it is a graph property.

```
Dense, local supply graph (ubiquitous spec):

  demand node ──── supply node (1km)
               ──── supply node (2km)
               ──── supply node (3km)

  Planning scope = small radius; any nearby node suffices.
  H3 hex at fine resolution captures this correctly.

Sparse, global supply graph (concentrated spec):

  demand node ──────────────────────── supply node A (continent away)
               ──────────────────────── supply node B (different continent)

  Planning scope = the entire world, but the answer is one of two nodes.
  H3 hex is irrelevant; the supply graph has only two relevant nodes.

Network-constrained supply graph (electricity):

  demand node ─── (grid edge) ─── relay ─── (grid edge) ─── generation node
               ─ (no grid edge) ─ X ─ nearby generation node (useless — not connected)

  Planning scope = connected component of the network.
  Geographic distance is irrelevant; network topology determines reachability.
```

The planner's job is always the same: **find a path in the supply graph from a supply
node to the demand node, for each spec in the demand tree**. The regional planner with
H3 hexes is one way to search that graph when the graph is well-approximated by geographic
proximity. It is not the only way.

---

## How Characteristics Combine: A Typology

| Supply distribution | Transportable | Perishable | Planning approach                                                                                                                                     |
| ------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubiquitous          | Any           | Any        | Local: use nearest supply node. H3 fine resolution.                                                                                                   |
| Distributed         | Yes           | No         | Regional supply chain: trace the nearest production cluster along logistics routes.                                                                   |
| Distributed         | Yes           | Yes        | Proximity-constrained: only distributed nodes within the perishability window count.                                                                  |
| Distributed         | No            | —          | Use nearest node in-place. Cannot route from elsewhere.                                                                                               |
| Concentrated        | Yes           | No         | Long-range trace: follow the supply graph to a specific production region, regardless of distance.                                                    |
| Concentrated        | Yes           | Yes        | Concentrated + perishable: either process it near the source or transform it into a durable form first. A separate planning subproblem at the source. |
| Concentrated        | No            | —          | Demand must go to the supply (co-location), not supply to demand.                                                                                     |
| Singular            | Yes           | No         | Secure commitment from the specific node. The planning question is availability and scheduling, not location search.                                  |
| Singular            | No            | —          | The demand can only be satisfied at the source. Everything upstream must be planned around that constraint.                                           |

---

## Terminal Nodes Are Not Dead Ends

When the planner reaches a spec with no recipe and no supply in the current search
context, it emits a signal (currently `purchaseIntent`). This is not a terminal state
for the overall planning problem — it is a **handoff to a different planning subproblem**.

That subproblem might be:

- **Primary production activation**: a recipe exists in the world (mining, growing,
  harvesting) but is not in the current planner's context. Adding that recipe expands
  the planning horizon and converts the terminal node to an intermediate.

- **Long-range supply chain trace**: the supply exists, but the planner's spatial scope
  was too narrow to find it. Expanding the scope (running a merge planner for a larger
  region, or running a supply chain trace along known logistics routes) may find it.

- **Capacity expansion planning**: no supply exists now but could be created — new
  production capacity, new infrastructure, new training programs. This is a
  longer-horizon planning problem that takes the current demand as an expansion signal.

- **Substitution search**: a different spec can satisfy the same functional role. The
  planner should try substitute paths before declaring the demand unmet.

- **Genuine scarcity**: none of the above applies. The spec is truly unavailable in any
  accessible context within the planning horizon. This is the only case where
  procurement/coordination with external systems is actually needed.

The current `purchaseIntent` conflates all five of these. A more structured signal
would carry enough information for the receiving system to determine which subproblem
applies.

---

## The Supply Graph Trace as a Universal Planning Primitive

Every planning problem — regardless of scope — reduces to the same operation:

```
For each demand node in the demand tree:
  1. Find supply nodes for this spec reachable within the planning context
     (context = recipe store + spatial/network scope + time horizon)
  2. If supply found: route it, record the commitment, continue
  3. If no supply found locally: check for a recipe that produces this spec
     → if recipe exists: plan the recipe's inputs (recurse)
     → if no recipe: try substitutes
     → if no substitute: emit a "cannot plan this spec in this context" signal
```

The "planning context" is what varies. For proximity-bound specs it is a spatial radius.
For network-bound specs it is a connected component. For globally concentrated specs it
is the set of known production nodes worldwide. For specs with primary-production recipes
it includes those recipes.

**The scope question is always: what is the right planning context for this spec?**

The answer comes from the spec's characteristics:

- Supply node distribution → how wide the search must be
- Transportability → whether distance is meaningful or network topology is
- Perishability → the maximum time horizon (and thus maximum reachable scope)
- Recipe context → whether the search can expand through production

---

## Structural Properties of the Recipe Graph Relevant to Planning

### Fan-in: how many specs does this recipe require?

High fan-in recipes (many distinct input specs) are more exposed to supply disruption —
any one missing input blocks the recipe. Each input has its own supply characteristics.
Planning for high fan-in is more complex; the planner must find supply for all inputs
simultaneously.

### Fan-out: how many different recipes can produce this spec?

High fan-out (multiple production paths) means scarcity of one production path can be
routed around. Low fan-out (single recipe or no recipe) means the spec is fragile.

### Depth: how many recipe steps from terminal inputs?

Deeply nested specs are exposed to disruption at every level. The planning problem for
a deep spec is a coordination problem across many layers — each layer with its own
supply graph topology and planning scope.

### Bottleneck nodes

A spec is a **bottleneck** if it appears as an input to many recipes and has concentrated
or singular supply distribution. The planning system should flag bottleneck specs as
high-priority planning concerns — their availability constrains many other specs.

Rare-earth minerals are classic bottlenecks: concentrated supply distribution × high
fan-out (they appear in many different product recipes). Any disruption propagates widely.

### Shared inputs

When two different demand trees share a terminal or intermediate input, their planning
is coupled. Planning them independently (as separate regional planners) risks
over-claiming the shared input. This is exactly the conflict that the merge planner
resolves — but it applies at every level of the demand tree, not just at the inventory
level.

---

## Implications

**Planning scope is a per-spec question, not a per-region question.** A single planning
invocation may need to apply different scopes to different specs in the same demand tree.
For labor it searches within a few kilometers. For rare earths it identifies specific
global supply nodes. For electricity it queries network connectivity.

**The recipe store is the planning horizon.** Extending the recipe store (adding primary
production recipes, adding transport recipes, adding substitution mappings) expands the
planning horizon without changing the planning algorithm. The planner always does the
same thing; what changes is how far the graph extends.

**The `purchaseIntent` signal needs more structure.** It currently says "I couldn't find
this spec." It should say _why_: no supply in scope, no recipe, no substitute, capacity
not yet built, or genuinely scarce. Each case calls for a different response from the
receiving system.

**Bottleneck specs should be planned first.** In the dependent demand tree, specs that
are shared by many sub-trees and have concentrated supply should be secured before specs
with abundant local supply. Priority by D-category addresses demand-side priority; a
complementary supply-side ordering addresses supply fragility.
