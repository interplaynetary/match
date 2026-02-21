/**
 * Unified Person Schema
 * 
 * Single source of truth for person data across matching, planning, and scheduling.
 * Replaces fragmented Contact, Individual, and PersonWithAvailability types.
 * 
 * Design: All fields optional except id. Supports both minimal (just id + skills)
 * and rich (full availability + location + planning) person data.
 */

import { z } from 'zod';
import { AvailabilityWindowSchema, type AvailabilityWindow } from './primitives/time';
import type { Contact } from '../ai/types';

// =============================================================================
// PERSON SCHEMA
// =============================================================================

/**
 * Person: Unified representation for matching, planning, and scheduling.
 * 
 * Field Groups:
 * 1. Core Identity - id, name
 * 2. Skills - for matching needs to capacities
 * 3. Availability - for scheduling and time constraints
 * 4. Location - for space-time matching
 * 5. Planning - for stockbook and capacity planning
 */
export const PersonSchema = z.object({
    // ===== Core Identity =====
    /** Unique identifier */
    id: z.string(),
    
    /** Human-readable name */
    name: z.string().optional(),
    
    // ===== Skills (for matching) =====
    /** Skills this person has (for matching needs to capacities) */
    skills: z.array(z.object({
        id: z.string(),
        level: z.number().optional(),
    })).default([]),
    
    // ===== Availability (for scheduling) =====
    /** When this person is available (structured time windows) */
    availability_window: AvailabilityWindowSchema.optional(),
    
    /** Maximum hours per day this person can work */
    max_hours_per_day: z.number().positive().optional(),
    
    /** Maximum hours per week this person can work */
    max_hours_per_week: z.number().positive().optional(),
    
    // ===== Location (for space-time matching) =====
    /** Where this person is located */
    location: z.object({
        city: z.string().optional(),
        country: z.string().optional(),
        h3_index: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
    }).optional(),
    
    // ===== Planning (for stockbook) =====
    /** Daily labor capacity by skill (System 1: recurring capacity) */
    labor_powers: z.array(z.object({
        skill_id: z.string(),
        hours_per_day: z.number().positive(),
    })).optional(),
    
    /** Long-term skill inventory (System 2: one-time capacity, remaining hours) */
    skills_inventory: z.record(z.string(), z.number().nonnegative()).optional(),
});

export type Person = z.infer<typeof PersonSchema>;

// =============================================================================
// CONVERSION UTILITIES
// =============================================================================

/**
 * Convert Contact (minimal) to Person.
 * Used for matching scenarios where only id + skills are known.
 */
export function contactToPerson(contact: Contact): Person {
    return {
        id: contact.id,
        skills: contact.skills || [],
    };
}

/**
 * Convert Individual (stockbook) to Person.
 * Preserves planning-related fields (labor_powers, skills_inventory).
 */
export function individualToPerson(individual: {
    id: string;
    name: string;
    laborPowers: Array<{ skill_id: string; hoursPerDay: number }>;
    skillsInventory: Record<string, number>;
}): Person {
    return {
        id: individual.id,
        name: individual.name,
        // Extract skills from laborPowers
        skills: individual.laborPowers.map(lp => ({ id: lp.skill_id })),
        // Convert laborPowers to labor_powers (snake_case)
        labor_powers: individual.laborPowers.map(lp => ({
            skill_id: lp.skill_id,
            hours_per_day: lp.hoursPerDay,
        })),
        skills_inventory: individual.skillsInventory,
    };
}

/**
 * Convert Person to Individual (stockbook).
 * For backward compatibility with existing stockbook code.
 */
export function personToIndividual(person: Person): {
    id: string;
    name: string;
    laborPowers: Array<{ skill_id: string; hoursPerDay: number }>;
    skillsInventory: Record<string, number>;
} {
    return {
        id: person.id,
        name: person.name || person.id,
        // Convert labor_powers to laborPowers (camelCase for backward compat)
        laborPowers: person.labor_powers?.map(lp => ({
            skill_id: lp.skill_id,
            hoursPerDay: lp.hours_per_day,
        })) || [],
        skillsInventory: person.skills_inventory || {},
    };
}

/**
 * Convert Person to Contact (minimal).
 * Extracts only id and skills.
 */
export function personToContact(person: Person): Contact {
    return {
        id: person.id,
        skills: person.skills || [],
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a person has a specific skill.
 */
export function hasSkill(person: Person, skillId: string): boolean {
    return person.skills.some(s => s.id === skillId);
}

/**
 * Check if a person has all of the specified skills.
 */
export function hasAllSkills(person: Person, skillIds: string[]): boolean {
    return skillIds.every(skillId => hasSkill(person, skillId));
}

/**
 * Check if a person has any of the specified skills.
 */
export function hasAnySkill(person: Person, skillIds: string[]): boolean {
    return skillIds.some(skillId => hasSkill(person, skillId));
}

/**
 * Get all skill IDs for a person.
 */
export function getSkillIds(person: Person): string[] {
    return person.skills.map(s => s.id);
}

/**
 * Enrich a minimal person with additional data.
 * Useful for progressive data loading.
 */
export function enrichPerson(
    base: Person,
    enrichment: Partial<Omit<Person, 'id'>>
): Person {
    return {
        ...base,
        ...enrichment,
        // Merge skills (don't replace)
        skills: enrichment.skills || base.skills,
    };
}
