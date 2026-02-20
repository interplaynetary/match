# File Dependencies: `src/lib/core/plan`

This document maps out the internal and external dependencies for each file in the `src/lib/core/plan` directory.

## `aggregation.ts`

**Imports (Internal):** None

**Imports (External):**
- `zod`

**Imported by:** None

---

## `allocation.ts`

**Imports (Internal):**
- `ids.ts`

**Imports (External):**
- `nanoid`
- `zod`

**Imported by:** None

---

## `derivation.ts`

**Imports (Internal):**
- `effect-stream.ts`
- `time.ts`

**Imported by:**
- `effect-stream.ts`
- `process.ts`

---

## `desire.ts`

**Imports (Internal):** None

**Imports (External):**
- `zod`

**Imported by:**
- `feasibility.ts`

---

## `effect-stream.ts`

**Imports (Internal):**
- `derivation.ts`
- `ids.ts`

**Imports (External):**
- `nanoid`

**Imported by:**
- `derivation.ts`
- `process.ts`

---

## `effect.ts`

**Imports (Internal):**
- `ids.ts`

**Imports (External):**
- `zod`

**Imported by:** None

---

## `feasibility.ts`

**Imports (Internal):**
- `desire.ts`
- `matching.ts`
- `spatial.ts`

**Imports (External):**
- `../types.js`
- `nanoid`
- `zod`

**Imported by:** None

---

## `governor.ts`

**Imports (Internal):** None

**Imported by:** None

---

## `hex.ts`

**Imports (Internal):**
- `matching.ts`
- `time.ts`

**Imports (External):**
- `h3-js`

**Imported by:**
- `labor.ts`
- `need.ts`
- `resource.ts`

---

## `ids.ts`

**Imports (Internal):** None

**Imports (External):**
- `zod`

**Imported by:**
- `allocation.ts`
- `effect-stream.ts`
- `effect.ts`
- `process.ts`

---

## `labor.ts`

**Imports (Internal):**
- `hex.ts`
- `matching.ts`
- `person.ts`
- `skills.ts`
- `time.ts`

**Imports (External):**
- `../types`
- `zod`

**Imported by:** None

---

## `matching.ts`

**Imports (Internal):**
- `process.ts`
- `spatial.ts`
- `time.ts`

**Imports (External):**
- `../types`
- `json-logic-js`

**Imported by:**
- `feasibility.ts`
- `hex.ts`
- `labor.ts`
- `need.ts`
- `resource.ts`

---

## `need.ts`

**Imports (Internal):**
- `hex.ts`
- `matching.ts`
- `time.ts`

**Imports (External):**
- `zod`

**Imported by:** None

---

## `operation.ts`

**Imports (Internal):** None

**Imported by:** None

---

## `person.ts`

**Imports (Internal):**
- `time.ts`

**Imports (External):**
- `../types`
- `zod`

**Imported by:**
- `labor.ts`
- `planner.ts`

---

## `planner.ts`

**Imports (Internal):**
- `person.ts`

**Imported by:** None

---

## `process.ts`

**Imports (Internal):**
- `derivation.ts`
- `effect-stream.ts`
- `ids.ts`
- `skills.ts`

**Imports (External):**
- `json-logic-js`
- `nanoid`
- `zod`

**Imported by:**
- `matching.ts`
- `resource.ts`
- `spatial.ts`
- `stockbook.ts`

---

## `resource.ts`

**Imports (Internal):**
- `hex.ts`
- `matching.ts`
- `process.ts`

**Imports (External):**
- `zod`

**Imported by:** None

---

## `rights-validator.ts`

**Imports (Internal):** None

**Imports (External):**
- `json-logic-js`

**Imported by:** None

---

## `rights.ts`

**Imports (Internal):**
- `time.ts`

**Imports (External):**
- `zod`

**Imported by:** None

---

## `skills.ts`

**Imports (Internal):** None

**Imports (External):**
- `zod`

**Imported by:**
- `labor.ts`
- `process.ts`

---

## `spatial.ts`

**Imports (Internal):**
- `process.ts`

**Imports (External):**
- `h3-js`

**Imported by:**
- `feasibility.ts`
- `matching.ts`

---

## `stockbook.ts`

**Imports (Internal):**
- `process.ts`

**Imports (External):**
- `zod`

**Imported by:** None

---

## `time.ts`

**Imports (Internal):** None

**Imports (External):**
- `zod`

**Imported by:**
- `derivation.ts`
- `hex.ts`
- `labor.ts`
- `matching.ts`
- `need.ts`
- `person.ts`
- `rights.ts`

---

