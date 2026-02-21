# Space-Time Architecture in the Plan Module

The system utilizes a dual-engine architecture to efficiently model, cluster, and solve complex space-time economic matching problems. The goal is to accurately represent continuous and complex temporal patterns while enabling extremely fast query and resolution across millions of nodes.

We have explicitly separated **Spatial Tree Indexing** (for discovery) and **Deterministic Bucket Grouping** (for compression) into two focused subsystems: `space-time-index.ts` and `space-time-keys.ts`.

## The Dual System

### 1. The Discovery Engine: `space-time-index.ts`

This module acts as a **Hierarchical Spatiotemporal Cube**. It is responsible for extremely fast pruning and range queries natively built on Uber's H3 grid algorithm.

- **`O(1)` Zoom Level Aggregation**: As data points (labor availability, tool needs) enter the system at the maximum resolution leaf nodes (e.g., `resolution 9`, a specific building), the index natively rolls those quantities and hours up the hex hierarchy. Querying "How much total labor is available in Europe right now?" and "How much labor is available on this specific street corner?" both take `O(1)` time.
- **Nested Temporal Hierarchy**: The hierarchy mirrors the spatial tree with a time tree. Instead of looping over every slot, one can simply query the nested `recurring.days.get('tuesday')` branch of a node and immediately prune weekend-only availability without computation.

### 2. The Compression Engine: `space-time-keys.ts`

While the index is the ultimate spatial database, combinatorial solvers struggle if fed tens of thousands of individual variables. The keys module acts as a **Deterministic Grouping Hash generator**, taking complex `AvailabilityWindows` and H3 cells and compressing them into precise bucket strings.

- **MapReduce / GroupBy**: Generates canonical representation hashes of temporal schemas (e.g., `recurring|Months:M2|Days:(monday)...::87283472bffffff`).
- **Exact Intersections**: Extremely fast for finding structurally identical classes of labor or needs within the exact same space-time envelope without traversing arbitrary nested object properties.

---

## Architectural Workflows & Consumers

### 1. `derivation.ts` (Analytics and Visualization)

The `derivation.ts` module runs Metabolic queries ("What is the spatiotemporal trend of this resource flow?").

- **The Usage**: It leverages `space-time-index.ts` directly.
- **The Upgrade**: Previously, analytical passes ran a linear scan (`for (const { delta, effect } of deltas)`) across all effects, checking for bounding box and time intersection overlaps on every single one. By querying a live `HexIndex` of effects via `queryHexIndex(index, cell)`, `derivation.ts` instantly scopes its metabolism calculation to a tiny pre-pruned subset. This ensures query times remain bounded regardless of total dataset scale.

### 2. State Indexers (`labor.ts`, `need.ts`, `resource.ts`)

These represent the dynamic ledgers of what actually exists in the local peer economy matrix.

- **Populating Memory**: They build full spatial indices via `addItemToHexIndex` upon ingestion. This forms a navigable graph of localized availability.
- **For Fast Deduplication (Labor Capacity)**: They aggressively group their internal data models using `getSpaceTimeSignature` from `space-time-keys.ts`. A single `Person` might list disjointed availabilities; to prevent grouping them as multiple different people in the solver, `labor.ts` hashes their hours into unified `PersonCapacity` objects clustered strictly by their canonical string hash keys.

### 3. `planner.ts` & `allocation.ts` (The Solver Pipeline)

This is where the dual architecture unifies to make NP-hard matching computationally tractable. The workflow is a rigorous 3-phase pipeline:

1. **The Discovery Phase**: The planner uses `queryHexIndex` from `space-time-index.ts` to scan the world for regions of dense, unbalanced economic activity. For example, encountering a density spike of unfulfilled needs at Resolution 4 (Europe), it traverses down into Resolution 5 (Germany) and calls `getItemsInCell` to retrieve local participants.
2. **The Compression Phase**: The planner extracts the raw data (e.g., 50,000 resources and needs) from the spatial query, and runs a MapReduce pass grouping them by `getSpaceTimeSignature` from `space-time-keys.ts`. This compresses 50,000 variables into perhaps **80 dense "buckets"** representing structurally identical classes of labor and need (e.g., "Any welder in Berlin available on Tuesday mornings").
3. **The Matching Phase**: The solver engine can now perform bipartite matching and flow constraint satisfaction on an exponentially smaller graph of unified buckets instead of individual, disjoint rows, generating an optimal allocation plan in fractions of a second.
