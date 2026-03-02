import { BaseTool } from "./base-tool";

/**
 * ToolRegistry — central hub for registering and executing tools.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.register(new WebSearchTool(), new WebFetchTool());
 *
 *   // Pass to OpenAI
 *   const tools = registry.toOpenAITools();
 *
 *   // Execute a tool call
 *   const result = await registry.execute("web_search", { query: "hello" });
 */
export class ToolRegistry {
    private tools = new Map<string, BaseTool>();

    /** Register one or more tool instances. */
    register(...tools: BaseTool[]): void {
        for (const tool of tools) {
            if (this.tools.has(tool.name)) {
                throw new Error(
                    `Tool "${tool.name}" is already registered. Names must be unique.`
                );
            }
            this.tools.set(tool.name, tool);
        }
    }

    /** Check whether a tool name is registered. */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /** Execute a registered tool by name. Throws if the tool is unknown. */
    async execute(name: string, args: Record<string, unknown>): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }
        return tool.execute(args);
    }

    /** Return all registered tools in OpenAI function-calling format. */
    toOpenAITools() {
        return Array.from(this.tools.values()).map((t) => t.toOpenAI());
    }

    /** Number of registered tools. */
    get size(): number {
        return this.tools.size;
    }
}
