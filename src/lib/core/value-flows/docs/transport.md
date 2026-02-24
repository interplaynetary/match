# Transport in VF Planning

## Segments

A single transport process maps to one carrier leg — one vehicle, one departure point,
one arrival point:

```
RecipeProcess "Truck FarmA→Hub"
  Input:  pickup  spec:wool  qty N  atLocation: loc:FarmA
  Output: dropoff spec:wool  qty N  atLocation: loc:Hub

RecipeProcess "Train Hub→FactoryB"
  Input:  pickup  spec:wool  qty N  atLocation: loc:Hub
  Output: dropoff spec:wool  qty N  atLocation: loc:FactoryB
```

These connect through an intermediate resource at Hub. The algorithms already handle
this correctly — the `internallyConsumedSpecs` set in both `dependentDemand` and
`dependentSupply` prevents the intermediate `wool@Hub` from generating a sub-demand or
appearing as surplus. **Multi-leg transport is a multi-process recipe chain.** The number
of segments is just the number of processes.

Route selection falls out from SNLT ranking. A direct route (FarmA→FactoryB, 6h) and a
relay (FarmA→Hub 4h + Hub→FactoryB 2h, plus loading time) registered as separate recipes
compete on SNLT — the more efficient route wins. No extra machinery needed.

---

## Capacity: the truck is an EconomicResource

A truck is not just a process shape — it is an `EconomicResource` that can be `use`d.
This is exactly what the `use` action is for:

> *"use is employed for equipment or tools that are used in a process, but not consumed.
> After the process, the piece of equipment or tool still exists, but during the process,
> it is unavailable. The unavailability can be useful to know if the resource must be
> scheduled."* — VF spec, actions.md

So the truck lives in the Observer as an inventoried resource:

```
EconomicResource {
  id:               'res:truck-1',
  conformsTo:       'spec:truck-20t',
  currentLocation:  'loc:FarmA',
  accountingQuantity: { hasNumericalValue: 20000, hasUnit: 'kg' }  // cargo capacity
}
```

The `accountingQuantity` here represents **cargo capacity**, not count of trucks. The
transport recipe then `use`s it:

```
RecipeProcess "Truck FarmA→FactoryB"
  Input: use    spec:truck-20t  resourceQuantity: { qty: N, unit: 'kg' }
  Input: pickup spec:wool       resourceQuantity: { qty: N, unit: 'kg' }  atLocation: loc:FarmA
  Output: dropoff spec:wool     resourceQuantity: { qty: N, unit: 'kg' }  atLocation: loc:FactoryB
```

### Why `use` and not `consume`

`consume` would permanently decrement the truck's `accountingQuantity` — wrong, trucks
survive trips. `use` has `accountingEffect: 'noEffect'` — the truck's inventory balance
is untouched, but the resource was occupied during the process. Semantically perfect.

### How capacity flows through the planning machinery

`computeMaxByOtherMaterials` treats the `use spec:truck-20t qty N` input as a
complementary constraint. With a `PlanNetter`, it calls:

```ts
netter.netAvailableQty('spec:truck-20t', { asOf: departureTime })
```

Which computes:
```
observer inventory (truck's accountingQty = 20,000 kg)
+ scheduled output intents for spec:truck-20t (none — trucks aren't produced)
− scheduled use intents for spec:truck-20t (each planned trip's `use` input)
= remaining cargo capacity
```

`maxForThisInput = floor(remainingCapacity / N)` naturally caps recipe executions at what
the truck can carry. Each planned trip adds a `use spec:truck-20t qty N` intent to the
planStore, which future `netAvailableQty` calls subtract. Capacity enforcement is
automatic through existing machinery — no special transport logic needed.

### Consolidation

When multiple goods shipments share one truck, they appear as separate pickup inputs on
the same transport process, each with its own `use spec:truck-20t qty N` input. The
netter sums all committed `use` intents against the truck's 20,000 kg baseline. Capacity
is respected across consolidated shipments.

---

## Two capacity dimensions: weight vs. time

The `use` model handles **cargo capacity** (kg per trip) cleanly. A second dimension is
**temporal availability** — the same truck can make two sequential trips per day, each
at full capacity.

`netAvailableQty` subtracts all planned `use` intents regardless of when they are
scheduled. After planning a 15,000 kg morning trip, the truck shows only 5,000 kg
available — even for an afternoon trip that would start after the morning one completes.
The netter doesn't know the trips are temporally disjoint.

This is an approximation that is correct for the common case (one trip per planning
horizon per vehicle) and conservative otherwise (it under-allocates rather than
over-allocates). For multi-trip scheduling of the same physical vehicle, the right model
is to represent each trip window as a separate resource instance:

```
res:truck-1-monday-am:  accountingQuantity: 20000 kg
res:truck-1-monday-pm:  accountingQuantity: 20000 kg
```

Both conform to `spec:truck-20t`. The recipe `use`s whichever one is available. This
collapses into an explicit schedule, which is appropriate once planning reaches the
dispatch horizon.

---

## Containment: goods in transit

While planned capacity is enforced through `use` intents, the **observed state during
transit** is expressed through the `containedIn` relation on `EconomicResource`. When
wool is loaded onto a truck, it becomes spatially bound to that truck:

```
EconomicResource { id: 'res:wool-batch-42', containedIn: 'res:truck-1', ... }
```

This has three consequences:

### Location derivation

A resource's effective location during transit is its container's `currentLocation`,
not its own. The `containedIn` chain may nest — a pallet in a container on a ship —
and the effective location walks up to the first ancestor with a concrete `currentLocation`.
This means **goods in transit need no independent location tracking**; moving the truck
(via a `move` event) implicitly moves everything inside it.

### Observed capacity

The Observer can compute actual truck load directly from containment:

```ts
const loadedKg = observer.resourcesContainedIn('res:truck-1')
    .reduce((sum, r) => sum + (r.accountingQuantity?.hasNumericalValue ?? 0), 0);
const remainingCapacity = truck.accountingQuantity.hasNumericalValue - loadedKg;
```

This is the *observed* complement to the *planned* `use` intent model. Planning books
capacity via `netAvailableQty`; observation reads it from what is actually loaded.

### Load and unload as events

Setting and clearing `containedIn` requires explicit events. A pickup event on the wool
(action: `transferCustody` or a custom `load` action) updates `containedIn` to the truck.
A dropoff event clears it. These events appear in `trace()` / `track()` traversals,
giving full provenance: the wool was in transit on truck-1 between these two timestamps.

### Containment and the recipe

At the recipe level, the pickup input and dropoff output implicitly manage containment:
the pickup takes wool from FarmA, and while the transport process runs the wool is
logically inside the truck. The recipe doesn't need to spell this out — it falls out of
the event sequence in the Observer once events carry both `inputOf`/`outputOf` process
links and `containedIn` updates.

---

## Truck location after a trip

`use` has `locationEffect: 'noEffect'` — recording a `use` event on the truck doesn't
update its `currentLocation` in the Observer. After a trip from FarmA to FactoryB, the
truck physically moved but the Observer still shows it at FarmA.

To track the truck's location, record a separate `move` event on the truck resource:

```ts
observer.record({
  action: 'move',
  resourceInventoriedAs: 'res:truck-1',
  toLocation: 'loc:FactoryB',
  resourceQuantity: { hasNumericalValue: 1, hasUnit: 'truck' },
});
```

This is operational detail — relevant for dispatch (where is my truck right now?) but not
required for planning (can this route be made?). The planning layer works from the truck's
starting `currentLocation` and the recipe's `atLocation` guards.

---

## Containment: combine and separate

The VF `combine` action explicitly sets `containedIn` on a resource (the resource goes
into a container); `separate` clears it. Both carry a `containedEffect` in the action
definitions. This maps exactly to loading and unloading:

```
RecipeProcess "Load"
  Input:  combine  spec:wool        qty N    // sets wool.containedIn = container/truck
  Input:  accept   spec:truck-20t   qty 1

RecipeProcess "Unload"
  Input:  accept   spec:truck-20t   qty 1
  Output: separate spec:wool        qty N    // clears wool.containedIn
```

For a single-process transport where loading and transit are not separately tracked,
`pickup`/`dropoff` is sufficient — they mark entry and exit of the transport process
without explicitly managing `containedIn`. The containment state can still be recorded
as an observation alongside the event.

---

## Keeping recipes abstract — location from the task, not the recipe

VF recipes are intentionally abstract templates. Location belongs to the *plan instance*,
not the recipe. Adding `atLocation`/`toLocation` to `RecipeFlow` would violate this —
the same recipe should be reusable for FarmA→FactoryB and FarmA→Hub equally.

The solution is already in the action semantics:

- `pickup` means "resource enters a transport process *from* some location"
- `dropoff` means "resource leaves a transport process *to* some location"

The recipe stays abstract:

```
RecipeProcess "Truck Transport"
  Input:  pickup  spec:wool       qty N    // no location — abstract
  Input:  use     spec:truck-20t  qty N
  Output: dropoff spec:wool       qty N    // no location — abstract
```

Location comes from the **displacement demand** — when the planner needs `spec:wool` at
`loc:FactoryB` but finds it only at `loc:FarmA`, it instantiates the transport recipe
and stamps `atLocation` on each resulting intent based on the flow's action:

| Action on flow | `atLocation` stamped |
|---|---|
| `pickup` (input) | origin (`loc:FarmA`) |
| `dropoff` (output) | destination (`loc:FactoryB`) |
| `use`, `consume`, `work`, etc. | origin — equipment and labour start there |
| `produce`, `lower` (byproducts) | *none* — see below |

`atLocation` already exists on `Intent` and `Commitment` in our schema. **No schema
changes are needed** — not to `RecipeFlow`, not to `Intent`, not to `Commitment`. The
recipe stays abstract; intents from one recipe process can carry different `atLocation`
values depending on the flow's action.

### Byproducts: CO2 and other outputs

Transport processes produce outputs beyond the cargo delivery — CO2 emissions, waste
heat, road wear, etc. These are modelled as `produce` (or `lower`, for consuming a carbon
budget) flows on the transport process:

```
RecipeProcess "Truck Transport"
  Input:  pickup   spec:wool     qty N
  Input:  use      spec:truck    qty N
  Output: dropoff  spec:wool     qty N
  Output: produce  spec:co2-kg   qty N * 0.12   // 120g CO2 per tonne-km
```

CO2 is an atmospheric resource — it is not *at* FarmA or *at* FactoryB. Assigning it a
route location would be arbitrary. The planning layer therefore leaves `atLocation`
**unset** for `produce` and `lower` outputs on transport recipes. Accountability is
expressed via `provider`/`receiver` on the intent (who is responsible for these
emissions), not via location.

The Observer handles the resulting CO2 intent correctly: if `spec:co2-kg` has an
inventoried resource (e.g. a carbon ledger), the eventual fulfilling event increments it.
If it does not, the event is recorded without resource effect — same as any other
untracked produce event.

The recipe store lookup also stays clean: transport recipes are distinguished from
production recipes by their use of `pickup`/`dropoff` actions, not by location. When
dependent demand detects a location mismatch, it generates a transport sub-task rather
than a production sub-task, and the recipe lookup filters for
`pickup spec:wool` → `dropoff spec:wool` recipes.

---

## What needs to change

| Capability | Status |
|---|---|
| Multi-leg chains (`internallyConsumedSpecs`) | ✓ works today |
| Capacity via `use` + `netAvailableQty` | ✓ works today |
| Route selection via SNLT ranking | ✓ works today |
| Spatial netting guards | ✓ works today |
| `resourcesContainedIn()` query | ✓ works today |
| Observed capacity from containment | ✓ works today |
| Location derivation via `containedIn` chain | ✓ works today (walk chain manually) |
| `combine`/`separate` containedEffect in Observer | ✓ works today (VF action definition) |
| Action-semantic instantiation (`pickup` → origin `atLocation`) | ✗ needed in recipe instantiator |
| Transport sub-task generation in dependent demand | ✗ needed in demand algorithm |
| `recipesForTransport(specId)` on RecipeStore | ✗ needed (filter by pickup/dropoff) |
| Per-trip temporal capacity (same vehicle, multiple trips) | ✗ approximated by multi-instance |
| Truck location tracking after trip | requires explicit `move` event |
