# Index Pipeline: The VF Indexes Layer

This document analyses the eight indexes in `src/lib/core/value-flows/indexes/`, the shared
utilities that power them, and the design logic behind the dual spatial/temporal treatment
of VF objects. A dedicated section covers how the indexes relate to — and differ from —
`PlanNetter`.

---

## Shared Infrastructure

Every index is built on the same two utilities.

### `HexIndex<T>` (utils/space-time-index.ts)

A generic hierarchical container that stores items at **all H3 resolutions simultaneously**.
When an item is added at leaf resolution 9 (≈ 174m), its ID is propagated to every ancestor
node up to root resolution 0 (the globe). Aggregated stats (`count`, `sum_quantity`,
`sum_hours`) flow upward the same way. This means a single `HexNode` at resolution 4 (≈
city scale) already contains the summed stats for everything within its boundary — no
re-scan is needed.

Each `HexNode` also contains a `TemporalIndex` with the same four-level hierarchy as
`AvailabilityWindow` (months → weeks → days → time_ranges) plus a `specific_dates` map
for point-in-time items. An item is distributed into the temporal tree at the *same time*
it is added to the spatial tree, so a single `queryHexOnDate(index, location, date)` call
performs a spatial-radius + temporal-filter intersection in one pass.

```
addItemToHexIndex(index, item, id, { lat, lon, h3_index }, stats, temporalExpression?)
  → walks H3 hierarchy leaf→root
      at each level: node.items.add(id), node.stats += stats
      at each level: indexItemTemporally(node.temporal, id, temporalExpression)
```

**Key property**: because item IDs are stored at ALL ancestor levels, a coarse-resolution
query (e.g. "all demand in this city") is O(1) — just read the HexNode at the right
resolution. No subtree traversal.

### Space-Time Signatures (utils/space-time-keys.ts)

`getSpaceTimeSignature(ctx, h3Resolution=7)` → `"${timeKey}::${locKey}"`

The **time key** is either:
- `"recurring|${canonicalWindowString}"` — for Intents/Commitments/Agents with an
  `availability_window`. The canonical string is deterministic (all arrays sorted), so two
  identical windows always produce the same key.
- `"${startDate}|${endDate}|onetime"` — for point-in-time objects (hasBeginning/hasEnd,
  or due).
- `"specific|${sortedDates}"` — for SpecificDateWindow.

The **location key** is an H3 cell at the requested resolution (default 7, ≈ 1.2 km), or
`"remote"` for online/location-independent objects.

This signature is the **cross-index join key**: an Intent, a Commitment, and an
AgentCapacity with the same signature are "co-located in space and time" — a necessary
(but not sufficient) condition for them to participate in the same process.

**VF bridge functions** convert VF types into `SpaceTimeContext`:

```ts
intentToSpaceTimeContext(intent, resolvedSpatialThing?, h3Resolution)
  → { latitude, longitude, h3_index,
      availability_window: intent.availability_window,
      start_date: intent.hasBeginning ?? hasPointInTime,
      end_date:   intent.hasEnd ?? intent.due ?? hasPointInTime }

commitmentToSpaceTimeContext(commitment, ...)   // identical mapping
economicEventToSpaceTimeContext(event, ...)     // no availability_window; uses created as fallback
```

**`toDateKey(iso)`** extracts a `YYYY-MM-DD` string from any ISO datetime.
**`wrapDate(dateKey)`** wraps it in `{ specific_dates: [dateKey] }` — this is the canonical
way to put a one-off object into the temporal hierarchy's `specific_dates` map rather than
`full_time`.

---

## The Eight Indexes

### 1. `EconomicResourceIndex`

```ts
interface EconomicResourceIndex {
    resources:         Map<id, EconomicResource>
    spec_index:        Map<specId, Set<resourceId>>        // conformsTo
    accountable_index: Map<agentId, Set<resourceId>>       // primaryAccountable
    stage_index:       Map<processSpecId, Set<resourceId>> // stage
    location_index:    Map<spatialThingId, Set<resourceId>>// currentLocation (raw VF ID)
    cell_index:        Map<h3Cell, Set<resourceId>>        // H3 at build resolution
    spatial_hierarchy: HexIndex<EconomicResource>
}
```

**Build**: For each resource, resolve `currentLocation` → `SpatialThing` → H3 cell.
`addItemToHexIndex` is called **without a temporal argument** — the function signature
accepts `TemporalExpression | undefined`, and passing `undefined` causes the item to land
in `full_time` (always-present). This is intentional: resources are current-state
snapshots. Their `availability_window` field (when present on the schema) is a gate checked
at query time by `PlanNetter`, not encoded into the index.

**Two spatial indexes**:
- `cell_index` — exact H3 cell at the build resolution. Used for O(1) cross-index joins
  ("what inventory is co-located with this commitment?").
- `spatial_hierarchy` — multi-resolution HexIndex. Used for radius queries
  (`queryResourcesBySpecAndLocation`).

**No `space_time_index`**: Resources have no temporal dimension in the index. They join to
Intents/Commitments via the shared `h3Cell` string.

**Notable absence**: `containedIn` is not indexed here. Containment filtering happens in
`PlanNetter.netDemand/netAvailableQty` at query time: `if (r.containedIn !== undefined) skip`.

---

### 2. `IntentIndex`

```ts
interface IntentIndex {
    intents:           Map<id, Intent>
    spec_index:        Map<specId, Set<intentId>>
    action_index:      Map<action, Set<intentId>>
    agent_index:       Map<agentId, Set<intentId>>     // both provider and receiver
    plan_index:        Map<planId, Set<intentId>>
    space_time_index:  Map<sig, Set<intentId>>
    spatial_hierarchy: HexIndex<Intent>
}
```

**Build**:
```ts
ctx = intentToSpaceTimeContext(intent, resolvedSt, h3Resolution)
sig = getSpaceTimeSignature(ctx, h3Resolution)
space_time_index[sig].add(intent.id)

addItemToHexIndex(index.spatial_hierarchy, intent, intent.id,
    { lat, lon, h3_index },
    { quantity: resourceQuantity, hours: effortQuantity },
    intent.availability_window ?? wrapDate(toDateKey(intent.hasBeginning ?? intent.hasPointInTime))
)
```

**Temporal treatment**: If the Intent has an `availability_window` it goes into the
recurring tree. If it has `hasBeginning`, it gets `wrapDate(hasBeginning)` → lands in
`specific_dates`. If it has neither (and no location), it is not added to the hierarchy
at all (no `st` → the `if (st)` guard skips).

**Key distinction from IndependentDemandIndex**: `IntentIndex` holds **all** Intents —
satisfied, unsatisfied, and finished. It is the discovery index ("show me all offers of
type X near Y"). `IndependentDemandIndex` is the demand register ("what has been requested
and how much of it is still open?").

---

### 3. `CommitmentIndex`

```ts
interface CommitmentIndex {
    commitments:     Map<id, Commitment>
    spec_index:      Map<specId, Set<commitmentId>>
    action_index:    Map<action, Set<commitmentId>>
    agent_index:     Map<agentId, Set<commitmentId>>
    plan_index:      Map<planId, Set<commitmentId>>
    process_index:   Map<processId, Set<commitmentId>>  // inputOf | outputOf
    satisfies_index: Map<intentId, Set<commitmentId>>   // which commitments satisfy which intent
    space_time_index: Map<sig, Set<commitmentId>>
    spatial_hierarchy: HexIndex<Commitment>
}
```

**Build**: Identical temporal treatment to `IntentIndex`. The extra indexes:
- `process_index` — both `inputOf` and `outputOf` are indexed. This is how scheduled
  output Commitments (supply) and scheduled consumption Commitments (demand on supply) are
  distinguished.
- `satisfies_index` — maps Intent ID → Set of Commitment IDs that satisfy it. This
  supports partial fulfillment tracking in `IndependentDemandIndex`.

---

### 4. `EconomicEventIndex`

```ts
interface EconomicEventIndex {
    events:                Map<id, EconomicEvent>
    spec_index:            Map<specId, Set<eventId>>
    action_index:          Map<action, Set<eventId>>
    agent_index:           Map<agentId, Set<eventId>>
    resource_index:        Map<resourceId, Set<eventId>>  // from + to resources
    process_index:         Map<processId, Set<eventId>>   // inputOf + outputOf
    space_time_index:      Map<sig, Set<eventId>>         // keyed by atLocation
    origin_hierarchy:      HexIndex<EconomicEvent>        // by atLocation
    destination_hierarchy: HexIndex<EconomicEvent>        // by toLocation
}
```

**This is the only index with two spatial hierarchies.** The reason: transport events
(`move`, `transferCustody`, `pickup`/`dropoff`) have both an origin (`atLocation`) and a
destination (`toLocation`). A single hierarchy would force a choice — you'd lose either
the origin or destination from spatial queries. With two hierarchies:
- `queryEventsByOrigin(location)` — "what economic activity happened at this location?"
- `queryEventsByDestination(location)` — "what arrived at this location?"

For non-transport events (no `toLocation`), only `origin_hierarchy` is populated.

**Temporal treatment**: Events are always point-in-time facts. They use
`wrapDate(toDateKey(hasPointInTime ?? hasBeginning ?? created))`. No `availability_window`
possible — events are immutable observations.

**`resource_index`** indexes both `resourceInventoriedAs` and `toResourceInventoriedAs`,
so a query for "all events touching resource X" returns transfer events from both sides.

---

### 5. `AgentIndex`

```ts
interface AgentIndex {
    agents:           Map<id, Agent>
    agent_capacities: Map<capId, AgentCapacity>       // ONE per (agent, space-time-sig)
    spec_index:       Map<specId, Set<capId>>
    space_time_index: Map<sig, Set<capId>>
    spatial_hierarchy: HexIndex<AgentCapacity>
}
```

**This is the most complex index** because it must solve the double-counting problem: an
agent publishing work Intents for multiple skills in the same time window must not be
counted multiple times when totalling available hours.

**Build — deduplication logic**:
```ts
for intent of intents where action === 'work' and provider set:
    sig = getSpaceTimeSignature(intentToSpaceTimeContext(intent, resolvedSt))
    capacityId = `${intent.provider}|${sig}`

    if accumulator.has(capacityId):
        existing.max_hours = max(existing.max_hours, intent.effortQuantity)
        existing.resource_specs.add(intent.resourceConformsTo)   // union skills
    else:
        accumulator.set(capacityId, { max_hours: hours, resource_specs: {specId}, ... })
```

After accumulation, one `AgentCapacity` is committed per `(agent, sig)`. The
`spec_index` maps each skill to this shared node — so summing hours from a skill query
is safe regardless of how many skills the agent offers.

**Committed hours**: The build function also accepts `commitments: Commitment[]`. For each
capacity node, it sums `effortQuantity` from work Commitments whose provider matches and
whose time window overlaps the capacity's `[start_date, end_date]`. The result is baked
into `committed_hours` and `remaining_hours = max(0, total_hours - committed_hours)`.

**`netEffortHours(agentId, dt, index)`** is a pure function over this pre-built index —
no planStore scan, no commitment re-computation at query time.

**Spatial hierarchy**: Built with the capacity node's own `availability_window` (if set)
or `start_date`. This enables `queryHexOnDate` to find agents available on a specific date
within a radius.

---

### 6. `IndependentDemandIndex`

```ts
interface IndependentDemandIndex {
    demands:           Map<intentId, DemandSlot>      // ALL non-finished Intents
    cell_index:        Map<h3Cell, Set<intentId>>
    spec_index:        Map<specId, Set<intentId>>
    action_index:      Map<action, Set<intentId>>
    plan_demand_index: Map<planId, Set<commitmentId>> // independentDemandOf
    space_time_index:  Map<sig, Set<intentId>>
    spatial_hierarchy: HexIndex<DemandSlot>           // stats use remaining quantities
}
```

**DemandSlot**:
```ts
interface DemandSlot {
    intent_id, spec_id, action,
    fulfilled_quantity, fulfilled_hours,  // sum of satisfying Commitments + Events
    remaining_quantity, remaining_hours,  // max(0, required - fulfilled)
    required_quantity, required_hours,    // from the Intent itself
    h3_cell, due, provider, receiver
}
```

**This is the demand register** — all non-finished Intents, including those that are
partially or fully satisfied. This contrasts with `IntentIndex` (which holds every Intent,
including finished ones) and with the old design (which excluded satisfied Intents entirely).

**Build — two phases**:

*Phase 1*: Compute partial fulfillment quantities per Intent.
```ts
for c of commitments where c.satisfies:
    fulfilledQty[c.satisfies]   += c.resourceQuantity
    fulfilledHours[c.satisfies] += c.effortQuantity
// same pass for events
```

*Phase 2*: For each non-finished Intent, create a `DemandSlot` with both the raw required
quantities and the derived fulfilled/remaining values. All non-finished Intents are indexed,
regardless of whether `remaining > 0`.

```ts
slot = DemandSlot {
    fulfilled_quantity:  fulfilledQty[intent.id]   ?? 0,
    fulfilled_hours:     fulfilledHours[intent.id] ?? 0,
    remaining_quantity:  max(0, required - fulfilled),
    remaining_hours:     max(0, requiredHours - fulfilledHours),
    ...
}
index.demands.set(intent.id, slot)
```

**Spatial hierarchy stats use `remaining_quantity`** — a fully-satisfied demand contributes
zero to the aggregate seen by planners. Discovery queries ("how much demand exists in this
area?") therefore still get planning-correct answers.

*Phase 3* (separate loop): Index Commitments with `independentDemandOf` set into
`plan_demand_index`.

**`queryOpenDemands(index)`** — the filtered planning frontier:
```ts
// Open = at least one specified dimension still has remaining > 0,
// OR no quantity was specified at all (pure action demand)
[...index.demands.values()].filter(s =>
    s.remaining_quantity > 0 ||
    s.remaining_hours > 0 ||
    (s.required_quantity === 0 && s.required_hours === 0)
)
```

**Primary leaf-level query**:
```ts
queryDemandBySpecAndLocation(index, specId, { h3_index, radius_km })
// "Can this recipe's output satisfy any demand near this location?"
// Note: returns ALL demands (including satisfied). Caller may filter with queryOpenDemands.
```

---

### 7. `IndependentSupplyIndex`

```ts
interface IndependentSupplyIndex {
    supply_slots:      Map<slotId, SupplySlot>
    spec_index:        Map<specId, Set<slotId>>
    cell_index:        Map<h3Cell, Set<slotId>>
    spatial_hierarchy: HexIndex<SupplySlot>    // sum_quantity=material, sum_hours=labor
}
```

**SupplySlot**:
```ts
interface SupplySlot {
    id: string;           // `inv:${resourceId}` | `sched:${id}` | `labor:${capacityId}`
    slot_type: 'inventory' | 'scheduled_receipt' | 'labor';
    spec_id?: string;     // undefined for labor slots
    quantity: number;     // material units; 0 for labor
    hours: number;        // labor hours; 0 for material
    h3_cell?: string;
    available_from?: string;   // scheduled receipts only
    agent_id?: string;         // labor slots only
    source_id: string;
}
```

**This is the supply-side counterpart of `IndependentDemandIndex`** — a pre-planning
snapshot indexed across three strata:

**Stratum 1 — Inventory** (`slot_type: 'inventory'`):
```ts
for resource of resources:
    if resource.containedIn → skip           // not top-level
    if onhandQuantity <= 0  → skip           // depleted
    slot = { id: 'inv:' + resourceId, quantity: onhandQuantity, spec_id: conformsTo, ... }
```
Each slot maps directly to one EconomicResource. `spec_index` is populated via `conformsTo`.

**Stratum 2 — Scheduled Receipts** (`slot_type: 'scheduled_receipt'`):
```ts
for intent/commitment where outputOf set and !finished and action !== 'work':
    slot = { id: 'sched:' + id, quantity: resourceQuantity, available_from: hasEnd ?? due, ... }
```
These are future production outputs that PlanNetter also reads via its `outputOf` scan.

**Stratum 3 — Labor** (`slot_type: 'labor'`):
```ts
for capacity of agentIndex.agent_capacities.values():
    if remaining_hours <= 0 → skip
    slot = { id: 'labor:' + capacityId, hours: remaining_hours, agent_id, ... }
    // spec_index: add this slot under EACH of capacity.resource_specs
```
Labor slots are indexed under **every skill** the agent offers in that space-time context.
This is the same reference-only pattern as `AgentIndex.spec_index` — no hour duplication.

**No `space_time_index`**: Spatial + spec queries are sufficient. Labor slots already carry
temporal context via their source `AgentCapacity` (from `AgentIndex`).

**Spatial hierarchy stats**: `sum_quantity` accumulates material (inventory +
scheduled_receipt), `sum_hours` accumulates labor. A single HexNode gives the full
supply picture for a cell.

---

### 8. `ProposalIndex`

```ts
interface ProposalIndex {
    proposals:         Map<id, Proposal>
    purpose_index:     Map<'offer'|'request', Set<proposalId>>
    scope_index:       Map<agentId, Set<proposalId>>
    space_time_index:  Map<sig, Set<proposalId>>
    spatial_hierarchy: HexIndex<Proposal>
}
```

The simplest index. Proposals use `eligibleLocation` (not `atLocation`) for spatial
context — they express where a proposal is *valid*, not where a process occurs.

**No spec_index**: Proposals group Intents via `publishes` and `reciprocal` arrays. The
spec-level query is answered by following those links into `IntentIndex`.

**Temporal treatment**: `wrapDate(toDateKey(proposal.hasBeginning))` — always point-in-time.

---

## Structural Patterns Across All Eight

### Uniform build signature

Every index builder takes `(items[], locations: Map<id, SpatialThing>, h3Resolution = 7)`.
The `locations` map is required because VF objects carry `atLocation: string` (a
SpatialThing ID), not raw coordinates. A missing entry in `locations` silently drops the
object from all spatial indexes — it still appears in the flat maps but is invisible to any
location-based query.

### The temporal argument to `addItemToHexIndex`

| Index | Temporal argument passed |
|-------|------------------------|
| EconomicResource | *(none)* — falls to `full_time` |
| Intent | `availability_window` OR `wrapDate(hasBeginning ?? hasPointInTime)` |
| Commitment | `availability_window` OR `wrapDate(hasBeginning ?? hasPointInTime)` |
| EconomicEvent | `wrapDate(hasPointInTime ?? hasBeginning ?? created)` — always specific date |
| AgentCapacity | `availability_window` from the contributing Intent |
| DemandSlot | `availability_window` OR `wrapDate(hasBeginning ?? hasPointInTime)` |
| SupplySlot | *(none)* — inventory is always-present; labor temporal handled via AgentIndex |
| Proposal | `wrapDate(hasBeginning)` — always specific date |

**Why resources get no temporal argument**: Resources are current-state snapshots. The
inventory quantity is already the result of all past events. Temporal availability (if any)
is checked via `PlanNetter` at query time.

**Why SupplySlots get no temporal argument**: Inventory slots are snapshots (same as
EconomicResource). Scheduled receipt slots carry `available_from` for callers to filter,
but aren't indexed temporally — the spatial+spec intersection is the primary query. Labor
slots inherit temporal context from their source AgentCapacity, but that context is already
baked into `remaining_hours`; re-indexing temporally would be redundant.

### The `space_time_index` join key

Six of the eight indexes write to a `space_time_index: Map<sig, Set<id>>` using the exact
same key produced by `getSpaceTimeSignature`. EconomicResource and IndependentSupplyIndex
are the exceptions — both have `cell_index` (spatial only).

---

## PlanNetter vs the Indexes

This is the central architectural tension in the planning stack.

### What PlanNetter does

`PlanNetter` maintains **live soft-allocation state** during a planning run. Its three
methods all scan `planStore.allIntents()` and `planStore.allCommitments()` in O(n):

```
netDemand(specId, qty, opts?):
    Step 1: observer.conformingResources(specId)     → O(n) filter
    Step 2: planStore.allIntents() where outputOf    → O(n) scan
    Step 3: planStore.allCommitments() where outputOf → O(n) scan
    → marks each consumed source in this.allocated

netSupply(specId, qty, availableFrom?, atLocation?):
    planStore.allIntents() where inputOf              → O(n) scan
    planStore.allCommitments() where inputOf          → O(n) scan
    → marks consumed consumptions in this.allocated

netAvailableQty(specId, opts?):   // READ-ONLY
    inventory + outputOf - inputOf (all O(n) scans, no mutation)
```

PlanNetter's core invariant: the `allocated` Set prevents the same flow from being
absorbed twice across multiple calls within one planning session. This statefulness is
essential — it is what makes Mode C (run demand explosion, then supply explosion over the
same netter) correct.

### What the indexes provide

| Question | PlanNetter | Index |
|----------|-----------|-------|
| "What inventory exists for spec X?" | O(n) observer scan | `querySupplyBySpec(supplyIndex, specId)` → O(1) |
| "What supply exists near location L?" | Not possible | `querySupplyByLocation(supplyIndex, query)` → O(1) H3 |
| "What demand exists for spec X?" | Not available | `queryDemandBySpec(demandIndex, specId)` → O(1) |
| "How much demand is still open?" | Not available | `queryOpenDemands(demandIndex)` |
| "What has been fulfilled vs. required?" | Not available | `DemandSlot.fulfilled_quantity/remaining_quantity` |
| "How much labor is available?" | Not available | `querySupplyBySpec(supplyIndex, specId).filter(s => s.slot_type === 'labor')` |
| "Is this flow already soft-allocated?" | `this.allocated.has(id)` | Not tracked |
| "Net available after in-progress allocations?" | `netAvailableQty(specId)` | Not available |

### The key distinction: snapshot vs. live state

```
IndependentSupplyIndex  =  the supply landscape at build time (t=0)
                           before any planning run begins

PlanNetter              =  the supply landscape at query time (t=now)
                           = IndependentSupplyIndex - allocated flows
                             + new output flows created by the planning run
```

`IndependentSupplyIndex` is built **once** from a dataset. It answers "what supply exists
and where?" without mutating anything. It is correct for:
- Pre-planning feasibility estimates ("can this demand be met at all?")
- Spatial discovery ("where is supply of X concentrated?")
- Dashboard views of supply distribution

`PlanNetter` is created **per planning session** and its `allocated` Set grows as each
call soft-claims a flow. It is correct for:
- Mid-planning netting ("given what we've already planned, how much is left?")
- Mode C: demand explosion followed by supply explosion over the same state

### Coverage overlap

`IndependentSupplyIndex`'s three strata directly mirror PlanNetter's three data sources:

| PlanNetter source | IndependentSupplyIndex stratum |
|-------------------|-------------------------------|
| `observer.conformingResources(specId)` | `inventory` slots |
| `planStore.allIntents() where outputOf` | `scheduled_receipt` slots (intents) |
| `planStore.allCommitments() where outputOf` | `scheduled_receipt` slots (commitments) |
| `netSupply`'s inputOf scan (deductions) | Not captured — PlanNetter-only concept |

The `inputOf` (scheduled consumption) scan in `netSupply` / `netAvailableQty` has no
analog in `IndependentSupplyIndex`. Consumption is a demand-side concept captured by
`IndependentDemandIndex` — though only for Intents with no `inputOf` filter currently.
This is a deliberate scope boundary: the supply index shows gross supply; PlanNetter's
netting computes net supply after deducting pre-committed consumptions.

### Current gap: PlanNetter does not use the indexes

PlanNetter currently calls `planStore.allIntents()` and `planStore.allCommitments()` for
every method call. It does not read from `IntentIndex`, `CommitmentIndex`, or
`IndependentSupplyIndex`. This means:

- Every `netDemand` call is O(intents + commitments)
- Every `netAvailableQty` call is O(4 × n) — four separate scans
- The spatial guard (`opts.atLocation`) is a linear filter, not an index lookup

The indexes provide O(1) spec and spatial lookups over the same data. A future refactor
could give `PlanNetter` an `IndependentSupplyIndex` at construction time, replacing the
linear scans with indexed lookups (adjusting for the `allocated` set at result time). This
is not done yet — the current split is a clear design boundary: indexes are analytical,
PlanNetter is transactional.

---

## The Build Pipeline in Full

```
Caller assembles:
  intents: Intent[]
  commitments: Commitment[]
  events: EconomicEvent[]
  resources: EconomicResource[]
  agents: Agent[]
  proposals: Proposal[]
  locations: Map<SpatialThingId, SpatialThing>   ← must pre-resolve all atLocation IDs

                ↓ one call per type

buildIntentIndex(intents, locations)
  for each intent:
    ctx = intentToSpaceTimeContext(intent, locations.get(intent.atLocation))
    sig = getSpaceTimeSignature(ctx)                    → space_time_index[sig]
    spec_index, action_index, agent_index, plan_index   → flat secondary indexes
    addItemToHexIndex(hierarchy, intent, id,
        { lat, lon, h3 },
        { quantity: resourceQty, hours: effortQty },
        intent.availability_window ?? wrapDate(toDateKey(hasBeginning)))

buildCommitmentIndex(commitments, locations)
  same + process_index (inputOf/outputOf) + satisfies_index (satisfies→intentId)

buildEconomicEventIndex(events, locations)
  origin_hierarchy  ← addItemToHexIndex by atLocation
  destination_hierarchy ← addItemToHexIndex by toLocation  (if toLocation exists)
  space_time_index keyed by atLocation only

buildEconomicResourceIndex(resources, locations)
  cell_index[h3@res7]  ← exact cell for cross-index joins
  spatial_hierarchy    ← NO temporal argument → always full_time
  NO space_time_index

buildAgentIndex(workIntents, agents, locations, commitments?)
  accumulate → ONE AgentCapacity per (provider, sig)
    max_hours over same-window multi-skill intents
    committed_hours from overlapping work Commitments
    remaining_hours = max(0, total - committed)
  spatial_hierarchy with availability_window → temporal query supported

buildIndependentDemandIndex(intents, commitments, events, locations)
  Phase 1: fulfilledQty, fulfilledHours (per intent, from all satisfying commitments+events)
  Phase 2: DemandSlot{required, fulfilled, remaining} for ALL non-finished Intents
           → demands map (replaces old open_demands; includes satisfied)
           → spatial_hierarchy stats use remaining (not required)
           + plan_demand_index from commitments.independentDemandOf

  queryOpenDemands(index) → remaining>0 || no qty specified

buildIndependentSupplyIndex(resources, intents, commitments, agentIndex, locations)
  Stratum 1: inventory slots from EconomicResources (onhand > 0, not contained)
  Stratum 2: scheduled_receipt slots from outputOf Intents/Commitments (non-work, non-finished)
  Stratum 3: labor slots from agentIndex.agent_capacities (remaining_hours > 0)
             spec_index: each resource_spec → same labor slot (reference-only)

buildProposalIndex(proposals, locations)
  purpose_index, scope_index
  spatial_hierarchy keyed by eligibleLocation

                ↓ all indexes built

Query layer:
  PlanNetter.netDemand/netSupply/netAvailableQty
    → observer.inventory (EconomicResource objects, not the index)
    → planStore.allIntents/allCommitments (live O(n) scan, not the indexes)
    → this.allocated set tracks soft-allocations across calls
    → atLocation guard uses raw SpatialThing IDs (not H3)

  dependent-demand BFS:
    → netter.netDemand (soft-allocate inventory + scheduled outputs)
    → RecipeStore to find applicable recipes
    → createFlowRecord → writes new Intents/Commitments to planStore

  queryDemandBySpecAndLocation(demandIndex, specId, { h3_index, radius_km })
    → "what demand exists for this spec near this location?"

  queryOpenDemands(demandIndex)
    → "what demand is still actionable?"

  querySupplyBySpecAndLocation(supplyIndex, specId, { h3_index, radius_km })
    → "what supply of this spec exists near this location?" (pre-planning snapshot)

  queryAgentsBySpecAndLocation(agentIndex, specId, { h3_index, radius_km })
    → "what labor capacity exists for this skill near this location?"

  netEffortHours(agentId, dt, agentIndex)
    → pure function over AgentIndex.agent_capacities, no live scan
```

---

## Key Design Observations

### Indexes are read-only snapshots; PlanNetter carries live state

The indexes are built once from a dataset and answer analytical questions (discovery,
aggregation, radius queries). PlanNetter does **not** use the indexes — it calls
`observer.conformingResources()` and `planStore.allIntents()` directly, for live data that
reflects in-progress soft-allocations. This is a deliberate split: indexes answer "what
exists?", PlanNetter answers "what is still unallocated right now?".

### `IndependentDemandIndex` stores all demands, not just open ones

Previously, only unsatisfied Intents appeared in `open_demands`. Now all non-finished
Intents appear in `demands`, with `fulfilled_quantity` and `remaining_quantity` on each
slot. `queryOpenDemands()` provides the old filtered view. This enables:
- Fulfillment tracking at index time without a second pass
- "How much of this demand has been fulfilled?" — directly on the slot
- Spatial hierarchy stats still reflect `remaining` (not `required`) — planners see
  the actual gap, not the original ask

### `IndependentSupplyIndex` mirrors PlanNetter's data sources — without state

The three strata of `IndependentSupplyIndex` (inventory, scheduled_receipt, labor) are
exactly the same objects that PlanNetter scans. The index is the analytical pre-image of
PlanNetter's operational view. Use the index for discovery and estimation; use PlanNetter
for in-session allocation.

### `EconomicResourceIndex` has no temporal dimension on purpose

An inventory snapshot is just that — a snapshot. The `HexNode.stats.sum_quantity` for a
resource cell tells you how much is there **now**, not when it was available. Temporal
availability gating (if any) is a query-time concern (`isWithinTemporalExpression`), not an
index-time concern.

### `EconomicEventIndex` has two spatial hierarchies because transport is directional

Any event that moves something — `move`, `transferCustody`, `pickup`/`dropoff` — has a
meaningful `toLocation` distinct from `atLocation`. A logistics analysis needs to answer
both "what left location A?" (origin) and "what arrived at location B?" (destination).
Putting events in two hierarchies handles this without duplicating event records.

### The `satisfies_index` on `CommitmentIndex` is the partial-fulfillment backbone

`IndependentDemandIndex` is built by iterating all Commitments and looking up
`c.satisfies` to compute per-intent fulfilled quantities. The `CommitmentIndex.satisfies_index`
is the fast path for the inverse query: "given an Intent, which Commitments satisfy it?"
Both directions are needed.

### `AgentIndex.remaining_hours` vs. `PlanNetter`-era committed_hours

`AgentIndex` bakes committed hours in at build time. `ScheduleBook.committedEffortOn`
recomputes from the live `planStore` at query time. They answer the same question by
different means:
- `AgentIndex.remaining_hours` — fast, stale after new commitments are added post-build
- `ScheduleBook.committedEffortOn` — always current, requires a planStore scan each call

`netEffortHours` (the pure function in agents.ts) uses the index path. Callers that need
real-time accuracy should rebuild the index or use `committedEffortOn` directly.

### Silent spatial dropout

If `locations.get(intent.atLocation)` returns `undefined` (the SpatialThing wasn't
provided), the intent still appears in `intents`, `spec_index`, `agent_index`, etc. — but
is absent from `space_time_index`, `spatial_hierarchy`, and `cell_index`. It becomes
spatially invisible while remaining logically present. There is no warning or error.
