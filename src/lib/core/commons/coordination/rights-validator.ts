/**
 * Rights Validator
 * 
 * Validates rights allocations and checks compatibility.
 */

import jsonLogic from "json-logic-js";
import type {
    UseRight,
    RightsCatalog,
    RightsCombination,
    RightsAllocation,
} from "./rights";

// =============================================================================
// COMPATIBILITY VALIDATION
// =============================================================================

/**
 * Check if a set of rights forms a valid combination.
 */
export function isValidCombination(
    rightIds: string[],
    catalog: RightsCatalog
): boolean {
    const sortedIds = [...rightIds].sort();
    
    return catalog.valid_combinations.some(combo => {
        const sortedComboIds = [...combo.right_ids].sort();
        return (
            combo.compatible &&
            sortedIds.length === sortedComboIds.length &&
            sortedIds.every((id, i) => id === sortedComboIds[i])
        );
    });
}

/**
 * Get all valid combinations that include a specific right.
 */
export function getCombinationsWithRight(
    rightId: string,
    catalog: RightsCatalog
): RightsCombination[] {
    return catalog.valid_combinations.filter(
        combo => combo.compatible && combo.right_ids.includes(rightId)
    );
}

/**
 * Check if two rights can coexist.
 */
export function areRightsCompatible(
    rightId1: string,
    rightId2: string,
    catalog: RightsCatalog
): boolean {
    return catalog.valid_combinations.some(
        combo =>
            combo.compatible &&
            combo.right_ids.includes(rightId1) &&
            combo.right_ids.includes(rightId2)
    );
}

/**
 * Find conflicts in a proposed allocation.
 */
export function findConflicts(
    allocation: RightsAllocation,
    catalog: RightsCatalog
): Array<{ right1: string; right2: string; reason: string }> {
    const conflicts: Array<{ right1: string; right2: string; reason: string }> = [];
    const rightIds = allocation.allocations.map(a => a.right_id);
    
    for (let i = 0; i < rightIds.length; i++) {
        for (let j = i + 1; j < rightIds.length; j++) {
            if (!areRightsCompatible(rightIds[i], rightIds[j], catalog)) {
                conflicts.push({
                    right1: rightIds[i],
                    right2: rightIds[j],
                    reason: "Rights not in any valid combination",
                });
            }
        }
    }
    
    return conflicts;
}

// =============================================================================
// HOLDER CONSTRAINT VALIDATION
// =============================================================================

/**
 * Check if a holder satisfies the constraints for a right.
 */
export function canHoldRight(
    right: UseRight,
    holderContext: Record<string, any>
): boolean {
    try {
        return jsonLogic.apply(right.holder_constraints, holderContext);
    } catch (error) {
        console.error("Error evaluating holder constraints:", error);
        return false;
    }
}

/**
 * Validate all holders in an allocation.
 */
export function validateHolders(
    allocation: RightsAllocation,
    catalog: RightsCatalog,
    holderContexts: Map<string, Record<string, any>>
): Array<{ holder_id: string; right_id: string; reason: string }> {
    const violations: Array<{ holder_id: string; right_id: string; reason: string }> = [];
    
    for (const alloc of allocation.allocations) {
        const right = catalog.available_rights.find(r => r.id === alloc.right_id);
        if (!right) {
            violations.push({
                holder_id: alloc.holder_id,
                right_id: alloc.right_id,
                reason: "Right not found in catalog",
            });
            continue;
        }
        
        const context = holderContexts.get(alloc.holder_id);
        if (!context) {
            violations.push({
                holder_id: alloc.holder_id,
                right_id: alloc.right_id,
                reason: "Holder context not provided",
            });
            continue;
        }
        
        if (!canHoldRight(right, context)) {
            violations.push({
                holder_id: alloc.holder_id,
                right_id: alloc.right_id,
                reason: "Holder does not satisfy constraints",
            });
        }
    }
    
    return violations;
}

// =============================================================================
// ALLOCATION VALIDATION
// =============================================================================

/**
 * Validate a complete allocation.
 */
export function validateAllocation(
    allocation: RightsAllocation,
    catalog: RightsCatalog,
    holderContexts: Map<string, Record<string, any>>
): {
    valid: boolean;
    conflicts: Array<{ right1: string; right2: string; reason: string }>;
    violations: Array<{ holder_id: string; right_id: string; reason: string }>;
} {
    const conflicts = findConflicts(allocation, catalog);
    const violations = validateHolders(allocation, catalog, holderContexts);
    
    return {
        valid: conflicts.length === 0 && violations.length === 0,
        conflicts,
        violations,
    };
}

/**
 * Check if a new allocation can be added to an existing timeline.
 */
export function canAddAllocation(
    newAllocation: RightsAllocation,
    existingAllocations: RightsAllocation[],
    catalog: RightsCatalog
): {
    can_add: boolean;
    overlaps: RightsAllocation[];
    conflicts: Array<{ right1: string; right2: string; reason: string }>;
} {
    const overlaps: RightsAllocation[] = [];
    const conflicts: Array<{ right1: string; right2: string; reason: string }> = [];
    
    for (const existing of existingAllocations) {
        const newStart = newAllocation.time_slot.start.getTime();
        const newEnd = newAllocation.time_slot.end.getTime();
        const existingStart = existing.time_slot.start.getTime();
        const existingEnd = existing.time_slot.end.getTime();
        
        // Check for overlap
        if (newStart < existingEnd && newEnd > existingStart) {
            overlaps.push(existing);
            
            // Check if rights are compatible
            for (const newAlloc of newAllocation.allocations) {
                for (const existingAlloc of existing.allocations) {
                    if (!areRightsCompatible(newAlloc.right_id, existingAlloc.right_id, catalog)) {
                        conflicts.push({
                            right1: newAlloc.right_id,
                            right2: existingAlloc.right_id,
                            reason: `Time overlap: ${new Date(newStart).toISOString()} - ${new Date(newEnd).toISOString()}`,
                        });
                    }
                }
            }
        }
    }
    
    return {
        can_add: conflicts.length === 0,
        overlaps,
        conflicts,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the default combination for a resource.
 */
export function getDefaultCombination(
    catalog: RightsCatalog
): RightsCombination | null {
    if (!catalog.default_combination_id) return null;
    
    return (
        catalog.valid_combinations.find(
            combo => combo.combination_id === catalog.default_combination_id
        ) || null
    );
}

/**
 * Get all rights held by a specific holder.
 */
export function getRightsByHolder(
    allocation: RightsAllocation,
    holderId: string
): string[] {
    return allocation.allocations
        .filter(a => a.holder_id === holderId)
        .map(a => a.right_id);
}

/**
 * Get all holders of a specific right.
 */
export function getHoldersByRight(
    allocation: RightsAllocation,
    rightId: string
): Array<{ holder_id: string; holder_type: 'person' | 'process' }> {
    return allocation.allocations
        .filter(a => a.right_id === rightId)
        .map(a => ({ holder_id: a.holder_id, holder_type: a.holder_type }));
}
