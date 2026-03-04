# **![][image1]**

# **Free Association**

# **Planner Process**

# **Design Goals**

`We are designing a decentralized/distributed planner that enables global cooperation.`

`It aims to try to resolve all needs at the most local level, resolving conflicts and optimizing at higher-levels.`

`This is not because all needs can be satisfied locally (today many countries have transferred most conditions of production - industrial manufacture etc. to other countries, creating international division of labor, and decreasing local resilience) but because our planner should aim to construct plans that allow most needs to be satisfied locally, of course while also aiming to satisfy other objectives like, labor-time reduction etc.`

`This orientation is essential to dissolving the international division of labor, therewith also the division between town and country, and the division between mental and physical labor.`

`Our planner is not aiming to find a globally optimal solution to need satisfaction (an impossible, un-tractable, NP-hard problem) based on the currently-existing global division of labor and global distribution of the conditions of production.`

`Moreover, it should be noted that in capitalism, it often only seems more “efficient” to outsource production to other countries, because labor-time is (and is forcefully maintained to be, internationally and domestically) cheaper in those countries - people’s lives are literally valued less, this doesn't mean that these global supply chains are actually more efficient in terms of resource-usage or in terms of the actual total expenditure human-labor-time.`

`The aim is to formulate good-enough plans that satisfy all constraints (metabolic sustainability etc., and maximize all objectives), in such a way that is:`

- _`Tractable`_
- `massively parallel (planners can operate completely independently and simultaneously)`
- _`mergable`_ `& composable (planners and their plans can be merged and (de)composed seamlessly with conflict resolution)`
- `Characterized by exponential residual reduction (meaning that at each level we try to only deal with the smallest possible scope we need to resolve conflicts).`

**`Planner Objectives/Constraints:`**  
**`Across space-time:`**

- **`Objective: Maximize Independent Demand satisfaction`** `(ranked by criticality)`
- **`Constraint: Satisfy derived demands`** `(ranked by criticality)`
- **`Satisfy Replenishment (metabolic) demands`** `(ranked by criticality)`
- **`Satisfy`** `Reserve/Buffers demands (ranked by criticality)`
- **`Constraint: Respect Max-Individual-Effort-Time/Day`** `(individuals classifiedAs child etc. enable granular limitations)`
- **`Objective: Minimize Total Socially Necessary Effort (SNE)`**
- **`Unit of Effort:`** `<Time>`

**\*`Local/global inversion:`** `every global constraint is a local objective. Planners try to satisfy all demands and emit surplus/deficit signals. Planner composition converts local failures into global constraints by routing surplus/deficit upward until resolved or declared genuinely infeasible. Infeasibility results in a local contraction of those dependent demands leading into those independent demands that are relevant to freeing up capacity needed to satisfy those constraints (in doing so attempting to distribute the load of net-sacrifice evenly: sacrifice determined by independent demand priority).`\*

`Note: while local/global inversion guarantees that plans resolved to the global level will satisfy metabolic constraints, strain on planners for solving these problems can be drastically reduced when the recipes being composed are themselves metabolically sustainable. Much of the politics of planning (with its consequences on ecology, working conditions etc.) resides in effectively restricting/filtering what recipes are to be considered in planning (i.e. monoculture vs permaculture, syntropic agroforestry etc.).`

`Our planner should also handle edge-cases, such as rare-earth metals etc. whose independent supply is known (via aggregation/indexing) to only be available in very specific space-times. These global bottlenecks should receive special treatment as they constrain valid plans (however this is not to imply necessarily a global division of labor for rare raw materials, for example: recipes can be formulated and plans created that can recycle and extract rare-earth metals from electronic waste (what's referred to as land-fill mining).`

`Our planner should also classify resources by their mode of consumption (communal or individually-claimable).`

`Our planner will only propose plans from codified knowledge. All plans it produces will be materially feasible given codified knowledge. However, coordination-bodies will be required to select/prune/modify those plans and the codified knowledge used during planning, drawing on the tacit (uncodified) knowledge in those coordination-bodies.`

**`On Coordination-Bodies:`**  
`Coordination-bodies should be composed so as to harness all tacit knowledge relevant to a planning scope in the selection/pruning/modification of plans generated by planners.`

`The way these coordination bodies are composed should allow for global constraints to be satisfied and for planners to find solutions quickly and effectively, staying responsive to local information.`

`A federation structure with disjoint membership (no entity can be part of more than one other entity), ensures minimal conflict resolution requirement, and has the least stress on planners with local/global inversion. A strict disjoint federation is not the only possible structure, but is the most efficient structure for achieving planner objectives/constraints with local/global inversion.`

`Participants in these coordination-bodies must remain embedded in and responsible to their communities — they must feel in their own lives the consequences of the decisions they make during plan merging. Otherwise, we create a professional planning class, and with it, the division between mental and physical labor reasserts itself in a new form.`

- `For example, the merge planner coordination-body for a region could be composed of temporarily elected delegates - with binding mandates, immediately revocable by electors - from local coordination-bodies, each bringing their plans and their mandate.`

`Knowledge Infrastructure must support coordination-bodies in their planning and be properly indexed so as to inform their decisions.`

# **General Process**

# **Draft Specification**

**`Aggregators/Indexes/Filters:`**  
`- Resources`  
`- Plan (re)-classifies resources according to their mode-of-consumption < communal | individual-claimable >`  
``- Socially Necessary Effort (SNE) Tracking: Moving Average of historical effort/unit (which always includes historical SNE cost of inputs to processes). The actual effort worked is recorded at the Observation Layer by the EconomicEvent (`action: 'work'`, tracked in `effortQuantity`). actual-effort moving-average informs average expected effort. EconomicEvents are spatio-temporally indexed in order to avoid gross-generalizations in SNE estimations.``  
`- Recipes define how to create/transform resources`  
``- SNE Tracking: In Valueflows RecipeFlow.effortQuantity (for `action: 'work'`), relates to expected-effort on average for a recipe.``  
`- Independent supply: current resource quantities across space (present tense)`  
`- Dependent supply: emerge from composing recipes from independent supply into Plans (exploratory search-space of what is possible, given existing independent supply).`  
`- Independent demands: desired resource quantities across space-time (present-future)`  
**`- Derived Independent demands`**`: derived from network data.`  
 `- For example: food/nutritional demand in a region as a function of population density/age.`  
**`- Dependent demands:`** `emerge from composing recipes (this is production expansion) into Plans to satisfy independent demands.`  
**`- Derived Dependent demands`**`:`  
`- Replenishment demands (classifiedAs) restore net-losses created by a Plan, up to - if specified - desired ranges (min/max) across space-time. This is metabolic sustainability.`  
 `- For example replenishing the nutrients taken from the soil during harvest, or repairing machines.`  
`- Reserves/buffers demands (classifiedAs) are untouchable except in emergencies.`  
`- Administration demands (classifiedAs) for Plan coordination & enforcement of resource usage-rights & responsibilities in accordance with Plan.`

**`Derived demands`** `are computed from actual consumption records of the primary planning pass. They cannot be pre-sorted alongside independent demands — they are not definite until primary planning is complete.`

**`Planning proceeds in two passes over the same PlanStore:`** `(1) independent demands, (2) replenishment/buffer/admin demands derived from Pass 1 consumption. Failure in Pass 2 = metabolic debt, qualitatively worse than unmet independent demand satisfaction.`

**`Planner Objectives/Constraints:`**  
**`Across space-time:`**

- **`Objective: Maximize Independent Demand satisfaction`** `(ranked by criticality)`
- **`Constraint: Satisfy derived demands`** `(ranked by criticality)`
- **`Satisfy Replenishment demands`** `(ranked by criticality)`
- **`Satisfy`** `Reserve/Buffers demands (ranked by criticality)`
- **`Constraint: Respect Max-Individual-Effort-Time/Day`** `(individuals classifiedAs child etc. enable granular limitations)`
- **`Objective: Minimize Total Socially Necessary Effort (SNE)`**
- **`Unit of Effort:`** `<Time>`

**\*`Local/global inversion:`** `every global constraint is a local objective. Planners try to satisfy all demands and emit surplus/deficit signals. Planner composition converts local failures into global constraints by routing surplus/deficit upward until resolved or declared genuinely infeasible, resulting in local contraction of those dependent demands leading into those independent demands that are relevant to freeing up capacity needed to satisfy those constraints (in doing so attempting to distribute the load of net-sacrifice evenly: sacrifice determined by independent demand priority).`\*

_`unmetDemand[] = consumption gap (someone doesn't get what they wanted). metabolicDebt[] = sustainability gap (productive base degrades). Both propagate up through merge planners; metabolicDebt carries elevated routing priority.`_

**`Social Validation of Effort:`**

- **`Administration`** `(or an extension thereof) can socially-validate work-intent satisfaction in a Process only up to the limit of the Planned Effort of the work-intent.`
- **`recognition-of-contribution`** `is non-transferable and retractable by the recognizer.`
  - `A plan’s failure to produce desired outcomes is a risk shared by society. Process inputs/outputs are recorded and inform future plans. Reserves/buffers aim to limit the harm of failures.`

**`Capacity & Individual Claim Equations:`**

- **`Individual Claimable Resource Price = SNE/unit cost`**
- **`Total Socially Validated Contribution`**`:`
  - `total_social_svc = Σ(all socially-validated effort)`
- **`Total Pool Validated Contribution`**`:`
  - `<pool>_svc = Σ(SVC of all resources classified as <pool>)`
    - `Pool Examples: individual-claimable, replenishment, reserve/buffer, administration, unspecified. Recall, plans classify resources as belonging to these pools.`
- **`Net Claim Capacity`**`:`
  - `net_claim_capacity = gross_contribution_credited * (individual_claimable_pool_svc / total_social_svc)`
- **`Current Potential Claims`**`: Remaining capacity after claims are made.`
  - `current_potential_claim_capacity = net_claim_capacity - claimed_capacity`
- **`Social Share`**`: The individual's portion of total outstanding claims.`
  - `current_share_of_claims = current_potential_claim_capacity / social_total_potential_claims`
- **`Actual Claim Capacity`**`: The real-world purchasing power relative to the available individual-claimable pool.`
  - `current_actual_claim_capacity = current_share_of_claims * current_claimable_pool`

**`Resource Usage-Rights & Responsibilities:`**  
`Only Resources classified as Individual-Claimable can be transferred to agents classified as Person.`

`All other Resources are owned by the Universal Commune Federation, with usage-rights and responsibilities determined by recursive/compositional merging/resolution of Plans across the Universal Commune Federation according to Planner Process.`

`The plan is the complete record of who may do what, with what, and for whom. A responsibility is an obligation that appears in the plan: a derived demand for replenishment, a commitment to provide labor, a duty to deliver to another commune.`

`There is no right without a corresponding plan element. There is no responsibility that is not visible in the PlanStore.`

`When the plan changes, rights and responsibilities change with it. The planning process is the continuous renegotiation of all rights and responsibilities among the associated producers.`

# **Social Planning Process**

# **Draft Specification**

**`Citizen Index:`**  
`All persons residing within free-association. Managed by the Universal Commune as the guarantor of universal membership. The Citizen Index establishes the fundamental unit of political personality — the human being as such, prior to any particular association.`  
**`ID -> Citizen`**

**`Membership Index:`**  
_`All persons/communes residing within free-association. No double counting across communes. Records the actual associative choices of citizens — which communes they belong to, which federations those communes belong to.`_  
**`Citizen -> Commune`**  
**`Commune -> Commune`**

| `Federations form along whatever spatio-temporal attributes create actual metabolic interdependence. This could be: Spatial: Watersheds, climate zones, transport corridors, radiation belts (for space settlements) Temporal: Generational cohorts managing long-term waste, shift-based communities (24/7 infrastructure), seasonal migration patterns Functional: Supply chains (grain network federation), practice communities (agroecology schools), infrastructure grids (internet backbone) Cultural: Language areas, religious communities, indigenous nations (these have spatio-temporal dimensions too—territory, pilgrimage cycles, harvest festivals) Emergency Response: Fire seasons, flood plains, pandemic zones` |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

**`Commune Citizen Shares:`**  
_`Derived from Membership Index by recursively counting citizens in commune (reducing commune hierarchy into citizens) Used to determine the weight of each citizen in commune-level decisions. Also, used for calculating equitable distribution of sacrifice and benefit across all individuals.`_  
**`Commune -> {`** \*`citizen: proportion ... }`

**`Commune Shares:`**  
_`Derived from Membership Index by recursively counting citizens in communes, from bottom-up, (retaining commune abstraction) Used for determining voting weights in federation assemblies where communes vote as units. Ensures that federations reflect the demographic weight of their constituent communities.`_  
**`Commune -> {`** \*`member-commune: proportion , member-citizen: proportion ... }`

**`Universal Commune:`**  
_`Membership List auto-generated from those entities that are in Membership Index and are not a member of any higher order structure. Membership List & Commune Shares for Synthetic Commune are stored separately from other Indexes.`_

- **`Responsibilities:`**
  - _`Management of the Citizen Index, guaranteeing that no person falls outside the human community regardless of their associative choices.`_
  - _`Coordination of matters that affect all humanity: atmospheric carbon, ocean health, outer space, management of the global commons, pandemic response, and other planetary-scale interdependencies.`_

`Unlike intermediate federations, withdrawal from the Universal Commune is impossible. It is the expression of our inescapable mutual interdependence as inhabitants of a single planet. Freedom of association operates within this frame, not against it.`

`The Universal Commune maintains no standing army, no permanent bureaucracy, and no power of taxation.`

**`Communes:`**

- **`Rights:`**
  - **`Decisions:`** `for all Commune Members on matters internal to the commune`
  - **`Immediately-Revoke:`**
    - **`Members`**
      - `Participants`
      - `Communes`
    - **`Commune-Agents`**
      - `Delegates with Imperative Mandates (Binding Instructions)`
      - `Observers of Social Planning Processes`
  - **`Withdraw:`** `The right to withdraw from any commune/intermediate federation. This right is the expression of freedom of association among communes. Withdrawal is subject to: (1) withdrawal does not dissolve obligations incurred during membership — these must be honored through the planning process until settled, or a new federation plan voids previous obligations; (2) withdrawal severs the federation's authority over the commune for all future matters; (3) the metabolic consequences of withdrawal become visible in the planning process, enabling the commune to make an informed decision; (4) withdrawal from all intermediate federations does not constitute withdrawal from the Universal Commune, which guarantees universal membership.`
  - **`Communicate:`** `Publish all doings and shortcomings`
- **`Responsibilities:`**
  - **`To electorate:`** `Publication of proceedings`
  - **`To federation:`** `Abide by federation decisions on matters within the federation's delegated authority. Where a federation decision conflicts with a commune's binding instructions on a matter outside the federation's authority, the commune may seek judicial review.`
  - **`To external-constituency:`** `Consider interests of affected non-members in decision-making. Where a commune's decision materially affects non-members, those affected have standing to participate in the deliberation through procedures defined by the relevant federation.`

**`Recall Procedure:`**

- `Any member may initiate a recall of commune agents. Recall vote triggered by petition threshold. Commune Agent suspended pending vote outcome.`
- `Threshold: 5% of electorate signature required`
- `Timing: Recall vote held within 30 days`
- `Outcome: Simple majority removes delegate`

**`Citizenship Procedure:`**

**`Citizen:`**

- **`Rights:`**
  - **`Request`**
    - **`Membership`**`: in a commune.`
  - **`Withdraw:`** `The right to withdraw from any intermediate federation. This right is the expression of freedom of association among communes. Withdrawal is subject to: (1) withdrawal does not dissolve obligations incurred during membership — these must be honored through the planning process until settled, or a new federation plan voids previous obligations; (2) withdrawal severs the federation's authority over the commune for all future matters; (3) the metabolic consequences of withdrawal become visible in the planning process, enabling the commune to make an informed decision; (4) withdrawal from all intermediate federations does not constitute withdrawal from the Universal Commune, which guarantees universal membership.`
- **`Responsibilities:`**

**`Delegates:`**

- **`Rights:`**
  - `Represent electors in Commune or Federation Assembly`
  - `Vote on decisions`
  - `Access to all planning tools, including the PlanNetter capability for their level of federation`
- **`Responsibilities:`**
  - `Abide by binding instructions (mandat impératif)`
  - `Accept immediate revocability`
  - `Perform legislative & executive work`
  - `Maximum term: 2 years before requiring re-election. No individual may serve more than 4 years in any 8-year period in the same federation level.`

**`Affected Interest Group:`**  
_`Any individual or commune materially affected by a decision under consideration has standing to participate in the deliberation. Material affect is determined by tracing the metabolic consequences through the planning network: who will bear costs, who will receive benefits, whose conditions of existence will be altered. Procedures for affected interest participation are defined by the relevant federation and must include: (1) notice to affected parties, (2) opportunity to present evidence and argument, (3) consideration in the final decision, with reasons given for acceptance or rejection of affected interests' positions.`_

**`Planning-Based Dispute Resolution:`**  
_`When a commune alleges that a federation decision exceeds proper authority, or when communes disagree on the terms of cooperation, the dispute shall be resolved through iterative planning, not adjudication.`_

_`The process:`_

1. **`Delegates convene`** `with their communes' PlanStores and binding instructions.`
2. **`They merge their PlanStores`** `and run the planner at the federation level, treating the disputed matter as an unmet demand to be satisfied.`
3. **`The planner produces one or more feasible resolutions`** `— plans that satisfy all metabolic constraints and respect priority rankings to the greatest extent possible.`
4. **`Delegates return to their communes`** `with the proposed resolutions, along with full planning data showing the consequences for each party.`
5. **`Communes deliberate`** `and either:`
   - `Reject all resolutions and propose modifications`
   - `Withdraw from the disputed aspect of cooperation, accepting the metabolic consequences of withdrawal`
6. **`If modifications are proposed, delegates reconvene`** `with updated instructions and PlanStores, and repeat from step 2.`
7. **`If withdrawal occurs, the planning process automatically adjusts`** `— the withdrawing commune's commitments are treated as unmet demands to be satisfied by other means, and its expected receipts are written off as supply to be redirected.`

_`There is no binding decision external to the planning process. There is no judge. There is only the metabolic logic of interdependence, made visible through the planner, and the free choice of associated producers to accept, modify, or withdraw from the terms of cooperation.`_

_`Convergence is not guaranteed, but it is strongly encouraged by the metabolic consequences of non-cooperation. A commune that consistently blocks mutually beneficial plans will find itself isolated, its PlanStore showing growing deficits, its members facing harder choices.`_

**`On the Settlement of Obligations Upon Withdrawal:`**  
_`When a commune withdraws from a federation, it remains responsible for obligations incurred during membership until those obligations are settled through the normal functioning of the planning system. The federation retains a record of outstanding commitments, which are treated as independent demands on the withdrawing commune. The withdrawing commune continues to receive resources it is owed until accounts are balanced within the existing plan, or a future plan voids (mutual) obligations. This is not punishment but the honoring of mutual commitments. The planning process itself—the two-pass system, the surgical retraction, the local/global inversion—handles the settlement without need for special enforcement mechanisms. Once all obligations are settled within a given plan, the commune's relationship to the federation ceases entirely, except for its continuing membership in the Universal Commune.`_

**`On Enforcement:`**  
_`There are no permanent enforcers. The primary enforcement mechanism of the Universal Commune Federation is the planning process itself: obligations that are not honored appear as unmet demands, deficits accumulate, and the metabolic consequences become visible to all. Communities that consistently fail to honor commitments will find cooperation difficult, and likely find their PlanStores showing growing imbalances.`_

_`In the rare cases where physical intervention is necessary to prevent imminent harm—violence, destruction of common resources, violation of bodily integrity—any citizen may act to prevent such harm. Such actions are immediately reviewable by the affected commune's assembly, which may confirm, modify, or repudiate them. Repeated need for physical intervention in a community indicates a failure of planning or of social relations, to be addressed through the planning process itself.`_

_`The Universal Commune maintains no standing army, no police force, no permanent enforcers. The only legitimate use of force is that which arises spontaneously from the associated producers in defense of their common life, and it returns immediately to the producers once the threat is past.`_

# **Planner Process**

# **Draft Technical Specification**

**`Dependent Demand:`** `Backward recursion from (specId, qty, neededBy). Explodes recipes toward present; back-schedules Processes by recipe duration; creates Commitments/Intents per I/O. purchaseIntents for specs with no recipe.`

**`Dependent Supply:`** `Forward recursion from (specId, qty, availableFrom). Propagates through recipes to terminal outputs; creates Processes and Commitments/Intents. surplus[] = supply no recipe absorbed.`

**`Both:`** `Share a PlanNetter per invocation. allocated Set bridges the two passes — demand claims sources first; supply routes around pre-claimed consumptions.`

---

**`Utilities:`**

- **`HexIndex:`** `H3-based hierarchical spatial index over Slots. Querying a cell returns items at that cell and all finer sub-cells within it. Resolution determines spatial granularity of demand/supply visibility.`
- **`Space-Time Keys:`** `(atLocation: SpatialThing ID, neededBy / availableFrom: ISO date). Propagate through BFS — location through sub-demands; time back-scheduled from due date by recipe duration.`
- **`H3 Utilities:`** `getCellsInRadius(cell, km) | cellsCompatible(cell1, cell2, km) | H3_EDGE_LENGTHS_KM[res]. Wrap h3.gridDisk / h3.gridDistance. Planner uses these — never raw H3 calls.`

**`IndependentDemandIndex:`** `Snapshot of open demand slots at t=0. Pre-planning — correct before any allocation. Answers: what demand exists, where, how much remains, when due.`

**`IndependentSupplyIndex:`** `Snapshot of available supply (inventory | scheduled receipts | labor) at t=0. Answers: what supply exists, where, how much, when available.`

- `Snapshot vs. live: IndependentSupplyIndex = supply landscape at t=0. PlanNetter = t=0 − allocated + new output flows from this run.`

**`PlanStore:`** `Per-invocation, region-scoped. Holds Plans | Processes | Commitments | Intents. No global store.`

- `Mergeable: planStore.merge(sub) imports another store's records. Coordination between regions emerges from merge planners only.`
- `Observer must also be mergeable across regions — the same compositionality that applies to PlanStore applies to the observation layer beneath it.`

**`PlanNetter:`** `Per-session soft-allocation ledger. Reads Observer + PlanStore; never mutates either.`

- **`netDemand(specId, qty, opts?):`** `Claims inventory + scheduled outputs. Marks source IDs in allocated.`
- **`netSupply(specId, qty, opts?):`** `Absorbs scheduled consumptions. Marks consumption IDs in allocated.`
- **`netAvailableQty(specId, opts?):`** `READ-ONLY — inventory + outputOf flows − inputOf flows.`
- `allocated: Set<id> — prevents double-claiming across all calls within one session.`

---

**`Planner — planForRegion(cells, horizon, ctx, subStores?)`**

- **`Phase 0 — Normalize:`** `Deduplicate input H3 cells. A cell is dominated if any ancestor appears in the set. Remove dominated. Result: non-overlapping canonical cover; no slot loaded twice.`
- **`Phase 1 — Extract:`** `queryDemandByRegion + querySupplyByRegion over canonical cells. Horizon filter (from, to) applied to slot.due. H3 cells used only here — not involved in planning.`
- **`Phase 2 — Classify:`** `Each open demand slot: locally-satisfiable | transport-candidate | producible-with-imports | external-dependency. Locally satisfiable planned first (cheapest, no transport overhead).`
- **`Phase 3 — Formulate:`** `One PlanNetter per invocation (Mode C). Caller decides plan granularity — not grid-derived.`
  - `Pass 1 (primary): all pre-existing demands sorted by D-category then due date. dependentDemand per slot; netter.allocated grows from highest priority down.`
  - `Compute: endogenous replenishment demands from Pass 1's consumption records (consumed qty × replenishment rate per spec). These did not exist before Pass 1.`
  - `Pass 2 (derived): replenishment + buffer demands against remaining capacity. Same PlanStore, same netter — no merge step needed.`
  - `Backtrack (if metabolicDebt after Pass 2): walk Pass 1 allocations in reverse priority (lowest D-category first, latest due date first within category). Retract process subgraphs (by provenanceId) until freed capacity covers unmet replenishment qty. Re-explode retracted demands against newly freed capacity — their shortfall becomes unmetDemand[]. If metabolicDebt persists after exhausting all lower-priority retractable allocations, escalate to merge hierarchy.`
  - `Phase B (Supply): unabsorbed supply (not in allocated) forward-scheduled via dependentSupply.`
- **`Phase 4 — Collect:`** `purchaseIntents[] | surplus[] | unmetDemand[] | metabolicDebt[] | laborGaps[]`

**`Merge Planner:`** `Same planForRegion with subStores provided. Merges sub-PlanStores; runs Phase 3 Formulate treating leaf unmetDemand[] + metabolicDebt[] signals as new demand inputs. dependentDemand at inter-region scope — can traverse into a neighbour region's capacity, discover transport or production recipes, and back-schedule their full dependency chain as sub-demands. The inter-region supply being routed may itself be the output of a dependent production chain, not just inventory — dependentSupply runs forward from unabsorbed inter-region capacity to discover what could be produced. PlanNetter initialised from merged PlanStore: netter.allocated contains all leaf allocations; inter-region processes claim only unallocated capacity. Surgical retraction can reach into any leaf's allocations to liberate capacity on the inter-regional dependency path. Leaf planner = subStores = [].`

- **`Conflict Detection:`** `Scan merged PlanStore after formulation. Types: inventory over-claim (Σ committed qty > onhandQuantity) | receipt over-claim | capacity contention (Σ committed effort > available labor capacity for agent/period). Transport process explosion may introduce capacity contention without any inventory over-claim — both must be detected.`
- **`Surgical Resolution:`**
  - `Identify contested resources: trace the inter-regional demand's dependency path (dependentDemand subgraph). Contention points = resources/capacities where that path conflicts with existing allocations. Retraction candidates = existing allocations competing for those specific contested resources — targeted to the dependency path, not a blind global priority walk.`
  - `Retraction unit = process subgraph (by provenanceId). Among candidates, retract in reverse priority (lowest D-category first, latest due date first within category). Stop retracting as soon as freed capacity resolves each contention — minimize net sacrifice.`
  - `Retract: planStore.removeWhere(provenanceId) on merged store. Rebuild PlanNetter from post-retraction state (vacated supply + freed capacity now visible again).`
  - `Re-explode at merge scope: dependentDemand on each retracted root demand at full inter-region resolution → fallback ladder: alt local inventory → transport recipe → scheduled receipt → production → purchaseIntent. Re-exploded demands gain visibility into inter-region supply routes unavailable at leaf level — net sacrifice is often less than gross retraction.`
  - `Cascade: detectConflicts() again. If new conflicts → extend retraction set, repeat. Termination: detectConflicts() = [].`
- **`Recursion:`** `Merge planner PlanStores may themselves conflict → planForRegion for their union. Depth bounded by region nesting (typically 1–2 levels). metabolicDebt[] signals routed with elevated priority over unmetDemand[] at every merge level.`

| `Key Properties: Three orthogonal axes: H3 cells, PlanStore, and Plans do not constrain each other. Cells scope what data gets loaded (Phases 0–2). PlanStore is owned by an invocation and corresponds to its region. Plans are organizational labels for logical work groupings — they can span many cells or many Plans can exist within one cell. The PlanNetter is the consistency boundary, not the Plan. PlanStore is region-scoped, not global: Each planForRegion invocation owns its own PlanStore corresponding to its region. There is no single global store. Coordination between planners happens only when a merge planner is created for a region that spans both. Parallelism is maximal at the leaf: Leaf planners share nothing — no coordination, no shared state, no locks. Conflicts between them are only visible (and only matter) when someone asks for a higher-order region that spans both. If no one ever asks for that larger region, the leaf PlanStores coexist independently. Merge = a planner for the union region: Resolving conflicts is not a special operation — it is a planForRegion call that happens to receive sub-PlanStores. The function is the same. The difference is the starting state of the PlanStore (merged vs. empty). Resolution is surgical, not global re-computation: The merge planner retracts only the specific commitments above the availability threshold and re-explodes only the demand fragments those commitments were serving. Sub-PlanStores are not modified. The rest of every Plan is preserved in the merged PlanStore. Substitution is emergent: When a retracted fragment is re-exploded, dependentDemand tries the next available option on its own fallback ladder — alt inventory → transport → scheduled receipt → production recipe → purchase intent. The merge planner provides no guidance on which substitute to use; it only ensures the retracted resource is no longer available in the netter. Recursion is shallow in practice: Most conflicts are between adjacent leaf regions and resolve in a single merge step. The hierarchy only recurses up when a merge planner's PlanStore itself conflicts with another region's — bounded by the nesting depth of overlapping regions, typically 2–3 levels. Indexes are the scoping filter; they are never mutated: The demand and supply indexes tell the planner what exists and where — before any allocation. After a planning cycle, rebuild the indexes from the updated PlanStore state(s) before the next horizon.` |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# **Infrastructure**

# **Draft Specification**

**`Infrastructure Operators:`**  
_`Infrastructure operators (Aggregators/Indexers/Planners etc.) are responsible for applying filters to constrain what demands/recipes are considered/propagated.`_

- _`They are wholly responsible for filtering so as to conform to technical, social, legal limitations.`_
- **\*`Labellers`** `can be deployed to aid in filtering/moderation.`\*
- **`PDS (Personal Data Server)`** `Hosts user accounts and personal data under <host/self-hosted> Terms of Service and Privacy Policy. Users hosted can migrate away at any time while keeping their identity and social graph. Promotes independence from others by giving users options in alternative hosting providers with their own governance and moderation policies.`
- **`Migration Tool`** `(@tektite.cc) Simplifies the process of migrating accounts from Bluesky's PDS to other hosts without losing data or identity. Promotes independence by making it easy for users to leave Bluesky's hosting while maintaining their social presence.`
- **`Exported Data Explorer Tool`** `(https://satnav.rsky.dev) for exploring CAR files (Content Addressable aRchives) - your exported AT Protocol data. Makes user data portable and human-readable. Promotes independence by ensuring users can access and understand their own data outside of any platform.`
- **`Relay & Moderation Relay`** `(atproto.africa) A full-network relay built from scratch in Rust that streams all network activity with a 3-day backfill window and PLC cache. Also hosts a moderation relay that replays all moderation labels network-wide that have ever been made, making it easy for developers to consume labels from multiple mod services. Promotes independence by enabling anyone to access the entire AT Protocol firehose and aggregated moderation data without relying on other’s infrastructure.`
- **`Indexes/Aggregators/Filters`** `(app-views) AppViews are a specialized service within the AT Protocol that processes and indexes network data to provide application-specific functionality. It sits at the top layer of the protocol's architecture, consuming relay firehoses and hydrating repository data into useful, queryable data tailored to specific social applications. The AT Protocol's architecture allows for multiple AppViews serving the same content to exist simultaneously, each potentially offering different features, moderation policies, or performance characteristics. The goal of this architecture is to provide a "credible exit" for users, allowing them to switch to alternative AppViews that better align with their preferences if they become unhappy with their AppView of choice. This flexibility extends to developers as well. Different social applications built on the AT Protocol can create their own specialized AppViews that interpret and index repository records according to their specific needs, while still leveraging the same underlying Personal Data Server (PDS) and relay infrastructure.`

# **Transitional Strategy**

# **Draft Specification**

**`Communization of Knowledge:`**  
`The goal is that no community, however isolated, should lack access to the sum total of human productive knowledge.`

- **`Open Recipe Libraries:`**
  - `indexed by SNE, metabolic impact, and bioregional suitability`
  - **`OpenSourceEcologies`**
- **`Documentation`**
- **`Translation`**
- **`Other Key Recipes`**

**`Planning across borders:`**

**`Inspirations:`**  
_`Critique of the Gotha Program`_`, Karl Marx`  
_`Grundrisse`_`, Karl Marx`  
_`Capital Vol. 1`_`, Karl Marx`  
_`Capital Vol. 2`_`, Karl Marx`  
_`Capital Vol. 3`_`, Karl Marx`  
_`The Paris Commune`_`, Karl Marx`  
_`Negotiated Coordination`_`, Pat Devine`  
_`Towards a New Socialism`_`, Paul Cockshott`  
_`People's Republic of Walmart,`_ `Leigh Phillips and Michael Rozworski`  
`Project Cybersyn, Revolutionary Chile`

