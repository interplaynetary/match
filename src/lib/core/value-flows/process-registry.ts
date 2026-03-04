/**
 * ProcessRegistry — unified Process store shared between planning
 * and observation layers.
 *
 * In VF, a Process is the SAME instance whether planned or observed.
 * If you plan a "Bake bread" process and then observe events against it,
 * it remains the same Process.
 *
 * This registry is the single source of truth for all Processes.
 * Both PlanStore and Observer reference it instead of maintaining
 * their own separate Process maps.
 */

import { nanoid } from 'nanoid';
import type { Process } from './schemas';

export class ProcessRegistry {
    private processes = new Map<string, Process>();

    constructor(private generateId: () => string = () => nanoid()) {}

    /**
     * Add or update a process.
     */
    register(process: Omit<Process, 'id'> & { id?: string }): Process {
        const p: Process = { id: process.id ?? this.generateId(), ...process };
        this.processes.set(p.id, p);
        return p;
    }

    /**
     * Get a process by ID.
     */
    get(id: string): Process | undefined {
        return this.processes.get(id);
    }

    /**
     * Check if a process exists.
     */
    has(id: string): boolean {
        return this.processes.has(id);
    }

    /**
     * Get all processes.
     */
    all(): Process[] {
        return Array.from(this.processes.values());
    }

    /**
     * Get processes belonging to a plan.
     */
    forPlan(planId: string): Process[] {
        return this.all().filter(p => p.plannedWithin === planId);
    }

    /**
     * Get processes that are finished.
     */
    finished(): Process[] {
        return this.all().filter(p => p.finished);
    }

    /**
     * Get processes that are not yet finished.
     */
    active(): Process[] {
        return this.all().filter(p => !p.finished);
    }

    /**
     * Mark a process as finished. Called by the observer when all
     * expected outputs have been recorded.
     */
    markFinished(id: string): void {
        const p = this.processes.get(id);
        if (p) p.finished = true;
    }

    /**
     * Get processes based on a specific ProcessSpecification.
     */
    forSpec(specId: string): Process[] {
        return this.all().filter(p => p.basedOn === specId);
    }

    /**
     * Remove a process by ID. Used by backtracking / surgical retraction.
     * Silently ignored if the ID is not found.
     */
    unregister(id: string): void {
        this.processes.delete(id);
    }

    clear(): void {
        this.processes.clear();
    }
}
