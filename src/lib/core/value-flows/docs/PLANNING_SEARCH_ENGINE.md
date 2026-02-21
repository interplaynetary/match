# The Distributed Planning Search Engine

ValueFlows separates the "what" from the "how". To plan efficiently across a massive geographic area without computationally exploding, the system operates as a **resolution-independent, criticality-ranked search engine**, nested in H3 spatial hexagons.

This logic structurally couples three distinct subsystems:

1. **The Generator (`planner.ts`)**: The core economic logic loop. It doesn't just score plans; it _builds_ them by substituting strategies (recipes) to satisfy needs in order of criticality (replacement → insurance → expansion → final needs) while minimizing SNLT.
2. **The VF Builder (`planning.ts`)**: The mechanical translator. It takes the decisions made by the Generator and instantiates the strict ValueFlows primitives (`Process`, `Commitment`, `Intent`).
3. **The Search Space (`space-time-scenario.ts`)**: The distributed index. It merges the resulting candidate `Scenario` graphs across spatial and temporal boundaries using deterministic hashing.

## The Generator Loop (`planner.ts`)

The logic in `planner.ts` (`planFromNeeds`) is the engine that actually constructs the candidate plans. It is not a static list of limits or a post-hoc scoring function; it is a sophisticated, iterative backward-pass loop navigating a "feasible set" of strategies:

### 1. The D-Series Needs Loop

The engine attempts need satisfaction in a strict order of criticality:

- **D1 (Reproduction)**: Calculate depreciation and queue production to replace the Means of Production (`EconomicResource`s) used up by the network's own processes.
- **Intermediate Needs**: Iteratively produce the inputs required for the downstream goods.
- **D3 (Insurance)**: Derive a risk-adjusted buffer based on the historical variance and failure rates (`cv`) of the specific strategies selected.
- **D4/D5/D6 (Final Needs)**: Administration, Common Needs, and Support.

### 2. Strategy Substitution and Expansion (D2)

To satisfy these needs, `planner.ts` doesn't just pick the default recipe. It actively searches the feasible set for the most SNLT-efficient option:

- It actively substitutes operations (e.g., swapping to a more efficient recipe if labor becomes scarce).
- If it exhausts all feasible active strategies, it evaluates the _activation cost_ of inactive strategies (e.g., building a new factory).
- If activating new capacity is mathematically viable and SNLT-efficient, it issues a **D2 Expansion Signal** and folds the construction of new Means of Production directly into the plan.

## The multi-scale H3 Search Space (`space-time-scenario.ts`)

As described in `SPACE_TIME_PLAN.md`, the search is not strictly "bottom-up" in a rigid sequence. Because a `Scenario` identity is just a deterministic hash of its contents (Commitment signatures + spatial locations), search can happen at **any resolution simultaneously**.

This is crucial for solving "rare global material" problems. If a neighbourhood node (res 9) and a national node (res 3) independently discover a use for the same silicon chips, their independent candidate `Scenario`s will eventually collide deterministically in the index. The system analyzes the exact same `Scenario` graph regardless of which worker node originated it.

- Nodes execute the `planner.ts` loop over their local hexes independently and in parallel at whatever resolution makes sense for their scope.
- They bubble up their "best scenarios" (which contain unresolved deficits and unused surpluses).
- Merges (`mergeScenarios`) at coarser resolutions discover substitutions that were invisible at the local scale, generating cross-cell `transfer` `Commitment`s.

## Bringing it Together: Merging and Pruning

This is how the engine behaves across space and time:

1. **Local Generation (`planner.ts`)**: A local worker queries the `IndependentDemandIndex`. It runs the iterative D-series loop to select the best, SNLT-minimizing strategies (including D2 expansions if necessary) to meet the demands.
2. **Translation (`planning.ts`)**: The selected strategies are mechanically assembled into VF `Process`es and `Commitment`s, forming a candidate `Scenario`.
3. **The Merge (`space-time-scenario.ts`)**: When adjacent hexes are combined via `mergeFrontier`, the index identifies structural deficits in Hex A and surpluses in Hex B, automatically creating a `transfer` Commitment.
4. **Pareto Selection**: At this newly merged scale, `planner.ts` logic evaluates the combined `Scenario`. Because the new cross-cell trade satisfied more high-criticality needs, it enters the global `paretoFront`.
5. **Global Pruning**: When the search bottoms out (or "tops out" at the root node), the winning `Scenario` is promoted to a definitive `Plan`. We can exactly trace what happened: _"We satisfied all D1 reproduction, intermediate, and insurance needs. We triggered 5 D2 expansion signals for silicon production (activating new factories). 20% of D5 common needs were pruned because they were mathematically impossible to satisfy given global labor capacity."_
