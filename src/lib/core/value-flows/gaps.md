# VF Conformance Gaps

Tracking gaps between our implementation and the VF spec.

## Resolved

### 1. ~~Intents as Discovery Layer~~ ✅

### 2. ~~Recipe Exchanges~~ ✅

### 6. ~~Shared Process~~ ✅

### 12. ~~Singular fulfills/satisfies~~ ✅

### 13. ~~Plan.hasIndependentDemand~~ ✅

### 14. ~~Agreement.stipulates/stipulatesReciprocal~~ ✅

### 15. ~~Proposal.purpose~~ ✅

### 16. ~~EconomicResource locations~~ ✅

### 17. ~~EconomicEvent.settles~~ ✅

### 18. ~~previousEvent breadcrumbs~~ ✅

### 19. ~~Track & Trace~~ ✅

### 20. ~~Event corrections~~ ✅

### 21. ~~Inverse queries~~ ✅

### 22. ~~Unplanned exchanges (realizationOf)~~ ✅

### 23. ~~Forward-scheduling~~ ✅

### 24. ~~Non-process flows~~ ✅

### 25. ~~Inventory-aware planning~~ ✅

## Deferred (non-critical)

### 4. Implied Transfers

- When provider ≠ receiver on consume/produce/deliverService, transfer effects apply additionally
- Observer doesn't auto-detect; explicit transfer events work

### 5. Claims — **DEPRECATED**

- Claim is deprecated per VF JSON schema (title: "Claim-DEPRECATED")
- Schema exists, no lifecycle logic needed

### 26. AgreementBundle

- Groups multiple agreements (e.g., multi-line orders)
- Schema not yet defined

### 27. ProposalList

- Groups proposals (e.g., price lists)
- Schema not yet defined

### 9. Multi-Recipe Plans

- Plans from multiple recipes in one plan

### 10. Duration Scaling

- Process duration may not scale linearly with quantity

### 11. Minimum Batch Sizes

- Recipe may specify min batch; leftover goes to inventory
