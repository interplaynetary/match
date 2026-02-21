# Resource Classification: The D-Categories in ValueFlows

To connect the generative logic of the Planner (`D1-D6` needs) with the SNLT accounting of the Commune (`account.ts`), we map the economic concepts directly into ValueFlows primitives using the `classifiedAs` array.

ValueFlows allows `ResourceSpecification` and `EconomicResource` to hold an array of taxonomy URIs in the `resourceClassifiedAs` property. We use these tags to define how the resource interfaces with the Plan and the Commune.

## The Standard D-Classifications

Every `ResourceSpecification` (the template for a material, tool, or product) should include one of the following category identifiers in its `resourceClassifiedAs` array:

### `tag:plan:D1-MeansOfProduction`

- **Definition**: Machinery, infrastructure, factories, and durable tools.
- **Planner Behavior**: The Planner calculates the depreciation of these assets based on their `lifespan` and schedules replacement production (**D1 Reproduction Need**).
- **Commune Behavior**: Ignored. These resources are never placed into the Individual Consumption Pool. They are routed directly from manufacturer to user via `transferCustody` Commitments scheduled by the Plan.

### `tag:plan:D2-Intermediate`

- **Definition**: Raw materials, sub-components, seeds, flour, steel, electricity. Goods whose primary purpose is to be consumed or used up by another process.
- **Planner Behavior**: The Planner calculates the required volume algorithmically by tracing the input `RecipeFlow`s of downstream production.
- **Commune Behavior**: Ignored. Intermediate goods are never claimed by individuals. They are held in inventory (`onhandQuantity`) to be consumed by scheduled `Process`es.

### `tag:plan:D4-Administration` & `tag:plan:D6-Support`

- **Definition**: Public goods, healthcare supplies, bureaucratic overhead, public transportation.
- **Planner Behavior**: Scheduled based on the explicit `finalTargets.D4_administration` and `finalTargets.D6_support` inputs to the Planner.
- **Commune Behavior**: Ignored. These goods are consumed collectively by public processes. The SNLT to produce them is exactly what dictates the `communal_deduction_rate` levied against all worker accounts in `account.ts`.

### `tag:plan:D5-Consumption` (The Individual Consumption Pool)

- **Definition**: Apples, furniture, personal housing, clothing. Goods intended for autonomous individual consumption outside of the Plan's explicit process graphs.
- **Planner Behavior**: Scheduled based on the explicit `finalTargets.D5_common_needs` inputs (which aggregate individual requests/signals from the population).
- **Commune Behavior**: **CRITICAL**. When the Observer detects an `EconomicEvent` of `action: 'produce'` that yields an `EconomicResource` classified with `tag:plan:D5-Consumption`, the total SNLT embodied in that resource is **added to the Commune's total `current_consumption_pool`**. This determines the backing value for every individual's elastic claim capacity in `account.ts`.

---

## How It Integrates at Runtime

### 1. In The Knowledge Layer (`Recipe` and `ResourceSpecification`)

When defining a product in the system, you tag it:

```json
{
  "id": "spec:bread_loaf",
  "name": "Loaf of Bread",
  "resourceClassifiedAs": ["tag:plan:D5-Consumption", "wd:Q7802"]
}
```

### 2. In The Observation Layer (`account.ts`)

The `Commune` listens to the ValueFlows `Observer`. When bread is produced, it checks the specification:

```typescript
observer.subscribe((e) => {
  if (e.type === "recorded" && e.event.action === "produce") {
    const resource = observer.getResource(e.event.resourceInventoriedAs);
    const spec = observer.getSpecification(resource.conformsTo);

    // IF the produced resource is for individual consumption...
    if (spec.resourceClassifiedAs.includes("tag:plan:D5-Consumption")) {
      // Add its SNLT cost to the aggregate social pool
      const snltValue = calculateEmbodiedSNLT(resource);
      commune.addToPool(snltValue);
    }
  }
});
```

### 3. In The Exchange (Claiming Goods)

A worker uses their `net_claim_capacity` derived from their `gross_labor_credited` to claim the bread. In ValueFlows, this is recorded as a `consume` or `transferAllRights` event, and the `Commune` simultaneously runs `Account.claimGoods()` to deduct from the member's remaining claim capacity and lower the aggregate `current_consumption_pool`.

## D3 (Insurance)

_Note: There is no `D3-Insurance` classification tag for resources._ Insurance is not a separate category of goods; it is a **mathematical buffer** applied by the Planner to the quantities of D1/D2/D4/D5/D6 production goals. A loaf of bread produced as an "insurance buffer" is still classified as `D5-Consumption` and enters the pool just like any other loaf.
