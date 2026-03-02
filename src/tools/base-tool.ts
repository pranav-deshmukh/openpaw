/**
 * BaseTool — abstract base class for all assistant tools.
 *
 * Extend this class to create a new tool:
 *   1. Set `name`, `description`, and `parameters` in the constructor
 *   2. Implement `execute(args)` with your tool logic
 *   3. Register the instance in the ToolRegistry
 *
 * The `toOpenAI()` method converts the tool to the format expected by OpenAI's
 * chat.completions API so you never have to build that object by hand.
 */

export interface ToolParameter {
    type: string;
    description?: string;
    enum?: string[];
}

export interface ToolParametersSchema {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
    [key: string]: unknown;
}

export abstract class BaseTool {
    /** Unique tool name used in function calls (snake_case). */
    abstract readonly name: string;

    /** One-line description shown to the LLM. */
    abstract readonly description: string;

    /** JSON Schema describing the tool's input parameters. */
    abstract readonly parameters: ToolParametersSchema;

    /**
     * Run the tool with the given arguments.
     * @returns A human-readable string result.
     */
    abstract execute(args: Record<string, unknown>): Promise<string>;

    /**
     * Convert this tool to the OpenAI function-calling format:
     * `{ type: "function", function: { name, description, parameters } }`
     */
    toOpenAI() {
        return {
            type: "function" as const,
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameters,
            },
        };
    }
}
