/**
 * Labor Pool Abstraction
 * 
 * Bridges matching (skills on Contact/persons) with planning (labor capacity).
 * Preserves skill-space-time structure during aggregation.
 * 
 * Key insight: Labor isn't fungible. A welder in Berlin on Monday is different
 * from a welder in Munich on Tuesday, and both are different from an electrician.
 */

import { z } from 'zod';
import { AvailabilityWindowSchema, type AvailabilityWindow } from './time';
import { SkillSchema, type Skill } from './skills';
import type { Contact } from '../types';
import { getSpaceTimeSignature, getTimeSignature } from './matching';
import { PersonSchema, type Person } from './person';
import { createHexIndex, addItemToHexIndex, queryHexIndex, type HexIndex, type HexNode } from './hex';

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * LaborPool: Aggregated availability of persons with a specific skill
 * in a specific space-time context.
 * 
 * Example: "40 hours of welding labor in Berlin, Mon-Fri 9-5"
 */
export const LaborPool = z.object({
    /** Unique identifier for this pool */
    id: z.string(),
    
    /** The skill this pool provides */
    skill: SkillSchema,
    
    /** Space-time signature (from getSpaceTimeSignature) */
    space_time_signature: z.string(),
    
    /** Structured availability window */
    availability_window: AvailabilityWindowSchema.optional(),
    
    /** Location context */
    location: z.object({
        h3_index: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
    }).optional(),
    
    /** Total hours available in this pool */
    total_hours: z.number().nonnegative(),
    
    /** Source persons contributing to this pool (for traceability) */
    person_ids: z.array(z.string()),
    
    /** Statistical distribution */
    stats: z.object({
        mean_hours_per_person: z.number(),
        min_hours: z.number(),
        max_hours: z.number(),
        person_count: z.number().int(),
    }).optional(),
});

export type LaborPool = z.infer<typeof LaborPool>;

/**
 * Query interface for finding labor pools
 */
export const LaborPoolQuery = z.object({
    skill_id: z.string().optional(),
    location: z.object({
        city: z.string().optional(),
        country: z.string().optional(),
        h3_index: z.string().optional(),
        max_distance_km: z.number().optional(),
    }).optional(),
    min_hours: z.number().optional(),
    availability_pattern: z.string().optional(), // Regex for space_time_signature
});

export type LaborPoolQuery = z.infer<typeof LaborPoolQuery>;

/**
 * PersonWithAvailability is now just an alias for Person.
 * 
 * @deprecated Use Person from './person' directly.
 * This alias exists for backward compatibility only.
 */
export type PersonWithAvailability = Person;

/**
 * PersonCapacity: Person-level labor capacity in a specific space-time context.
 * 
 * CRITICAL: This is the atomic unit of labor capacity. A person's hours are
 * stored ONCE here, even if they have multiple skills. Skills are indexes
 * that REFERENCE this capacity, not duplicate it.
 * 
 * This prevents double-counting: Alice with 40 hours and skills ["welding", "electrical"]
 * has ONE PersonCapacity with 40 hours, referenced by BOTH skill indexes.
 */
export const PersonCapacity = z.object({
    /** Unique ID: person_id|space_time_signature */
    id: z.string(),
    
    /** Source person ID */
    person_id: z.string(),
    
    /** Space-time context signature */
    space_time_signature: z.string(),
    
    /** Total hours available (stored ONCE, shared across all skills) */
    total_hours: z.number().nonnegative(),
    
    /** All skills this person has (for indexing) */
    skills: z.array(SkillSchema),
    
    /** Location context */
    location: z.object({
        h3_index: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
    }).optional(),
    
    /** Availability window */
    availability_window: AvailabilityWindowSchema.optional(),
});

export type PersonCapacity = z.infer<typeof PersonCapacity>;

/**
 * LaborIndex: Container for person-level capacities with skill-based indexing.
 * 
 * Structure:
 * - person_capacities: Map<CapacityId, PersonCapacity> - ONE entry per person per space-time
 * - skill_index: Map<SkillId, Set<CapacityId>> - Skills REFERENCE capacities, don't duplicate
 * 
 * Query pattern:
 * 1. Query skill_index to get Set<CapacityId>
 * 2. Lookup capacities in person_capacities
 * 3. Sum total_hours (automatic deduplication via Set)
 */
export interface LaborIndex {
    /** Person-level capacities (indexed by space-time) */
    person_capacities: Map<string, PersonCapacity>;
    
    /** Skill-level index (references to person capacities) */
    skill_index: Map<string, Set<string>>;
    
    /** Space-time index (for location/time queries) */
    space_time_index: Map<string, Set<string>>;

    /** Hierarchical Spatial Index (H3) */
    spatial_hierarchy: HexIndex<PersonCapacity>;
}


// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Compute total available hours for a person within a time window.
 * 
 * If no time window specified, uses max_hours_per_week or estimates from
 * availability_window structure.
 */
export function computeAvailableHours(
    person: PersonWithAvailability,
    timeWindow?: { start: Date; end: Date }
): number {
    // If explicit max hours specified, use that
    if (person.max_hours_per_week) {
        if (!timeWindow) return person.max_hours_per_week;
        
        const days = (timeWindow.end.getTime() - timeWindow.start.getTime()) / (1000 * 60 * 60 * 24);
        return (person.max_hours_per_week / 7) * days;
    }
    
    // Estimate from availability_window
    // This is a rough heuristic - for precise calculation, use matching.ts overlap logic
    if (person.availability_window) {
        const window = person.availability_window;
        let estimatedHoursPerWeek = 0;
        
        // Count from day_schedules
        if (window.day_schedules?.length) {
            for (const sched of window.day_schedules) {
                const daysPerWeek = sched.days.length;
                const hoursPerDay = sched.time_ranges.reduce((sum, range) => {
                    const [startH, startM] = range.start_time.split(':').map(Number);
                    const [endH, endM] = range.end_time.split(':').map(Number);
                    const hours = (endH + endM / 60) - (startH + startM / 60);
                    return sum + hours;
                }, 0);
                estimatedHoursPerWeek += daysPerWeek * hoursPerDay;
            }
        } else if (window.time_ranges?.length) {
            // Assume all 7 days if only time_ranges specified
            const hoursPerDay = window.time_ranges.reduce((sum, range) => {
                const [startH, startM] = range.start_time.split(':').map(Number);
                const [endH, endM] = range.end_time.split(':').map(Number);
                const hours = (endH + endM / 60) - (startH + startM / 60);
                return sum + hours;
            }, 0);
            estimatedHoursPerWeek = hoursPerDay * 7;
        }
        
        if (!timeWindow) return estimatedHoursPerWeek;
        
        const days = (timeWindow.end.getTime() - timeWindow.start.getTime()) / (1000 * 60 * 60 * 24);
        return (estimatedHoursPerWeek / 7) * days;
    }
    
    // Fallback: assume 40 hours/week if max_hours_per_day specified
    if (person.max_hours_per_day) {
        const hoursPerWeek = person.max_hours_per_day * 5; // Assume 5-day week
        if (!timeWindow) return hoursPerWeek;
        
        const days = (timeWindow.end.getTime() - timeWindow.start.getTime()) / (1000 * 60 * 60 * 24);
        return (hoursPerWeek / 7) * days;
    }
    
    // Ultimate fallback
    return 40;
}

/**
 * Get space-time-skill signature for a person.
 * 
 * Combines space-time signature with skill ID for pool grouping.
 */
export function getSpaceTimeSkillSignature(
    person: PersonWithAvailability,
    skill: Skill
): string {
    // Build a pseudo-Resource for getSpaceTimeSignature
    const pseudoResource = {
        availability_window: person.availability_window,
        recurrence: person.availability_window ? 'weekly' : null,
        start_date: null,
        end_date: null,
        location_type: person.location?.city ? 'physical' : undefined,
        city: person.location?.city,
        country: person.location?.country,
        online_link: undefined,
        latitude: person.location?.latitude,
        longitude: person.location?.longitude,
        h3_index: person.location?.h3_index,
    };
    
    const spaceTimeKey = getSpaceTimeSignature(pseudoResource as any);
    return `${skill.id}|${spaceTimeKey}`;
}

/**
 * Build labor index from persons with deduplication.
 * 
 * CRITICAL: Prevents double-counting by storing person capacity ONCE,
 * then indexing by skills (references, not copies).
 * 
 * Example: Alice with 40 hours and skills ["welding", "electrical"]
 * - Creates ONE PersonCapacity with 40 hours
 * - Both skill indexes reference the same capacity
 * - Total hours = 40 (not 80!)
 */
export function buildLaborIndex(
    persons: PersonWithAvailability[],
    timeWindow?: { start: Date; end: Date }
): LaborIndex {
    const personCapacities = new Map<string, PersonCapacity>();
    const skillIndex = new Map<string, Set<string>>();
    const spaceTimeIndex = new Map<string, Set<string>>();
    const spatialHierarchy = createHexIndex<PersonCapacity>(9, 0); // Default to Res 9 leaf
    
    for (const person of persons) {
        if (!person.skills?.length) continue;
        
        // Get space-time signature (without skill, since capacity is person-level)
        const pseudoResource = {
            availability_window: person.availability_window,
            recurrence: person.availability_window ? 'weekly' : null,
            start_date: null,
            end_date: null,
            location_type: person.location?.city ? 'physical' : undefined,
            city: person.location?.city,
            country: person.location?.country,
            online_link: undefined,
            latitude: person.location?.latitude,
            longitude: person.location?.longitude,
            h3_index: person.location?.h3_index,
        };
        const spaceTimeSig = getSpaceTimeSignature(pseudoResource as any);
        
        // Create unique capacity ID
        const capacityId = `${person.id}|${spaceTimeSig}`;
        
        // Compute hours ONCE for this person
        const totalHours = computeAvailableHours(person, timeWindow);
        
        // Store person capacity (ATOMIC - stored once)
        const capacity: PersonCapacity = {
            id: capacityId,
            person_id: person.id,
            space_time_signature: spaceTimeSig,
            total_hours: totalHours,
            skills: person.skills,
            location: person.location,
            availability_window: person.availability_window,
        };
        personCapacities.set(capacityId, capacity);

        // Populate Hex Index
        if (person.location) {
            addItemToHexIndex(
                spatialHierarchy, 
                capacity, 
                capacityId, 
                { 
                    lat: person.location.latitude, 
                    lon: person.location.longitude,
                    h3_index: person.location.h3_index 
                },
                { hours: totalHours },
                person.availability_window // Pass full window for nested indexing
            );
        }
        
        // Index by skills (REFERENCES - no duplication)
        for (const skill of person.skills) {
            if (!skillIndex.has(skill.id)) {
                skillIndex.set(skill.id, new Set());
            }
            skillIndex.get(skill.id)!.add(capacityId);
        }
        
        // Index by space-time (for location/time queries)
        if (!spaceTimeIndex.has(spaceTimeSig)) {
            spaceTimeIndex.set(spaceTimeSig, new Set());
        }
        spaceTimeIndex.get(spaceTimeSig)!.add(capacityId);
    }
    
    return {
        person_capacities: personCapacities,
        skill_index: skillIndex,
        space_time_index: spaceTimeIndex,
        spatial_hierarchy: spatialHierarchy,
    };
}

/**
 * Query labor index by skill.
 * Returns person capacities (not duplicated hours).
 */
export function queryLaborBySkill(
    index: LaborIndex,
    skillId: string
): PersonCapacity[] {
    const capacityIds = index.skill_index.get(skillId);
    if (!capacityIds) return [];
    
    return Array.from(capacityIds)
        .map(id => index.person_capacities.get(id))
        .filter((c): c is PersonCapacity => c !== undefined);
}

/**
 * Query labor index by multiple skills (union).
 * Automatically deduplicates persons with multiple matching skills.
 */
export function queryLaborBySkills(
    index: LaborIndex,
    skillIds: string[]
): PersonCapacity[] {
    const capacityIdSet = new Set<string>();
    
    for (const skillId of skillIds) {
        const ids = index.skill_index.get(skillId);
        if (ids) {
            ids.forEach(id => capacityIdSet.add(id));
        }
    }
    
    return Array.from(capacityIdSet)
        .map(id => index.person_capacities.get(id))
        .filter((c): c is PersonCapacity => c !== undefined);
}

/**
 * Query labor index by location.
 */
export function queryLaborByLocation(
    index: LaborIndex,
    location: { city?: string; country?: string; h3_index?: string }
): PersonCapacity[] {
    const results: PersonCapacity[] = [];
    
    for (const capacity of index.person_capacities.values()) {
        if (location.city && capacity.location?.city !== location.city) continue;
        if (location.country && capacity.location?.country !== location.country) continue;
        if (location.h3_index && capacity.location?.h3_index !== location.h3_index) continue;
        results.push(capacity);
    }
    
    return results;
}

/**
 * Query labor index by skill AND location.
 */
export function queryLaborBySkillAndLocation(
    index: LaborIndex,
    skillId: string,
    location: { city?: string; country?: string; h3_index?: string }
): PersonCapacity[] {
    const skillCapacities = queryLaborBySkill(index, skillId);
    
    return skillCapacities.filter(capacity => {
        if (location.city && capacity.location?.city !== location.city) return false;
        if (location.country && capacity.location?.country !== location.country) return false;
        if (location.h3_index && capacity.location?.h3_index !== location.h3_index) return false;
        return true;
    });
}

/**
 * Get total hours from person capacities (no double-counting).
 */
export function getTotalHours(capacities: PersonCapacity[]): number {
    return capacities.reduce((sum, c) => sum + c.total_hours, 0);
}

/**
 * Query labor by H3 cell (hierarchical).
 * Returns the HexNode containing stats and items.
 */
export function queryLaborByHex(
    index: LaborIndex,
    cell: string
): HexNode<PersonCapacity> | null {
    return queryHexIndex(index.spatial_hierarchy, cell);
}

/**
 * Query labor pools by criteria.
 */
export function queryLaborPools(
    pools: LaborPool[],
    query: LaborPoolQuery
): LaborPool[] {
    return pools.filter(pool => {
        // Filter by skill
        if (query.skill_id && pool.skill.id !== query.skill_id) {
            return false;
        }
        
        // Filter by location
        if (query.location) {
            if (query.location.city && pool.location?.city !== query.location.city) {
                return false;
            }
            if (query.location.country && pool.location?.country !== query.location.country) {
                return false;
            }
            if (query.location.h3_index && pool.location?.h3_index !== query.location.h3_index) {
                return false;
            }
        }
        
        // Filter by minimum hours
        if (query.min_hours && pool.total_hours < query.min_hours) {
            return false;
        }
        
        // Filter by availability pattern
        if (query.availability_pattern) {
            const regex = new RegExp(query.availability_pattern);
            if (!regex.test(pool.space_time_signature)) {
                return false;
            }
        }
        
        return true;
    });
}

/**
 * Merge multiple labor pools into one.
 * Useful for combining pools across different space-time contexts.
 */
export function mergeLaborPools(pools: LaborPool[]): LaborPool | null {
    if (pools.length === 0) return null;
    if (pools.length === 1) return pools[0];
    
    const first = pools[0];
    const totalHours = pools.reduce((sum, p) => sum + p.total_hours, 0);
    const allPersonIds = new Set<string>();
    const allHours: number[] = [];
    
    for (const pool of pools) {
        for (const personId of pool.person_ids) {
            allPersonIds.add(personId);
        }
        if (pool.stats) {
            allHours.push(pool.stats.mean_hours_per_person);
        }
    }
    
    const meanHours = allHours.length > 0 
        ? allHours.reduce((sum, h) => sum + h, 0) / allHours.length
        : totalHours / allPersonIds.size;
    
    return {
        id: `merged_${first.skill.id}`,
        skill: first.skill,
        space_time_signature: 'merged',
        availability_window: first.availability_window,
        location: first.location,
        total_hours: totalHours,
        person_ids: Array.from(allPersonIds),
        stats: {
            mean_hours_per_person: meanHours,
            min_hours: Math.min(...allHours),
            max_hours: Math.max(...allHours),
            person_count: allPersonIds.size,
        },
    };
}
