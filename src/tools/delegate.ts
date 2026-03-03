/**
 * DelegateToAgentTool — allows one agent to delegate tasks to another agent.
 *
 * When `awaitResult` is true, the target agent's `chat()` method is called
 * directly and the response is returned as the tool result (synchronous).
 * When false, the task is acknowledged immediately (fire-and-forget via queue).
 */

import { BaseTool, ToolParametersSchema } from "./base-tool";
import type { AgentRegistry } from "../agents/agent-registry";

export class DelegateToAgentTool extends BaseTool {
    readonly name = "delegate_to_agent";

    readonly description =
        "Delegate a task to another agent. Use this to hand off specialized work " +
        "(e.g., web research, email handling) to an agent better suited for the job. " +
        "Set awaitResult to true if you need the response to continue your work.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            agentId: {
                type: "string",
                description: "The ID of the agent to delegate to (e.g. 'researcher', 'email-manager')",
            },
            task: {
                type: "string",
                description: "A clear description of the task for the target agent",
            },
            awaitResult: {
                type: "string",
                description: "If 'true', wait for the agent's response before continuing. If 'false', fire and forget.",
                enum: ["true", "false"],
            },
        },
        required: ["agentId", "task"],
    };

    private agentRegistry: AgentRegistry;

    constructor(agentRegistry: AgentRegistry) {
        super();
        this.agentRegistry = agentRegistry;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const agentId = args.agentId as string;
        const task = args.task as string;
        const awaitResult = args.awaitResult === "true" || args.awaitResult === true;

        const targetAgent = this.agentRegistry.get(agentId);
        if (!targetAgent) {
            const available = this.agentRegistry.list().join(", ");
            return `❌ Agent "${agentId}" not found. Available agents: ${available}`;
        }

        if (awaitResult) {
            // Synchronous delegation — call the agent directly and return its response
            console.log(`\n🔀 Delegating to agent "${agentId}" (awaiting result)...`);
            try {
                const result = await targetAgent.chat(task, true); // isolated = true for delegated tasks
                return `✅ Agent "${agentId}" responded:\n\n${result}`;
            } catch (err: any) {
                return `❌ Agent "${agentId}" failed: ${err.message}`;
            }
        } else {
            // Fire-and-forget — acknowledge immediately, agent processes asynchronously
            console.log(`\n🔀 Delegating to agent "${agentId}" (fire-and-forget)...`);

            // Run in background without awaiting
            targetAgent.chat(task, true).catch((err: any) => {
                console.error(`❌ Background delegation to "${agentId}" failed:`, err.message);
            });

            return `✅ Task delegated to agent "${agentId}". It will be processed asynchronously.`;
        }
    }
}
