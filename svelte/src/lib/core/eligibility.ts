/**
 * Stub for eligibility module - TODO: implement or get from Rüzgar
 */

export type FilterContext = {
  [key: string]: unknown
}

export type EligibilityFilter = {
  type: string
  [key: string]: unknown
}

export const EligibilityFilters = {
  // Stub - add actual filters when needed
}

let warned = false

export function evaluateEligibilityFilter(
  _filter: EligibilityFilter | undefined,
  _context: FilterContext
): boolean {
  if (!warned) {
    console.warn('[eligibility] evaluateEligibilityFilter not implemented yet - returning true')
    warned = true
  }
  return true
}
