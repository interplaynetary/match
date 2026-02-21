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
import type { AvailabilityWindow, TemporalExpression, DayOfWeek } from './time';
import { isSpecificDateWindow } from './time';
import { calendarComponents } from './space-time-keys';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Aggregated statistics for a spatial node or temporal bin.
 *
 * IMPORTANT — denominator semantics vary by context:
 *
 *   HexNode.stats        → spatial aggregate across ALL temporal contexts in this cell.
 *                          count = number of items physically in this cell (or its children).
 *                          Do NOT sum across cells at different resolutions (same item is
 *                          counted at every ancestor, so totals would double-count).
 *
 *   TimeBin.stats        → temporal aggregate for ONE bin (a specific date, or full_time).
 *                          count = number of items in THIS bin only.
 *                          Summing across bins (e.g. all specific_dates) gives total
 *                          activity across dates, NOT unique items.
 *
 *   DayNode.stats        → items available on this day-of-week pattern.
 *   WeekNode.stats       → items in this week-of-month pattern.
 *   MonthNode.stats      → items in this month pattern.
 *
 * For unique item counts use the `items: Set<string>` field — its `.size` is always
 * the number of distinct IDs regardless of how many temporal bins they appear in.
 */
export interface HexStats {
    /** Items in this node/bin. See denominator note above before summing across bins. */
    count: number;

    /** Sum of resource quantity values for items in this node/bin. */
    sum_quantity: number;

    /** Sum of effort/hour values for items in this node/bin. */
    sum_hours: number;
}

/**
 * Leaf Temporal Node — one discrete time slot.
 *
 * `items` is the authoritative set of IDs in this bin.
 * `stats` is a pre-computed aggregate over those items (for cheap analytics).
 * Never sum stats.count across different TimeBins to get unique item counts —
 * use Set union on `items` instead.
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
    temporal?: TemporalExpression,
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
        if (temporal) {
            if (isSpecificDateWindow(temporal)) {
                // Point-in-time: bin each specific date
                for (const date of temporal.specific_dates) {
                    let bin = node.temporal.specific_dates.get(date);
                    if (!bin) {
                        bin = createTimeBin();
                        node.temporal.specific_dates.set(date, bin);
                    }
                    addToBin(bin, quantity, hours, itemId);
                }
            } else {
                // AvailabilityWindow — walk the recurring hierarchy
                indexItemTemporally(node.temporal, temporal, itemId, quantity, hours);
            }
        } else {
            // No temporal context — treat as always available
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

/**
 * Query the index around a specific coordinate within a radius.
 * Returns a Set of item IDs that fall within the covering H3 cells.
 */
export function queryHexIndexRadius<T>(
    index: HexIndex<T>,
    query: {
        h3_index?: string;
        latitude?: number;
        longitude?: number;
        radius_km?: number;
    }
): Set<string> {
    const matchingIds = new Set<string>();
    let searchCells: string[] = [];
    
    // Determine the cells to search based on the query parameters
    if (query.h3_index) {
        if (query.radius_km && query.radius_km > 0) {
           // Get k-ring if a radius is provided for an existing h3 index.
           const res = h3.getResolution(query.h3_index);
           const edgeLengthKm = h3.getHexagonEdgeLengthAvg(res as number, h3.UNITS.km);
           const k = Math.max(1, Math.ceil(query.radius_km / (edgeLengthKm * 2)));
           searchCells = h3.gridDisk(query.h3_index, k);
        } else {
           searchCells = [query.h3_index];
        }
    } else if (query.latitude !== undefined && query.longitude !== undefined) {
        if (query.radius_km && query.radius_km > 0) {
            // Find appropriate resolution based on search radius
            // For a search, it's safer to use a slightly coarser resolution to ensure coverage
            let res = index.config.leaf_resolution;
            let edgeLengthKm = h3.getHexagonEdgeLengthAvg(res as number, h3.UNITS.km);
            while (edgeLengthKm * 2 < query.radius_km && res > index.config.root_resolution) {
                res--;
                edgeLengthKm = h3.getHexagonEdgeLengthAvg(res as number, h3.UNITS.km);
            }
            const centerCell = h3.latLngToCell(query.latitude, query.longitude, res);
            const k = Math.max(1, Math.ceil(query.radius_km / (edgeLengthKm * 2)));
            searchCells = h3.gridDisk(centerCell, k);
        } else {
             searchCells = [h3.latLngToCell(query.latitude, query.longitude, index.config.leaf_resolution)];
        }
    } else {
        return matchingIds; 
    }

    // Collect item IDs from the identified cells (and all their children down to leaf)
    for (const cell of searchCells) {
        const node = index.nodes.get(cell);
        if (node) {
            for (const itemId of node.items) {
                matchingIds.add(itemId);
            }
        }
    }

    return matchingIds;
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
                addToBin(dNode, quantity, hours, itemId);
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
            addToBin(dNode, q, h, id);
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
            addToBin(dNode, q, h, id);
        }
    }
}

function addToBin(bin: { stats: HexStats, items: Set<string> }, q: number, h: number, id: string) {
    bin.stats.count++;
    bin.stats.sum_quantity += q;
    bin.stats.sum_hours += h;
    bin.items.add(id);
}

// =============================================================================
// TEMPORAL QUERY API
// =============================================================================

function unionSets(...sets: (Set<string> | undefined)[]): Set<string> {
    const result = new Set<string>();
    for (const s of sets) {
        if (s) for (const id of s) result.add(id);
    }
    return result;
}

/**
 * Items explicitly indexed on a specific date (YYYY-MM-DD).
 *
 * Returns only items from the `specific_dates` bin — point-in-time events and
 * single-date commitments that were recorded on exactly this date.
 * Does NOT include recurring items (use queryNodeOnCalendarDate for that).
 */
export function queryNodeByDate<T>(node: HexNode<T>, date: string): Set<string> {
    return new Set(node.temporal.specific_dates.get(date)?.items ?? []);
}

/**
 * Items indexed for a recurring day-of-week pattern across ALL months and weeks.
 * Returns items from `recurring.days[day]` — standing offers/commitments with
 * a simple weekly recurrence.
 */
export function queryNodeByDayOfWeek<T>(node: HexNode<T>, day: DayOfWeek): Set<string> {
    return new Set(node.temporal.recurring.days.get(day)?.items ?? []);
}

/**
 * Items indexed for a recurring week-of-month pattern (across ALL months).
 * Returns items from `recurring.weeks[week]` and all day sub-nodes within it.
 */
export function queryNodeByWeekOfMonth<T>(node: HexNode<T>, week: number): Set<string> {
    const wNode = node.temporal.recurring.weeks.get(week);
    if (!wNode) return new Set();
    return unionSets(wNode.items, wNode.full_time.items, ...[...wNode.days.values()].map(d => d.items));
}

/**
 * Items indexed for a specific month pattern.
 * Returns items from `recurring.months[month]` and all week/day sub-nodes within it.
 */
export function queryNodeByMonth<T>(node: HexNode<T>, month: number): Set<string> {
    const mNode = node.temporal.recurring.months.get(month);
    if (!mNode) return new Set();
    const weekItems = [...mNode.weeks.values()].flatMap(w => [
        w.items, w.full_time.items, ...[...w.days.values()].map(d => d.items),
    ]);
    return unionSets(mNode.items, mNode.full_time.items, ...[...mNode.days.values()].map(d => d.items), ...weekItems);
}

/**
 * ALL items that apply on a given calendar date — the calendar expansion query.
 *
 * Unions:
 *   1. specific_dates[date]               ← one-time events/commitments on this date
 *   2. recurring.days[dayOfWeek]          ← standing weekly offers covering this day
 *   3. recurring.weeks[weekOfMonth] (and its day sub-node for this day)
 *   4. recurring.months[month] (and its week/day sub-nodes for this day/week)
 *   5. recurring.full_time                ← always-on items (no temporal context)
 *
 * This is the primary query for "what's available/happening on DATE at this cell?"
 * Contrast with queryNodeByDate which returns ONLY point-in-time indexed items.
 */
export function queryNodeOnCalendarDate<T>(node: HexNode<T>, isoDate: string): Set<string> {
    const { day, week, month } = calendarComponents(isoDate);
    const t = node.temporal;

    // Month sub-structures matching this date
    const mNode = t.recurring.months.get(month);
    const mFullTime   = mNode?.full_time.items;
    const mDayNode    = mNode?.days.get(day)?.items;
    const mWeekNode   = mNode?.weeks.get(week);
    const mWeekFull   = mWeekNode?.full_time.items;
    const mWeekDay    = mWeekNode?.days.get(day)?.items;

    // Week sub-structures matching this date
    const wNode = t.recurring.weeks.get(week);
    const wFull = wNode?.full_time.items;
    const wDay  = wNode?.days.get(day)?.items;

    return unionSets(
        t.specific_dates.get(isoDate)?.items,  // exact date
        t.recurring.days.get(day)?.items,       // every [day]
        wFull, wDay,                            // week [N] of any month
        mFullTime, mDayNode, mWeekFull, mWeekDay, // month [M] patterns
        t.recurring.full_time.items,            // always-on
    );
}

/**
 * Spatial radius query filtered to a specific calendar date.
 *
 * Returns item IDs that are BOTH within the search radius AND active on the
 * given date — combining specific_dates entries with all recurring patterns
 * that cover the date (day-of-week, week-of-month, month, full-time).
 *
 * This is the primary combined space-time query primitive for analytics and
 * gap detection (planned vs realized at a place on a date).
 *
 * Implementation note: temporal bins are propagated to all ancestor H3 cells
 * during indexing, so any node whose `items` set overlaps the spatial result
 * carries correct temporal data for its subtree. We collect temporal matches
 * from those overlapping nodes and intersect with the spatial set.
 */
export function queryHexOnDate<T>(
    index: HexIndex<T>,
    query: {
        h3_index?: string;
        latitude?: number;
        longitude?: number;
        radius_km?: number;
    },
    isoDate: string,
): Set<string> {
    const spatialIds = queryHexIndexRadius(index, query);
    if (spatialIds.size === 0) return new Set();

    // Collect temporal items from every node that overlaps the spatial result.
    const temporalIds = new Set<string>();
    for (const node of index.nodes.values()) {
        let overlaps = false;
        for (const id of node.items) {
            if (spatialIds.has(id)) { overlaps = true; break; }
        }
        if (overlaps) {
            for (const id of queryNodeOnCalendarDate(node, isoDate)) temporalIds.add(id);
        }
    }

    return new Set([...spatialIds].filter(id => temporalIds.has(id)));
}
