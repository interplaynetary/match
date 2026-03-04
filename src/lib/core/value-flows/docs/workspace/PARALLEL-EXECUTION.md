# Parallel Execution Model

How `planForRegion` instances at the same merge level execute concurrently without
coordination failures.

---

## The non-problem

At any merge level, each merge planner covers a **disjoint** set of H3 cells. A resource
indexed to cell X belongs to exactly one parent cell at each resolution. Two planners at
the same level therefore cannot both own the same spatially-located resource — the H3
hierarchy guarantees disjointness. They run in full parallel with no coordination.

Cross-level retraction (a higher merge planner retracting lower-level allocations via
`planStore.removeWhere(provenanceId)`) is inherently sequential: higher levels always run
after lower levels commit. Hashing does not affect this ordering — it is load-bearing.

---

## The real problem: cross-boundary resources

A resource that **spans H3 cell boundaries** can appear in multiple leaf cells
simultaneously: a river, a railway, a shipping lane, a labour pool that commutes across a
boundary. Multiple same-level planners may try to claim it concurrently.

Two sub-cases:

**Physical resource with a primary location.** The mill is *in* cell A5 even if B3 wants
its output. The resource's H3 cell is its natural owner. The merge planner covering A5
allocates the mill; B3's demand reaches it as an inter-region signal routed up the
hierarchy. No additional hashing needed — spatial indexing already disambiguates.

**Non-spatial or span-crossing resource.** A shipping lane crossing 40 cells, a labour
market spanning a district, a web service with no fixed location. No obvious home cell.
This is where explicit home-cell assignment is needed.

---

## Home-cell assignment via rendezvous hashing

For non-spatial resources, assign ownership using **Rendezvous / HRW hashing**:

```
owner(resource, level) = argmax over cells c at level: hash(resource.id + c.id)
```

Properties:
- Deterministic — same input state always produces the same owner
- No coordination required — every planner computes the same result independently
- Stable — adding or removing cells at a level minimally perturbs assignments
- Distributes load — ownership is spread across cells proportional to hash collisions

The owner cell's merge planner is the **sole allocator** for that resource at that level.
Other planners treat it as an external supply/demand signal and route claims to the owner
rather than allocating directly.

---

## Two-phase execution per merge level

```
Phase A  (fully parallel)
  Each merge planner runs planForRegion over its cells.
  When it encounters a resource whose home cell is outside its coverage:
    → emit a ClaimRequest { resourceId, qty, priority, provenanceId } to the home cell
    → do not commit the allocation locally

Phase B  (parallel per home cell, one synchronisation point)
  Each home cell processes its received ClaimRequests.
  Serialise by priority (D-category, then due date).
  Commit allocations greedily from highest priority down.
  Broadcast result: Confirmed { qty } | Denied { reason } back to requesting planner.

Phase C  (parallel)
  Planners that received Confirmed: stamp allocation into their PlanStore, continue.
  Planners that received Denied: re-explode root demand via fallback ladder
    (alt local inventory → alternate transport route → scheduled receipt → production →
    purchaseIntent).
  Unresolvable denials become unmetDemand[] / metabolicDebt[] — escalate to next level.
```

Phase B is the only synchronisation point. It is itself embarrassingly parallel across
home cells — each home cell is independent. The round-trip cost is one message per
cross-boundary resource claim per level.

For physical resources with a clear H3 home (the common case), Phase B collapses into the
owning cell's existing planning flow and adds no overhead.

---

## Hot home cell mitigation

If a single resource is contested by many planners at the same level (e.g. a major
intercontinental shipping lane), its home cell becomes a bottleneck.

Mitigation: assign truly global resources to a high-resolution H3 ancestor cell at
registration time, so they are planned at an appropriately high merge level rather than
being routed through a leaf-level or mid-level home. The planning hierarchy naturally
handles global resources at the level where their full demand picture is visible.

---

## Summary

| Resource type | Ownership mechanism | Parallel safe? |
|---|---|---|
| Spatially contained (within one H3 cell) | H3 cell → its merge planner chain | Yes, by construction |
| Physical with primary location (crosses boundary) | Primary location H3 cell | Yes |
| Non-spatial / span-crossing | Rendezvous hash → home cell | Yes, after Phase B |
| Global infrastructure | Assigned to high-level ancestor cell | Yes, at that merge level |

Cross-level retraction always sequential. Same-level parallel execution safe for all
resource types given home-cell assignment.
