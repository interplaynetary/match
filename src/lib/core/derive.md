 It's not allocation. There is no pool being       
  divided by a central ledger.                      
                                                    
  What's actually happening: multiple effects assert
   transformations on the same entity's attribute,  
  and the system checks whether they're consistent. 

  A capacity resource saying "I have 10 hours
  available" is itself an assertion about reality —
  an effect. Then:

  - Effect A asserts: "5 hours were used for X"
  - Effect B asserts: "3 hours were used for Y"

  Nobody "allocated" anything. Two transformations
  were observed against the same entity. The
  question "are there 2 hours remaining?" isn't a
  property of any single effect — it's derived from
  the set of accepted effects targeting that
  attribute.

  The quantity: 10 on a Resource isn't a pool. It's
  a constraint — a boundary condition on what
  effects can be consistently accepted. If Effect C
  comes in asserting "4 more hours used for Z," the
  system checks: 5 + 3 + 4 > 10. The effects are
  inconsistent with the constraint. Effect C can't
  be accepted as-is.

  So what your current model calls "divisible
  allocation" is really:

  1. An entity has a numeric attribute with a
  constraint (upper bound)
  2. Multiple effects assert transformations
  (add/subtract) on that attribute
  3. The system validates: do accepted effects, in
  aggregate, respect the constraint?
  4. If not: the latest effect is rejected, or an
  earlier one must be retracted

  "Divisibility" is just the fact that the
  constraint is numeric and multiple effects can
  independently claim portions. It's not a special
  mechanism — it's the natural consequence of
  multiple effects targeting the same attribute.

  This also explains why "partial quantity" is a
  risk factor in your match system rather than a
  hard block. It's not that someone decided to give
  you less. It's that the set of effects currently
  observed against that attribute only covers part
  of the constraint space. More effects could still
  arrive.

  The commons doesn't "divide" anything. It defines
  slot shapes. Effects arrive asserting
  transformations. The system checks whether the
  totality of accepted effects, across all slots, is
   consistent with the constraints on the underlying
   entities. That's it