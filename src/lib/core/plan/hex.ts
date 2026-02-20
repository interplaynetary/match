/**
 * Hierarchical H3 Spatial Indexing
 * 
 * Provides a generic hierarchical index for aggregating data at multiple
 * H3 resolutions naturally.
 * 
 * Replaces/Augments rigid "Signature" based aggregation with true
 * multi-resolution spatial querying.
 */

import * as h3 from 'h3-js';
import type { AvailabilityWindow, DayOfWeek } from './time';
import { flattenWindowToUTCDaySchedules } from './matching';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Aggregated statistics for a spatial node.
 * Flexible structure to support Labor (hours), Resources (quantity), etc.
 */
export interface HexStats {
    /** Number of unique items in this cell (or its children) */
    count: number;
    
    /** Sum of 'quantity' (for Resources/Needs) */
    sum_quantity: number;
    
    /** Sum of 'total_hours' (for Labor) */
    sum_hours: number;
    
    /** Custom aggregations can be added here */
}

/**
 * Leaf Temporal Node (Specific Time Slot/Bin)
 */
export interface TimeBin {
    stats: HexStats;
    items: Set<string>;
}

/**
 * Day-Level Node (e.g. "Every Monday")
 */
export interface DayNode {
    stats: HexStats;
    items: Set<string>;
    // In future: could have specific time ranges here
    // For now, treat as a bin for the whole day
}

/**
 * Week-Level Node (e.g. "First week of the month")
 */
export interface WeekNode {
    stats: HexStats;
    items: Set<string>;
    
    days: Map<string, DayNode>; // Specific days within this week pattern
    full_time: TimeBin;         // "Every day" within this week pattern
}

/**
 * Month-Level Node (e.g. "Every February")
 */
export interface MonthNode {
    stats: HexStats;
    items: Set<string>;
    
    weeks: Map<number, WeekNode>; // Specific weeks within this month
    days: Map<string, DayNode>;   // Specific days (all weeks) within this month
    full_time: TimeBin;           // "Every day" within this month
}

/**
 * Root Temporal Index for a Spatial Cell.
 * Mirrors AvailabilityWindow structure.
 */
export interface TemporalIndex {
    // ONE-TIME: Indexed by exact date (YYYY-MM-DD)
    specific_dates: Map<string, TimeBin>; 
    
    // RECURRING: Hierarchical Patterns
    recurring: {
        // LEVEL 1: Month-Specific Patterns
        months: Map<number, MonthNode>;

        // LEVEL 2: Week-Specific Patterns (Applies to ALL months)
        weeks: Map<number, WeekNode>;

        // LEVEL 3: Day-Specific Patterns (Applies to ALL months, ALL weeks)
        days: Map<string, DayNode>;

        // LEVEL 4: Time-Only Patterns (Applies to ALL days)
        full_time: TimeBin;
    };
}

/**
 * A node in the H3 hierarchy.
 */
export interface HexNode<T> {
    /** The H3 index of this cell */
    cell: string;
    
    /** Resolution level (0-15) */
    resolution: number;
    
    /** Items physically located in this cell (mostly for leaf nodes) */
    items: Set<string>;
    
    /** Aggregated statistics (includes children) */
    stats: HexStats;
    
    /** Nested Temporal Index */
    temporal: TemporalIndex;

    /** Child cells (if we want to traverse down) - optional optimization */
    // children?: Set<string>; 
}

/**
 * The Hierarchical Index container.
 */
export interface HexIndex<T> {
    /** All nodes indexed by H3 cell string */
    nodes: Map<string, HexNode<T>>;
    
    /** Original items map (ID -> Item) for retrieval */
    items: Map<string, T>;
    
    /** Configuration */
    config: {
        /** The finest resolution to index items at (default: 9 ~0.1km²) */
        leaf_resolution: number;
        
        /** The coarsest resolution to aggregate up to (default: 0) */
        root_resolution: number;
    };
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Create a new empty HexIndex.
 */
export function createHexIndex<T>(
    leafResolution: number = 9,
    rootResolution: number = 0
): HexIndex<T> {
    return {
        nodes: new Map(),
        items: new Map(),
        config: {
            leaf_resolution: leafResolution,
            root_resolution: rootResolution,
        },
    };
}

/**
 * Helper to get or create a node.
 */
function getOrCreateNode<T>(
    index: HexIndex<T>,
    cell: string,
    resolution: number
): HexNode<T> {
    let node = index.nodes.get(cell);
    if (!node) {
        node = {
            cell,
            resolution,
            items: new Set(),
            stats: {
                count: 0,
                sum_quantity: 0,
                sum_hours: 0,
            },
            temporal: createTemporalIndex(),
        };
        index.nodes.set(cell, node);
    }
    return node;
}

function createTemporalIndex(): TemporalIndex {
    return {
        specific_dates: new Map(),
        recurring: {
            months: new Map(),
            weeks: new Map(),
            days: new Map(),
            full_time: createTimeBin(),
        }
    };
}

function createTimeBin(): TimeBin {
    return {
        stats: { count: 0, sum_quantity: 0, sum_hours: 0 },
        items: new Set()
    };
}

function createDayNode(): DayNode {
    return {
        stats: { count: 0, sum_quantity: 0, sum_hours: 0 },
        items: new Set()
    };
}

function createWeekNode(): WeekNode {
    return {
        stats: { count: 0, sum_quantity: 0, sum_hours: 0 },
        items: new Set(),
        days: new Map(),
        full_time: createTimeBin()
    };
}

function createMonthNode(): MonthNode {
    return {
        stats: { count: 0, sum_quantity: 0, sum_hours: 0 },
        items: new Set(),
        weeks: new Map(),
        days: new Map(),
        full_time: createTimeBin()
    };
}

/**
 * Add an item to the hierarchical index.
 * 
 * @param index The index to update
 * @param item The item object (must be stored in index.items)
 * @param itemId Unique ID of the item
 * @param location { lat, lon } or existing H3 index
 * @param values Values to aggregate (quantity, hours)
 */
export function addItemToHexIndex<T>(
    index: HexIndex<T>,
    item: T,
    itemId: string,
    location: { lat?: number; lon?: number; h3_index?: string },
    values: { quantity?: number; hours?: number } = {},
    availability?: AvailabilityWindow,
    timeSignature?: string // KEEPING FOR COMPATIBILITY / DEBUGGING but primary is availability
): void {
    // 1. Determine Leaf Cell
    let leafCell: string;
    
    if (location.h3_index) {
        // If provided index is coarser/finer, we might need to adjust, 
        // but typically we trust the provided H3 or re-compute at leaf_resolution.
        // For safety, if lat/lon available, recompute to ensure consistency.
        if (location.lat !== undefined && location.lon !== undefined) {
             leafCell = h3.latLngToCell(location.lat, location.lon, index.config.leaf_resolution);
        } else {
             // If only h3_index provided, rely on it (might not match leaf_resolution exactly)
             // Ideally we force re-computation or validation. Use it as-is for now if valid.
             leafCell = location.h3_index; // Risky if resolution mismatch
        }
    } else if (location.lat !== undefined && location.lon !== undefined) {
        leafCell = h3.latLngToCell(location.lat, location.lon, index.config.leaf_resolution);
    } else {
        // No location? Skip spatial indexing (or put in a 'remote' bucket? Not handled here yet)
        return;
    }
    
    // Store item reference
    index.items.set(itemId, item);
    
    const quantity = values.quantity ?? 0;
    const hours = values.hours ?? 0;
    
    // 2. Update Hierarchy (Leaf -> Root)
    let currentCell = leafCell;
    let currentRes = h3.getResolution(currentCell);
    
    // Ensure we don't go finer than leaf config (in case input H3 was super fine)
    // Actually, walking UP is safe.
    
    while (currentRes >= index.config.root_resolution) {
        const node = getOrCreateNode(index, currentCell, currentRes);
        
        // Update stats
        node.stats.count += 1;
        node.stats.sum_quantity += quantity;
        node.stats.sum_hours += hours;
        
        // Add item ID only to the leaf node (or potentially strictly contained nodes)
        // For now: add to all nodes? 
        // Adding to all nodes allows "get items in Europe" to work instantly (Set lookup).
        // BUT makes memory usage O(depth * N). 
        // Optimization: Add only to leaf. Queries for coarse nodes must Aggregate stats, 
        // or if they need items, they might need to traverse children (expensive without links).
        // Compromise: Add usage of `items` set is mainly for retrieval. 
        // Let's add to ALL levels for now (simplest for querying "Give me everything in Berlin").
        node.items.add(itemId);
        
        // 3. Update Temporal Index
        if (availability) {
            indexItemTemporally(node.temporal, availability, itemId, quantity, hours);
        } else if (timeSignature) {
            // Fallback for simple signature-based (e.g. one-time without full window)
            // We can treat it as a "Full Time" or specific bin if possible, 
            // but for now let's just dump it into 'full_time' or a specific date if we parse it?
            // Actually, simpler to just ignore or put in 'full_time' if no window provided.
            // Let's assume if no window, it's 'always available' or 'unknown' -> full_time
            addToBin(node.temporal.recurring.full_time, quantity, hours, itemId);
        }

        // Move to parent

        // Move to parent
        if (currentRes === 0) break; // Can't go coarser than 0
        currentCell = h3.cellToParent(currentCell, currentRes - 1);
        currentRes--;
    }
}

/**
 * Query the index at a specific H3 cell (any resolution).
 * Returns the aggregated stats and the set of item IDs.
 */
export function queryHexIndex<T>(
    index: HexIndex<T>,
    cell: string
): HexNode<T> | null {
    return index.nodes.get(cell) || null;
}

/**
 * Get all items within an H3 cell (O(1) if we indexed IDs at all levels).
 */
export function getItemsInCell<T>(
    index: HexIndex<T>,
    cell: string
): T[] {
    const node = index.nodes.get(cell);
    if (!node) return [];
    
    const results: T[] = [];
    for (const id of node.items) {
        const item = index.items.get(id);
        if (item) results.push(item);
    }
    return results;
}

// =============================================================================
// TEMPORAL INDEXING LOGIC
// =============================================================================

function indexItemTemporally(
    index: TemporalIndex,
    window: AvailabilityWindow,
    itemId: string,
    quantity: number,
    hours: number
): void {
    // 1. One-Time (Specific Dates)
    // If availability has specific dates (derived from time_ranges without recurrence? 
    // actually matching.ts handles parsing. Here we rely on window structure).
    // The window structure itself doesn't explicitly separate "one-time" at top level 
    // except via absence of recurrence. 
    // But `AvailabilityWindow` usually comes from a slot which MIGHT have `recurrence`.
    // If we only have `AvailabilityWindow`, we assume it describes the PATTERN.
    // If the PARENT slot was "one-time", it would have been converted to a specific date window?
    // Let's assume for this index, we trust the structure.
    
    // Check for MONTH schedules
    if (window.month_schedules?.length) {
        for (const sched of window.month_schedules) {
            let mNode = index.recurring.months.get(sched.month);
            if (!mNode) {
                mNode = createMonthNode();
                index.recurring.months.set(sched.month, mNode);
            }
            
            // Recurse into Month
            if (sched.week_schedules?.length) {
                for (const wSched of sched.week_schedules) {
                    for (const weekNum of wSched.weeks) {
                        let wNode = mNode.weeks.get(weekNum);
                        if (!wNode) {
                            wNode = createWeekNode();
                            mNode.weeks.set(weekNum, wNode);
                        }
                        // Recurse into Week (inside Month)
                        addToWeekNode(wNode, wSched.day_schedules, quantity, hours, itemId);
                    }
                }
            } else if (sched.day_schedules?.length) {
                 addToMonthDayNode(mNode, sched.day_schedules, quantity, hours, itemId);
            } else {
                 // Whole month?
                 addToBin(mNode.full_time, quantity, hours, itemId);
            }
        }
        return; // specific months defined, so done.
    }

    // Check for WEEK schedules (Applies to ALL months)
    if (window.week_schedules?.length) {
        for (const wSched of window.week_schedules) {
            for (const weekNum of wSched.weeks) {
                let wNode = index.recurring.weeks.get(weekNum);
                if (!wNode) {
                     wNode = createWeekNode();
                     index.recurring.weeks.set(weekNum, wNode);
                }
                addToWeekNode(wNode, wSched.day_schedules, quantity, hours, itemId);
            }
        }
        return;
    }

    // Check for DAY schedules (Applies to ALL months, ALL weeks)
    if (window.day_schedules?.length) {
        for (const dSched of window.day_schedules) {
            for (const day of dSched.days) {
                let dNode = index.recurring.days.get(day);
                if (!dNode) {
                    dNode = createDayNode();
                    index.recurring.days.set(day, dNode);
                }
                addToBin(dNode.stats as any, quantity, hours, itemId); // DayNode IS a bin
            }
        }
        return;
    }
    
    // Check for Simple Time Ranges (Applies to EVERY DAY)
    if (window.time_ranges?.length) {
        addToBin(index.recurring.full_time, quantity, hours, itemId);
        return;
    }
}

// Helper to add to a Week Node
function addToWeekNode(
    node: WeekNode, 
    daySchedules: any[], /* DaySchedule[] */
    q: number, h: number, id: string
) {
    if (!daySchedules?.length) {
        addToBin(node.full_time, q, h, id);
        return;
    }
    for (const dSched of daySchedules) {
        for (const day of dSched.days) {
            let dNode = node.days.get(day);
            if (!dNode) {
                dNode = createDayNode();
                node.days.set(day, dNode);
            }
            addToBin(dNode.stats as any, q, h, id);
        }
    }
}

// Helper to add to a Month Node (direct day children)
function addToMonthDayNode(
    node: MonthNode,
    daySchedules: any[],
    q: number, h: number, id: string
) {
    for (const dSched of daySchedules) {
        for (const day of dSched.days) {
            let dNode = node.days.get(day);
            if (!dNode) {
                dNode = createDayNode();
                node.days.set(day, dNode);
            }
            addToBin(dNode.stats as any, q, h, id);
        }
    }
}

function addToBin(bin: { stats: HexStats, items: Set<string> }, q: number, h: number, id: string) {
    bin.stats.count++;
    bin.stats.sum_quantity += q;
    bin.stats.sum_hours += h;
    bin.items.add(id);
}
