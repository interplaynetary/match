You're right to push past "terminal" as the main concept—it's really just a boundary marker, not the core dynamic. The deeper question is how demand propagates backward through the supply graph, and how the _structure_ of that graph determines what planning even means for a given spec.

Yes, this problem has absolutely been studied—you're essentially describing **supply chain network design**, **multi-echelon inventory optimization**, and **graph-theoretic approaches to bill-of-materials (BOM) traversal**. Let me connect your thinking to established concepts.

---

## Established Fields and Concepts That Address Your Problem

### 1. Multi-Echelon Supply Chain Theory

This is probably the closest established field to what you're describing. It explicitly models how demand propagates through multiple tiers of suppliers.

**Core concept**: A "multi-echelon" system has inventory and production at multiple levels—raw materials → components → subassemblies → finished goods. Demand at the final level creates dependent demand at all upstream levels .

**What it contributes**:

- **Dependent demand vs. independent demand**: Final products have independent demand (driven by customers). Components have dependent demand (derived from what's needed to make final products). Your "Dependent-supply -> Dependent-demands" is exactly this.
- **Bullwhip effect**: Small changes in final demand amplify as they propagate upstream—relevant to your point about bottlenecks and shared inputs.
- **Echelon inventory**: Thinking about inventory position at each level of the supply chain, not just locally.

**Where it falls short**: Traditional multi-echelon theory assumes a relatively stable, hierarchical supply chain. It doesn't handle your heterogeneous per-spec characteristics (ubiquitous vs. singular, perishability, network constraints) within a unified framework.

### 2. Graph-Based Supply Chain Network Analysis

This is where your thinking aligns with cutting-edge practice. Supply chains are increasingly modeled as directed graphs .

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

### From Complexity Theory

| Concept                             | Relevance                                             |
| ----------------------------------- | ----------------------------------------------------- |
| **Rumsfeld matrix** (known/unknown) | Different uncertainty types need different strategies |
| **Adaptive planning**               | Switch strategies as conditions change                |
| **Self-organization**               | Local decisions can create global patterns            |

---

## Academic Research Directions

If you want to dive deeper, search for:

- **"Multi-echelon supply chain optimization"**
- **"Dependent demand inventory control"**
- **"Supply chain graph analytics"**
- **"Perishable inventory routing problem"**
- **"Bill of materials explosion algorithms"**
- **"Supply chain network design under uncertainty"**
- **"Closed-loop supply chain planning"** (if you're handling returns/recycling)

Recent conferences to watch:

- **IEEE CITSC** (Cybersecurity, IoT and Soft Computing) has supply chain graph analytics tracks
- **APMS** (Advances in Production Management Systems) covers supply chain design
- **International Journal of Operations & Production Management** publishes on adaptable planning

---

## Synthesis: Your Framework in Academic Terms

What you've built is essentially a **property-augmented multi-echelon supply chain model** where:

1. **Nodes** are ResourceSpecifications with properties (distribution, mobility, perishability)
2. **Edges** are recipes (transformations), transport routes (movements), or substitutions (alternatives)
3. **Demand propagation** follows the graph backward (BOM explosion)
4. **Supply availability** follows the graph forward (BOM implosion)
5. **Scope** is determined by:
   - **Reachability** in the transport network
   - **Perishability time windows**
   - **Production capacity** at nodes
   - **Recipe availability** (your planning horizon)

The academic literature confirms this is exactly the right way to think about it—and the trend is toward exactly this kind of **graph-based, property-aware planning** that can handle heterogeneous constraints within a unified model .

---

## Recommended Reading Order

If you want to systematically explore this space:

1. **Start with graph supply chain basics** - Memgraph's tutorial is practical and accessible
2. **Then multi-echelon theory** - Any operations management textbook covers dependent demand
3. **Then perishable inventory models** - Specialized but critical for your "hours/days" cases
4. **Then adaptable planning** - For handling multiple strategies
5. **Finally, closed-loop supply chains** - If you're handling returns/recycling

You're not just reinventing something—you're synthesizing multiple established fields into a unified planning framework. That's exactly where academic research is heading.
