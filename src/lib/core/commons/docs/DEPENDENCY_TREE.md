# Dependency Tree: `src/lib/core/plan`

This document provides a hierarchical view of the dependencies in `src/lib/core/plan`, followed by a Mermaid graph.

## Text Tree

- `aggregation.ts`
- `allocation.ts`
  - `ids.ts`
- `effect.ts`
  - ↪️ `ids.ts` (Already detailed above)
- `feasibility.ts`
  - `desire.ts`
  - `matching.ts`
    - `process.ts`
      - `derivation.ts`
        - `effect-stream.ts`
          - 🔄 `derivation.ts` (Circular Reference)
          - ↪️ `ids.ts` (Already detailed above)
        - `time.ts`
      - ↪️ `effect-stream.ts` (Already detailed above)
      - ↪️ `ids.ts` (Already detailed above)
      - `skills.ts`
    - `spatial.ts`
      - ↪️ `process.ts` (Already detailed above)
    - ↪️ `time.ts` (Already detailed above)
  - ↪️ `spatial.ts` (Already detailed above)
- `governor.ts`
- `labor.ts`
  - `hex.ts`
    - ↪️ `matching.ts` (Already detailed above)
    - ↪️ `time.ts` (Already detailed above)
  - ↪️ `matching.ts` (Already detailed above)
  - `person.ts`
    - ↪️ `time.ts` (Already detailed above)
  - ↪️ `skills.ts` (Already detailed above)
  - ↪️ `time.ts` (Already detailed above)
- `need.ts`
  - ↪️ `hex.ts` (Already detailed above)
  - ↪️ `matching.ts` (Already detailed above)
  - ↪️ `time.ts` (Already detailed above)
- `operation.ts`
- `planner.ts`
  - ↪️ `person.ts` (Already detailed above)
- `resource.ts`
  - ↪️ `hex.ts` (Already detailed above)
  - ↪️ `matching.ts` (Already detailed above)
  - ↪️ `process.ts` (Already detailed above)
- `rights-validator.ts`
- `rights.ts`
  - ↪️ `time.ts` (Already detailed above)
- `stockbook.ts`
  - ↪️ `process.ts` (Already detailed above)

## Mermaid Graph

```mermaid
graph LR
  aggregation["aggregation.ts"]
  allocation["allocation.ts"] --> ids["ids.ts"]
  derivation["derivation.ts"] --> effect_stream["effect-stream.ts"]
  derivation["derivation.ts"] --> time["time.ts"]
  effect_stream["effect-stream.ts"] --> derivation["derivation.ts"]
  effect_stream["effect-stream.ts"] --> ids["ids.ts"]
  effect["effect.ts"] --> ids["ids.ts"]
  feasibility["feasibility.ts"] --> desire["desire.ts"]
  feasibility["feasibility.ts"] --> matching["matching.ts"]
  feasibility["feasibility.ts"] --> spatial["spatial.ts"]
  governor["governor.ts"]
  hex["hex.ts"] --> matching["matching.ts"]
  hex["hex.ts"] --> time["time.ts"]
  labor["labor.ts"] --> hex["hex.ts"]
  labor["labor.ts"] --> matching["matching.ts"]
  labor["labor.ts"] --> person["person.ts"]
  labor["labor.ts"] --> skills["skills.ts"]
  labor["labor.ts"] --> time["time.ts"]
  matching["matching.ts"] --> process["process.ts"]
  matching["matching.ts"] --> spatial["spatial.ts"]
  matching["matching.ts"] --> time["time.ts"]
  need["need.ts"] --> hex["hex.ts"]
  need["need.ts"] --> matching["matching.ts"]
  need["need.ts"] --> time["time.ts"]
  operation["operation.ts"]
  person["person.ts"] --> time["time.ts"]
  planner["planner.ts"] --> person["person.ts"]
  process["process.ts"] --> derivation["derivation.ts"]
  process["process.ts"] --> effect_stream["effect-stream.ts"]
  process["process.ts"] --> ids["ids.ts"]
  process["process.ts"] --> skills["skills.ts"]
  resource["resource.ts"] --> hex["hex.ts"]
  resource["resource.ts"] --> matching["matching.ts"]
  resource["resource.ts"] --> process["process.ts"]
  rights_validator["rights-validator.ts"]
  rights["rights.ts"] --> time["time.ts"]
  spatial["spatial.ts"] --> process["process.ts"]
  stockbook["stockbook.ts"] --> process["process.ts"]
```
