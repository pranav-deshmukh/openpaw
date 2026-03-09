/**
 * AgentRegistry — central registry for all agent instances.
 *
 * Similar to ToolRegistry and ChannelRegistry: register agents by ID,
 * look them up by ID, list all registered agents.
 */

import type { Agent } from "./agent";

export class AgentRegistry {
    private agents = new Map<string, Agent>();

    /** Register an agent instance. Throws if the ID is already taken. */
    register(agent: Agent): void {
        const id = agent.config.id;
        if (this.agents.has(id)) {
            throw new Error(`Agent "${id}" is already registered.`);
        }
        this.agents.set(id, agent);
    }

    /** Look up an agent by ID. Returns `undefined` if not found. */
    get(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }

    /** Check whether an agent ID is registered. */
    has(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    /** Return all registered agent IDs. */
    list(): string[] {
        return Array.from(this.agents.keys());
    }

    /** Return all registered agent instances. */
    getAll(): Agent[] {
        return Array.from(this.agents.values());
    }
}
