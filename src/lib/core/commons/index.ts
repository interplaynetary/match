/**
 * plan — Communal resource planning and matching system
 *
 * Layer hierarchy (low → high):
 *   primitives → agents → matching + effects → coordination → planning
 *
 * Import from subfolders for tree-shaking, or from here for convenience.
 */

// ── Primitives ───────────────────────────────────────────────────────────────
export * from './primitives';

// ── Agents & Resources ───────────────────────────────────────────────────────
export * from './indexes';

// ── Matching & Process ───────────────────────────────────────────────────────
export * from './matching';

// ── Effects ──────────────────────────────────────────────────────────────────
export * from './effects';

// ── Coordination ─────────────────────────────────────────────────────────────
export * from './coordination';

// ── Planning ─────────────────────────────────────────────────────────────────
export * from './planning';
