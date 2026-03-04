we have independent supply
and independent demand

we have recipes

we have dependent supply
and dependent demand

some resources (independent/dependent)
are demanded (independent/dependent)
and source and sink are often separated across space and time

some (independent/dependent) demands are more critical than others.

- lexicographic ordering (most critical of 1, for that layer: 2, 3, and 4, repeat till max-independent-demand satisfaction)
- Level 1(needs) > Level 2 (replacement) > Level 3 (buffers) > Level 4 (admin)

META-LEVEL: SYSTEM VIABILITY
├── Ensure the coordinating mechanism itself persists
├── Monitor for collapse conditions
├── Trigger emergency protocols when needed
└── Overrides all other priorities in extremis

LEVEL 1: CRITICAL NEEDS
├── That which prevents immediate death or severe suffering
├── But only within system viability constraints
└── May be deferred if system collapse is imminent

LEVEL 2: SYSTEM REPRODUCTION
├── Replacement of what's used
├── Maintenance of productive capacity
└── The seed corn, the irrigation admin, the tool repair

LEVEL 3: BUFFERS AND RESERVES
├── Protection against known uncertainties
├── But only after system reproduction is secure
└── May be drawn down in crisis

LEVEL 4: NON-CRITICAL NEEDS
├── Wants, comforts, conveniences
└── After everything else is secure

LEVEL 5: ADMINISTRATION
├── Record-keeping, coordination, governance
├── But note: some admin IS system reproduction
└── Separate only when truly overhead

INDEPENDENT DEMANDS:
Level 1: Needs of all kinds (independent demand)
→ Time horizon: as they arise
→ Ordered by criticality

DEPENDENT DEMANDS:
Level 2: Replacement of used resources (maintenance)
→ Maintain desired future states
→ Time horizon: ongoing, perpetual

Level 3: Surplus/reserves/buffers
→ Available _at_ demand-satisfaction time
→ Time horizon: demand-dependent (T0 + lead time)

Level 4: Administration costs
→ Enforcing use-rights/responsibilities (magnitude proportional to magnitude of risk/harm of violation)
→ Time horizon: continuous overhead

- WHILE (independent demand not satisfied):
  - start with most-critical-need (level 1)
  - attempt solve,
  - solve for replacement (level 2)
  - solve for buffers (level 3)
  - solve for admin (level 4)
  - substitute processes to min total-SNLT
    REPEAT UNTIL satisfied with next-most-critical-demand

---

resources = available_resources
constraints = {
needs: minimum_required to prevent death,
replacement: minimum_required to reproduce system,
buffers: minimum_required for known risks,
admin: minimum_required for coordination
}

if sum(constraints) > resources: # Can't meet all minimums # This is the WORST CASE
trigger_emergency_protocol() # Possible protocols: # - rationing (everyone shares scarcity) # - triage (some needs unmet) # - external aid
else: # Allocate resources to meet all minimums # Then distribute surplus by priority

---

(Common satisfaction of needs, are processes)

---

Risk is always the risk of the (dependent/independent) demand not being satisfied.

- distribute replicated process across space and time
- surplus/reserves of resources distributed across space-time

We keep track of socially necessary labor time required for all resources (value rollup). Deriving averages. Keeping historic record of where/when/how much of what kinds (resource-specs) created. (Keeping track of where/when how much, helps us understand where certain processes are more or less efficient)

For each resource produced:
Direct labor = time spent in this process
Indirect labor = sum(SNLT of all inputs)
Total SNLT = direct + indirect

Record: (timestamp, location, spec, quantity, total SNLT)

For each resource consumed:
Record which specific stock was used (if traceable)
Or average across available stock (if fungible)

Historical aggregates:
By spec: average SNLT over time
By location: productivity differences
By process: efficiency variations
By time: seasonal/cyclical patterns

For each demand node:
Find reachable supply within context
If found → route and commit
Else if recipe → recurse on inputs
Else if substitute → try substitute path  
 Else → emit structured "cannot plan" signal

Why? Instead of just "purchaseIntent":
| Signal Type | Meaning | Response |
|-------------|---------|----------|
| **No supply in scope** | Supply exists, search was too narrow | Expand scope, trace logistics routes |
| **No recipe** | Primary production possible but not modeled | Add recipe, activate capacity planning |
| **No substitute** | Different spec could work | Try substitution paths |
| **Capacity not built** | Production possible but doesn't exist yet | Investment planning |
| **Genuinely scarce** | Truly unavailable | External procurement, redesign |

RISK:

- **Known-knowns**: We understand the risk and can plan for it
- **Unknown-knowns**: We understand the risk but can't plan for it
- **Known-unknowns**: We know the type of event but not when/if (earthquakes, disruptions)
- **Unknown-unknowns**: Emergent, unpredictable changes

EXTENDED DISORDER FAMILY:
The Extended Disorder Family (or Cluster): (i) uncertainty, (ii) variability, (iii) imperfect, incomplete knowledge, (iv) chance, (v) chaos, (vi) volatility, (vii) disorder, (viii) entropy, (ix) time, (x) the unknown, (xi) randomness, (xii) turmoil, (xiii) stressor, (xiv) error, (xv) dispersion of outcomes, (xvi) unknowledge.” ~Nassim Taleb, Antifragile

## Robust HEURISTICS for Antifragility

- **convexity-first**: prioritize improving payoff structure over knowledge acquisition
- **diversification:** spread resources across many small trials rather than few large ones
- **barbell-strategy:** 90% capacity directed to robust/stable progress, 10% spread across antifragile experimentation
- **serial-optionality**: maintain flexibility with short-term plans and frequent exit points
- **negative-knowledge**: learn from failures and document what doesn't work
- **opportunistic-adaptation**: invest in agents who can pivot and exploit opportunities
- **non-transferable antifragility:** do not allow antifragility to be transferred at the cost of the fragilization of others.

We want to design our Antifragile Planner to be able to handle the Extended Disorder Family.

- **Supply Volatility**:
- **Demand Volatility**:
- **Bullwhip effect**: Small changes in final demand amplify as they propagate upstream—relevant to your point about bottlenecks and shared inputs.

Bullwhip:
Original (Level 4 needs first, now Level 1):
Need increase (Level 1)
→ Replacement demand increases (Level 2)
→ Buffer demand increases (Level 3)
→ All upstream inputs multiply through recipe graph

SNLT tracking becomes a sensor network for detecting bullwhip patterns. When you see certain amplification signatures, you know to add buffers at specific echelons.

...

---

## Established Fields and Concepts That Address Your Problem

### Graph-Based Supply Chain Network Analysis

**Core concept**: Suppliers, production facilities, warehouses, and customers are **nodes**. Material flows, transportation routes, and dependencies are **edges**. The graph structure reveals properties your analysis identified :

| Graph Concept                        | Maps to Your Analysis                                                       |
| ------------------------------------ | --------------------------------------------------------------------------- |
| **Pathfinding** (BFS, DFS, Dijkstra) | Tracing dependent demand upstream from final product to raw materials       |
| **Topological sort**                 | Determining production order when outputs become inputs to later processes  |
| **Betweenness centrality**           | Identifying bottleneck nodes that lie on many supply paths                  |
| **Maximum flow**                     | Finding whether supply can actually reach demand given capacity constraints |
| **Minimum spanning tree**            | Optimizing infrastructure connections between nodes                         |

A 2025 study using graph algorithms on supply chains showed significant improvements: 25% reduction in transportation time, 20% lower logistics costs, and 40% reduction in bottlenecks . This isn't theoretical—it's being deployed.

### 3. Bill of Materials (BOM) Explosion and Implosion

This is manufacturing's classic formulation of your problem.

**Core concept**:

- **BOM explosion**: Starting with a finished product, recursively determining all components and raw materials needed (your demand propagation)
- **BOM implosion**: Starting with available materials, determining what finished products can be made (your supply availability)

**What it contributes**: MRP (Material Requirements Planning) systems have dealt with dependent demand for decades. They handle:

- Lead time offsets (materials must arrive before production)
- Lot sizing rules (you can't order fractional batches)
- Safety stock at each level

**What it misses**: Geographic distribution, transport constraints, and perishability. Classic MRP assumes you can move anything anywhere at standard cost.

### 4. Supply Chain Network Design

This field addresses exactly your "scope" question: given demand at point A, where should supply come from ?

**Core concept**: Optimizing the configuration of the supply chain—which plants produce what, which warehouses serve which customers, which suppliers feed which plants.

**Decision levels** :

- **Strategic**: Where to locate facilities (long-term)
- **Tactical**: How to allocate production and inventory (medium-term)
- **Operational**: Routing and scheduling (short-term)

Your planning problem spans all three: finding supply nodes (strategic), committing their output (tactical), and routing to demand (operational).

### 5. Perishable Inventory Theory

This directly addresses your perishability dimension.

**Core concept**: Inventory loses value over time—either completely (spoilage) or gradually (quality decay). This creates a **maximum allowable transit time** between supply and demand .

**Key models**:

- **Fixed lifetime**: Product must be used within T periods (your "hours/days/months" categories)
- **Random lifetime**: Perishability is probabilistic
- **Fixed with proportional decay**: Quality degrades linearly

### 6. Complex Adaptive Systems and Uncertainty Regulation

This newer perspective addresses your point about multiple planning strategies coexisting .

**Core concept**: Supply chains face different types of uncertainty:

- **Known-knowns**: We understand the risk and can plan for it
- **Known-unknowns**: We know the type of event but not when/if (earthquakes, disruptions)
- **Unknown-unknowns**: Emergent, unpredictable changes

**Planning strategies must coexist** :

- **Mitigation**: Preventive measures before disruptions
- **Response**: Recovery after disruptions
- **Contingency**: If-then rules for understood risks
- **Adaptation**: Self-organization and evolution for unknown uncertainties

Your insight that the same planner might need different strategies for different specs in the same demand tree reflects this.

---

## Key Concepts You Can Borrow

### From Graph Theory

| Concept                    | Relevance to Your Problem                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| **Reachability**           | Can supply node S reach demand node D given transport constraints?          |
| **Shortest path**          | Minimum cost/time route between nodes                                       |
| **Maximum flow / min-cut** | What's the maximum supply that can reach demand? Where are the constraints? |
| **Centrality**             | Which nodes are critical bottlenecks?                                       |
| **Community detection**    | Which nodes cluster together geographically or logistically?                |
| **Topological ordering**   | What production sequence satisfies all dependencies?                        |

### From Supply Chain Theory

| Concept               | Relevance                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| **Echelon inventory** | Think about inventory at each level, not just locally                   |
| **Lead time offset**  | Materials must be planned earlier than final production                 |
| **Lot sizing**        | Production and transport have minimum batch sizes                       |
| **Safety stock**      | Buffer against uncertainty at each level                                |
| **Postponement**      | Delay final configuration to keep options open—relevant for perishables |

This is an exceptionally well-structured and insightful analysis of planning scope. You've done something valuable here: you've taken an implementation question ("what scope should I plan for?") and correctly reframed it as a **graph-theoretic and property-driven question**.

Let me synthesize what you've articulated and highlight the key insights that should drive implementation:

## Core Insight: Scope is Emergent, Not Prescribed

The fundamental contribution here is recognizing that planning scope isn't a parameter you set globally ("plan within 50km"). It's an **emergent property** of:

1. **The recipe graph's topology** (what can produce what)
2. **Per-spec physical characteristics** (distribution, transport, perishability)
3. **The available infrastructure** (networks, logistics paths)

This means a planner for a complex demand (say, a hospital) might simultaneously:

- Search for general labor within 5km (ubiquitous, fungible)
- Query grid connectivity for electricity (network-constrained)
- Trace a specific supply chain for medical isotopes (singular, transportable)
- Check local farms for produce (distributed, perishable → radius = 2-day trucking)

## Critical Distinctions You've Drawn

### 3. **Graph Properties That Matter**

Your identification of fan-in, fan-out, depth, and bottlenecks is exactly right:

- **High fan-in** recipes are coordination problems (all inputs must align)
- **Low fan-out** specs are fragile (single point of failure in production)
- **Deep graphs** have cascading uncertainty (each layer multiplies risk)
- **Bottlenecks** (concentrated × high fan-out) deserve priority planning

### Context Composition

A spec's planning context is a tuple:

- **Spatial scope** (from distribution + transport + perishability)
- **Network membership** (grids, pipelines, cold chains)
- **Recipe availability** (primary production possible?)
- **Substitution mappings** (alternative specs that work)

The planner composes these per-spec as it traverses the demand tree.

### Bottleneck-First Planning

Your suggestion to plan bottleneck specs first is operationally sound:

1. Identify specs that are: (concentrated/singular) × (high fan-out)
2. Plan those before abundant local specs
3. Their availability constraints everything downstream

This complements demand-side priority (D-categories) with supply-side fragility.

## Open Questions Your Analysis Raises

### 1. **How do we represent transport networks?**

You note that electricity requires grid topology, not geography. The same applies to:

- Pipelines (oil, gas, water)
- Cold chains (perishables require specific infrastructure)
- Rail networks (bulk commodities)
- Data networks (digital services)

Do we need a **network registry** alongside the recipe store? Each spec could have `transport_networks: ["grid", "road", "cold_chain"]` indicating which networks it can traverse.

### 2. **How do we handle multi-step transport?**

A spec might move through multiple modes: mine → rail → port → ship → truck. Each step is a "transport recipe" that transforms location without changing the spec. Should these be explicit in the recipe graph?

### 3. **How do we quantify perishability decay?**

"Perishable in hours" is simple. Real perishability is often a decay function: quality degrades over time, with thresholds where it becomes unusable for certain recipes. A tomato too soft for salad might still work for sauce. Should perishability be recipe-relative?

### 4. **How do we model capacity constraints?**

You touch on this with "capacity not yet built." But even existing capacity has limits. A singular production node can only supply so much. Should planning include **capacity-aware routing** that doesn't oversubscribe constrained nodes?

## Toward a Unified Model

What you're describing is essentially a **property-augmented graph**:

- **Nodes**: ResourceSpecifications (with properties: distribution, mobility, perishability)
- **Edges**:
  - Recipe edges (transforms spec A + inputs → spec B)
  - Transport edges (moves spec from location X to Y, possibly requiring infrastructure)
  - Substitution edges (spec A can replace spec B in certain recipes)
  - Network edges (connectivity within grids, pipelines, etc.)

Planning = traversing this graph with:

- **Spatial constraints** (from distribution + mobility + perishability)
- **Temporal constraints** (from perishability + production time + transport time)
- **Capacity constraints** (from finite production/storage at nodes)

The H3-based regional planner is one **implementation strategy** for this traversal when the graph is geographically dense. It's not the only one, and complex demands will require multiple strategies composed.

## Summary

Your analysis reframes planning scope from a geographic question to a **graph topology + physical properties** question. The key contributions:

1. **Scope is per-spec, not per-region** — different specs in the same demand tree require different search strategies
2. **Terminal is context-dependent** — adding recipes expands the planning horizon
3. **"Not found" has multiple meanings** — each requires different handling
4. **Bottleneck specs deserve priority** — they constrain everything downstream
5. **The core algorithm is universal** — only the "find reachable supply" implementation varies

This is a solid foundation for designing a planner that can handle everything from local food systems to global supply chains within a unified framework.
