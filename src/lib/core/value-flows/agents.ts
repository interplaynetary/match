/**
 * AgentStore — Stores Agents, AgentRelationshipRoles, and AgentRelationships.
 *
 * VF spec: agents.md, model-text.md §Agent, §AgentRelationship, §AgentRelationshipRole.
 *
 * Three agent subtypes are supported via Agent.type:
 *   - 'Person' — individual human
 *   - 'Organization' — formal or informal group
 *   - 'EcologicalAgent' — non-human beings, ecosystems (ecological accounting)
 *
 * AgentRelationships define directed roles between agents (GAP-B).
 */

import { nanoid } from 'nanoid';
import type {
    Agent,
    AgentRelationshipRole,
    AgentRelationship,
} from './schemas';

export class AgentStore {
    private agentsMap = new Map<string, Agent>();
    private roles = new Map<string, AgentRelationshipRole>();
    private relationships = new Map<string, AgentRelationship>();

    constructor(private generateId: () => string = () => nanoid()) {}

    // =========================================================================
    // AGENTS
    // =========================================================================

    addAgent(agent: Omit<Agent, 'id'> & { id?: string }): Agent {
        const a: Agent = { id: agent.id ?? this.generateId(), ...agent } as Agent;
        this.agentsMap.set(a.id, a);
        return a;
    }

    getAgent(id: string): Agent | undefined { return this.agentsMap.get(id); }
    allAgents(): Agent[] { return Array.from(this.agentsMap.values()); }

    /** Filter agents by subtype  */
    people(): Agent[] {
        return this.allAgents().filter(a => a.type === 'Person');
    }

    organizations(): Agent[] {
        return this.allAgents().filter(a => a.type === 'Organization');
    }

    ecologicalAgents(): Agent[] {
        return this.allAgents().filter(a => a.type === 'EcologicalAgent');
    }

    // =========================================================================
    // AGENT RELATIONSHIP ROLES (inverses.md §AgentRelationshipRole)
    // =========================================================================

    /**
     * Add an AgentRelationshipRole — a named role such as "member", "steward", "employer".
     */
    addRole(role: Omit<AgentRelationshipRole, 'id'> & { id?: string }): AgentRelationshipRole {
        const r: AgentRelationshipRole = { id: role.id ?? this.generateId(), ...role };
        this.roles.set(r.id, r);
        return r;
    }

    getRole(id: string): AgentRelationshipRole | undefined { return this.roles.get(id); }
    allRoles(): AgentRelationshipRole[] { return Array.from(this.roles.values()); }

    // =========================================================================
    // AGENT RELATIONSHIPS (inverses.md §AgentRelationship)
    // =========================================================================

    /**
     * Add an AgentRelationship — "subject plays role toward object, optionally in scope".
     * E.g. "Michael (subject) is a member (role) of Enspiral (object)".
     */
    addRelationship(rel: Omit<AgentRelationship, 'id'> & { id?: string }): AgentRelationship {
        const r: AgentRelationship = { id: rel.id ?? this.generateId(), ...rel };
        this.relationships.set(r.id, r);
        return r;
    }

    getRelationship(id: string): AgentRelationship | undefined { return this.relationships.get(id); }
    allRelationships(): AgentRelationship[] { return Array.from(this.relationships.values()); }

    /** All relationships where the given agent is the subject. */
    relationshipsAsSubject(agentId: string): AgentRelationship[] {
        return this.allRelationships().filter(r => r.subject === agentId);
    }

    /** All relationships where the given agent is the object. */
    relationshipsAsObject(agentId: string): AgentRelationship[] {
        return this.allRelationships().filter(r => r.object === agentId);
    }

    /** All relationships using a specific role. */
    relationshipsForRole(roleId: string): AgentRelationship[] {
        return this.allRelationships().filter(r => r.relationship === roleId);
    }

    /** All relationships within a given scope agent. */
    relationshipsInScope(scopeAgentId: string): AgentRelationship[] {
        return this.allRelationships().filter(r => r.inScopeOf === scopeAgentId);
    }

    // =========================================================================
    // MANAGEMENT
    // =========================================================================

    clear(): void {
        this.agentsMap.clear();
        this.roles.clear();
        this.relationships.clear();
    }
}
