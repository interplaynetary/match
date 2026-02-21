# VF Conformance Gaps & Alignment Analysis

> Rigorous comparison of `src/lib/core/value-flows` implementation against
> the ValueFlows mkdocs specification (`src/docs/valueflows/mkdocs`).
>
> Updated: 2026-02-21

---

## System Model (What We Have)

```
src/lib/core/value-flows/
├── schemas.ts           ← Zod schemas for all VF entities
├── query.ts             ← VF inverse-query facade (VfQueries class)
├── process-registry.ts  ← Shared Process registry (planning + observation)
│
├── knowledge/
│   └── recipes.ts       ← RecipeStore (RecipeProcess, RecipeFlow, RecipeExchange, Recipe)
│
├── observation/
│   ├── observer.ts      ← Observer: records events, derives resource state, tracks fulfillment
│   └── account.ts       ← Commune/Account: custom labor-credit accounting (not VF standard)
│
├── planning/
│   ├── planning.ts      ← PlanStore: intents, commitments, proposals, recipe instantiation
│   └── plan.md          ← Planning design notes
│
├── algorithms/
│   └── track-trace.ts   ← trace() / track() DFS algorithms
│
└── utils/
    ├── space.ts         ← SpatialThing / location utilities
    ├── time.ts          ← Temporal utilities
    ├── space-time-index.ts
    ├── space-time-keys.ts
    └── space-time-plan.ts
```

### Three-Layer Architecture — ✅ Correct

| VF Layer | Spec Entities | Implementation |
|---|---|---|
| **Knowledge** | ResourceSpecification, ProcessSpecification, RecipeProcess, RecipeFlow, RecipeExchange, Recipe, RecipeGroup | All except RecipeGroup ✅ |
| **Plan** | Plan, Process, Intent, Commitment, Agreement, AgreementBundle, Proposal, ProposalList | All except AgreementBundle, ProposalList (schemas only, no logic) ✅ |
| **Observation** | EconomicEvent, EconomicResource, Process, Claim | All ✅ (Claim schema only, lifecycle deprecated per VF JSON) |

---

## ✅ Resolved / Conformant

These items were previously gaps and are now correctly implemented.

| # | Item | Notes |
|---|---|---|
| 1 | Intents as discovery layer | `publishOffer` / `publishRequest` / `promoteToCommitment` |
| 2 | Recipe Exchanges → Agreement | `instantiateRecipe` generates Agreements from RecipeExchanges |
| 3 | Shared Process | `ProcessRegistry` shared between `PlanStore` and `Observer` |
| 4 | Singular `fulfills`/`satisfies` | Observer enforces mutual exclusivity |
| 5 | `Plan.hasIndependentDemand` | Set on final output commitments |
| 6 | `Agreement.stipulates/stipulatesReciprocal` | Full schema + set in recipe instantiation |
| 7 | `Proposal.purpose` | `'offer' \| 'request'` |
| 8 | `EconomicResource` locations | `currentLocation`, `currentVirtualLocation`, `currentCurrencyLocation` |
| 9 | `EconomicEvent.settles` | Schema field for Claim settlement |
| 10 | `previousEvent` breadcrumbs | Observer chains them on `record()` |
| 11 | Track & Trace | `trace()` / `track()` DFS in `algorithms/track-trace.ts` |
| 12 | Event corrections | `corrects` field + `applyCorrection()` in Observer |
| 13 | Inverse queries | `VfQueries` class implementing all inverses from `inverses.md` |
| 14 | Unplanned exchanges (`realizationOf`) | `observer.recordExchange()` |
| 15 | Forward/back scheduling | `instantiateRecipe()` supports both |
| 16 | Non-process flows | `addNonProcessCommitment()` |
| 17 | Inventory-aware planning | `instantiateRecipe()` with optional `observer` param |
| 18 | Action definitions table | `ACTION_DEFINITIONS` — all 19 actions, all effect fields |
| 19 | Resource stage/state | Observer applies `stageEffect` / `stateEffect` from action table |
| 20 | Containment | `containedIn`, `combine`/`separate` effects |
| 21 | Batch/lot records | `BatchLotRecord`, per-produce batch creation in Observer |
| 22 | `recomputeResource()` | Full event-replay for auditing |
| 23 | `created` timestamp on events | Schema field, as per accounting.md |

---

## 🔴 Critical Gaps — Missing or Misaligned

### ~~GAP-A: Agent Subtyping~~ (DONE)

**Spec says** (`agents.md`, `model-text.md §Agent`):

> There are 3 subclasses of Agent: `vf:Person`, `vf:Organization`, and `vf:EcologicalAgent`.

**Our implementation:**

```ts
// schemas.ts — single flat Agent schema, no subtyping
export const AgentSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    // ...
});
```

**Gap:** No `Person`, `Organization`, `EcologicalAgent` subtypes. The spec requires these for ecological accounting, agent role semantics, and human/organization separation. The `classifiedAs` field is used as a workaround but is not conformant.

**Fix required:** Add a discriminated union or `type` field. At minimum:

```ts
export const AgentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('Person'), id: z.string(), ... }),
    z.object({ type: z.literal('Organization'), id: z.string(), ... }),
    z.object({ type: z.literal('EcologicalAgent'), id: z.string(), ... }),
]);
```

---

### ~~GAP-B: AgentRelationship & AgentRelationshipRole — Completely Missing~~ (DONE)

**Spec says** (`agents.md`, `model-text.md §vf:AgentRelationship`):

> AgentRelationships define the role one Agent plays in relation to another. Roles can be used for scoping (e.g. "Kathy is mentor of Sam, in scope of Enspiral") and for access control permissions.

**Our implementation:** Does not exist at all — not in `schemas.ts`, not in any store.

**Fix required:** Add schemas and a store:

```ts
export const AgentRelationshipRoleSchema = z.object({
    id: z.string(),
    label: z.string(),
    inverseLabel: z.string().optional(),
    note: z.string().optional(),
    classifiedAs: z.array(z.string()).optional(),
});

export const AgentRelationshipSchema = z.object({
    id: z.string(),
    subject: z.string(),          // Agent ID
    object: z.string(),           // Agent ID
    relationship: z.string(),     // AgentRelationshipRole ID
    inScopeOf: z.string().optional(), // Agent ID (scope context)
    note: z.string().optional(),
});
```

---

### ~~GAP-C: EcologicalAgent — Completely Missing~~ (DONE)

**Spec says** (`agents.md`, `ecology.md`):

> The ecological agent concept expands REA to ecological and climate accounting. Ecological agents include non-human beings and ecosystems.

**Our implementation:** No separate concept; ecological things would have to use the generic `AgentSchema` with a `classifiedAs` tag.

**Fix required:** Subtype or schema with `type: 'EcologicalAgent'` (see GAP-A). Ecological accounting requires distinguishing these from Persons/Organizations.

---

### ~~GAP-D: RecipeGroup — Missing~~ (DONE)

**Spec says** (`model-text.md §vf:RecipeGroup`, `recipes.md`):

> A RecipeGroup makes it easy to include more than one Recipe output in one Plan. Use this when a plan regularly produces more than one separate output.

**Our implementation:** Does not exist in `schemas.ts` or `knowledge/recipes.ts`.

**Fix required:**

```ts
export const RecipeGroupSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    recipes: z.array(z.string()), // Recipe IDs
});
```

And add `instantiateRecipeGroup()` to `PlanStore`.

---

### ~~GAP-E: Scenario / ScenarioDefinition — Completely Missing~~ (DONE)

**Spec says** (`estimates.md`, `model-text.md §Estimation and Analysis`):

> Scenarios group Processes, Intents, Plans (nested), and summarized EconomicEvents into higher-level strategic views. Uses: budgeting, comparative analysis, pre-planning, network flows analysis. Scenarios can be nested in themselves.

**Our implementation:** Does not exist. No `Scenario` schema, no `ScenarioDefinition` schema, no store or queries.

**Fix required:**

```ts
export const ScenarioDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    hasDuration: DurationSchema.optional(),
    inScopeOf: z.string().optional(), // Agent ID
});

export const ScenarioSchema = z.object({
    id: z.string(),
    name: z.string(),
    note: z.string().optional(),
    definedAs: z.string().optional(),      // ScenarioDefinition ID
    refinementOf: z.string().optional(),   // Scenario ID (nesting)
    hasBeginning: z.string().datetime().optional(),
    hasEnd: z.string().datetime().optional(),
    inScopeOf: z.string().optional(),      // Agent ID
    // contained plans, processes, intents, events are queried, not embedded
});
```

---

### ~~GAP-F: Implied Transfers — Not Enforced~~ (DONE)

**Spec says** (`transfers.md §Explicit and implied transfers`, `actions.md §Implied Transfers`):

> When `provider ≠ receiver` on a `consume`, `produce`, or `deliverService` event, full transfer-of-rights behavior must be applied in addition to the primary action effects. `pickup`/`dropoff` and `accept`/`modify` imply custody-only transfer when provider ≠ receiver.

**Our implementation:**

The Observer applies action effects data-driven from `ACTION_DEFINITIONS`, but does NOT detect implied transfer conditions (provider ≠ receiver) and does NOT add the additional `transferAllRights` or `transferCustody` effects. The `ACTION_DEFINITIONS` table does not have an `impliesTransfer` field.

**Gap:** If User A records `consume` of User B's resource (provider=A, receiver=B), the Observer will only decrement A's accounting—it will NOT increment B's as the implied transfer requires.

**Fix required:**

1. Add `impliesTransfer: 'allRights' | 'custody' | null` to `ActionDefinition`.
2. In `applyEffects()`, when provider ≠ receiver, additionally apply transfer effects to `toResourceInventoriedAs`.

---

### ~~GAP-G: `atLocation` on Flows — Missing~~ (DONE)

**Spec says** (`model-text.md §vf:SpatialThing`):

> `atLocation` is a SpatialThing property on EconomicEvent, Commitment, and Intent.

**Our implementation:**

`EconomicEventSchema` has `toLocation` but **not `atLocation`**. Same for `CommitmentSchema` and `IntentSchema`.

**Fix required:** Add `atLocation: z.string().optional()` (SpatialThing ID) to `EconomicEventSchema`, `CommitmentSchema`, `IntentSchema`.

---

### ~~GAP-H: `EconomicEvent.image` Should Be Non-Economic~~ (DONE)

**Spec says** (`resources.md §How resources relate to events`):

> Non-economic information (note, image, etc.) can be updated on the EconomicResource directly. **Only economic information must come through events.**

**Our implementation:**

`EconomicEventSchema` has an `image` field. This is a structural misalignment — images are non-economic metadata, should not be on events.

**Fix required:** Remove `image` from `EconomicEventSchema` (it belongs on `EconomicResource` and `Agent` only).

---

### ~~GAP-I: `Commitment` Allows Temporary Absence of Both Agents~~ (DONE)

**Spec says** (`model-text.md §vf:Commitment`):

> A Commitment can be planned temporarily without both provider and receiver if there is a committed Agent assumed or immediately expected as part of planning.

**Our implementation:**

`CommitmentSchema` requires `provider: z.string()` and `receiver: z.string()` (non-optional). This blocks the spec-valid "unassigned" planning scenario without resorting to sentinel strings (currently uses `'unassigned'` literal in `createCommitmentFromFlow()`).

**Fix required:**

```ts
provider: z.string().optional(), // can be temporarily unset
receiver: z.string().optional(),
```

Add validation that by the time an event fulfills a commitment, both must be set.

---

### ~~GAP-J: AgreementBundle — Schema Present, No Logic~~ (DONE)

**Spec says** (`exchanges.md`):

> Agreements can be combined into an AgreementBundle, useful for multi-line-item orders where each line item needs its own reciprocal commitment.

**Our implementation:**

`AgreementBundleSchema` exists in `schemas.ts` but there is no store CRUD, no query in `VfQueries`, no aggregation logic.

**Fix required:** Add `AgreementBundle` CRUD to `PlanStore` and `agreementBundleCommitments()` / `agreementBundleEvents()` to `VfQueries`.

---

### ~~GAP-K: ProposalList — Schema Present, No Logic~~ (DONE)

**Spec says** (`proposals.md`):

> Proposals can be grouped into Proposal Lists, for example for price lists.

**Our implementation:**

`ProposalListSchema` exists in `schemas.ts` but has no store CRUD or queries.

**Fix required:** Add `ProposalList` CRUD to `PlanStore`.

---

## 🟡 Algorithm Gaps

The spec defines 8 named algorithms (`algorithms/overview.md`). Only Track & Trace is implemented.

### ALG-1: Dependent Demand — Partially Implemented

**Spec says** (`algorithms/dependent-demand.md`):

> Start with end items and demand, explode through recipes, check inventory against each input, net against current stock, generate purchase/production requirements for shortfalls only.

**Our implementation:**

`planning.ts: instantiateRecipe()` does basic inventory netting (checks `conformingResources` for each input, allocates available quantity). **But:**

- Does NOT handle **minimum batch sizes** (spec: leftover goes to inventory, shortfall rounds up to batch minimum).
- Does NOT handle **multi-recipe** demand explosion (GAP-D: RecipeGroup missing).
- Does NOT handle **recursive sub-recipes** (if a consumed component has its own recipe, that recipe is not automatically exploded — only one level deep).
- `allocated[]` tracking is returned but never writes allocation Commitments back into the plan.

### ALG-2: Critical Path — Not Implemented

**Spec says** (`algorithms/critical-path.md`):

> Forward-schedule from earliest available inputs, find the longest path through the process network to determine the minimum project duration and identify bottleneck processes.

**Our implementation:** Not implemented. `PlanStore` has no critical path logic.

### ALG-3: Value Rollup — Not Implemented

**Spec says** (`algorithms/rollup.md`):

> Sum up all input values flowing into a recipe recursively to get the total input value of the final output. Can weight by quantity and price.

**Our implementation:** Not implemented. `VfQueries` has no value aggregation functions.

### ALG-4: Value Equations — Not Implemented

**Spec says** (`algorithms/equations.md`):

> Determine how income should be distributed to contributors, based on their contributions (work events, etc.) to a specific output. Configurable distribution formulas.

**Our implementation:** `observation/account.ts` has a custom `Commune`/`Account` labor-credit accounting class. **Misalignment:** This is a bespoke economic model (SNLT-based claim pools) that does **not** implement the VF `ValueEquation` pattern. The VF pattern distributes income from realizationOf events backwards through the value chain to contributors.

### ALG-5: Provenance — Partially Implemented

**Spec says** (`algorithms/provenance.md`):

> Like Trace, but specifically follows the path of a resource AND all other resources that went into it (multi-resource provenance tree).

**Our implementation:**

`trace()` in `track-trace.ts` does traverse backwards through processes and resources. However it returns a flat `FlowNode[]` rather than a multi-root provenance tree. The `previousOf(process)` returns input events but does not recursively pull in the provenance of each input's resource origin.

**Fix required:** Extend `trace()` to follow `resourceInventoriedAs` on each input event recursively, producing a proper provenance tree.

### ALG-6: Cash Flow — Not Implemented

**Spec says** (`algorithms/cashflows.md`):

> Track inflows and outflows of money/credits on a timeline — historical (from actual events) and forecasted (from commitments/intents). Useful for liquidity planning.

**Our implementation:** Not implemented. No timeline aggregation of resource flows by date and agent.
### ALG-7: Network Flows — Not Implemented

**Spec says** (`algorithms/netflows.md`):

> General analysis of all resource flows in a network (community/region), using higher-level process and resource types. Identifies gaps and circulation opportunities.

**Our implementation:** Not implemented.

---

## 🟠 Structural Misalignments

### MIS-1: `account.ts` — Non-VF Economic Model

`observation/account.ts` implements a `Commune`/`Account` system based on Social Necessary Labor Time (SNLT) and communal deduction rates. This is a valid application-level economic model but:

- Uses no VF types (`EconomicEvent`, `Commitment`, etc.)
- Is not integrated with the `Observer` or `PlanStore`
- Claims "accounting" semantics that conflict with VF's `ValueEquation` algorithm

**Resolution needed:** Either:
1. Re-implement this as a VF-conformant `ValueEquation` distribution using `EconomicEvent`s and `Agreement`s, OR
2. Clearly label it as an application-layer extension that consumes VF data but is not part of the VF ontology.

### ~~MIS-2: `EconomicResource.currentCurrencyLocation` — Non-Standard~~ (DONE)

`schemas.ts` has `currentCurrencyLocation: z.string().optional()`. This is *not* in the VF spec. The spec's `SpatialThing` covers physical locations; digital/virtual locations are covered by `currentVirtualLocation` (which we have).

**Resolution:** Remove `currentCurrencyLocation` or document it as a local extension to the VF ontology.

### ~~MIS-3: `use` Action — `eventQuantity: 'both'` Misread~~ (DONE)

**Spec says** (`actions.md §eventQuantity`):

> The action `use` provides for `both` because there can be a requirement for use of some number of a resource *or* resource specification for some time or effort unit.

Our `ACTION_DEFINITIONS.use.eventQuantity = 'both'` is correct, but the Observer's `applyResourceEffects` only uses `event.resourceQuantity?.hasNumericalValue` for accounting calculations, ignoring `effortQuantity`. For `use`/`work` actions, neither has an accounting effect on the resource (both are `noEffect`), so this is currently harmless—but any derived accounting (e.g., value rollup) that needs effort-based costing will fail to find the effort quantity.

---

## 🟢 Deferred (Low Priority / Intentional)

| # | Item | Reason |
|---|---|---|
| D-1 | `Claim` lifecycle | Deprecated in VF JSON schema (`title: "Claim-DEPRECATED"`); schema kept for completeness |
| D-2 | Duration scaling in recipes | Non-linear duration scaling is out of scope for base implementation |
| D-3 | Minimum batch sizes in `instantiateRecipe` | Adds complexity; currently rounds leftover to intention |
| D-4 | Multi-recipe plans (RecipeGroup) | Blocked on GAP-D |
| D-5 | Process nesting in Scenarios | Blocked on GAP-E |

---

## Implementation Priority Matrix

| Gap | Severity | Complexity | Priority |
|---|---|---|---|
| GAP-F: Implied Transfers | HIGH — affects accounting correctness | Medium | **P1** |
| GAP-G: `atLocation` on flows | HIGH — data loss on location events | Low | **P1** |
| GAP-A: Agent subtyping | HIGH — no ecological accounting possible | Medium | **P1** |
| GAP-B: AgentRelationship | HIGH — core VF network model | Medium | **P1** |
| GAP-I: Commitment agent optionality | MEDIUM — planning robustness | Low | **P2** |
| GAP-H: Event.image removal | LOW — semantic purity | Low | **P2** |
| GAP-E: Scenario | MEDIUM — analysis layer missing | High | **P2** |
| GAP-D: RecipeGroup | MEDIUM — multi-output planning | Medium | **P2** |
| GAP-J/K: AgreementBundle, ProposalList logic | LOW — schemas exist | Low | **P3** |
| GAP-C: EcologicalAgent | MEDIUM — depends on GAP-A | Low | **P3** |
| ALG-2: Critical Path | MEDIUM — scheduling completeness | Medium | **P2** |
| ALG-3: Value Rollup | MEDIUM — accounting completeness | Medium | **P2** |
| ALG-4: Value Equations | HIGH — core distribution | High | **P2** |
| ALG-6: Cash Flow | LOW — reporting feature | High | **P3** |
| MIS-1: account.ts reconnection | MEDIUM — integration debt | High | **P2** |
| MIS-2: currentCurrencyLocation | LOW — non-standard field | Trivial | **P3** |

---

## Summary

The implementation is **structurally sound** and covers the core VF three-layer model correctly. The most critical gaps are:

1. **Agent model** — flat `Agent` schema must become a discriminated union with Person / Organization / EcologicalAgent subtypes plus `AgentRelationship`.
2. **Implied transfers** — `Observer.applyEffects()` must detect provider ≠ receiver and apply additional transfer effects for `consume`, `produce`, `deliverService`, `pickup`, `dropoff`, `accept`, `modify`.
3. **`atLocation`** — missing on all flow types (Event, Commitment, Intent).
4. **Scenario layer** — entirely absent; required for budgeting, comparative analysis.
5. **Algorithm completeness** — Critical Path, Value Rollup, Value Equations, Cash Flows, and Network Flows are missing; the custom `account.ts` Commune system needs to be reconciled with VF's `ValueEquation` pattern.
