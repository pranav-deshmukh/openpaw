import readline from "readline";
import crypto from "crypto";
import { inboundQueue, outboundQueue } from "../queue/message-queue";
import { channelRegistry } from "../channel/channel-registry";

/**
 * CLI — the command-line interface for interacting with the agent.
 *
 * Responsibilities:
 *   - Display welcome banner and agent status on startup
 *   - Handle user input via readline
 *   - Route non-command input to the inbound message queue
 *   - Provide built-in commands (/help, /status, /quit, /clear)
 *   - Support externally registered commands (e.g. /memory, /agents from index.ts)
 *   - Commands can accept arguments (e.g. /memory personal)
 */

type CommandHandler = (args?: string) => Promise<void> | void;

interface CommandEntry {
    handler: CommandHandler;
    description: string;
}

export class CLI {
    private rl: readline.Interface;
    private commands = new Map<string, CommandEntry>();
    private onCloseHandler?: () => Promise<void> | void;
    private startTime = Date.now();

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: "\n> ",
        });

        this.registerBuiltInCommands();
    }

    /**
     * Register built-in commands that ship with the CLI.
     */
    private registerBuiltInCommands(): void {
        this.registerCommand("/help", "Show all available commands", () => {
            console.log("\n📖 Available Commands:");
            console.log("━".repeat(40));

            for (const [name, entry] of this.commands) {
                console.log(`  ${name.padEnd(15)} ${entry.description}`);
            }

            console.log(`  ${"(text)".padEnd(15)} Send a message to the agent`);
            console.log("━".repeat(40));
        });

        this.registerCommand("/status", "Show agent status and queue info", () => {
            const uptimeMs = Date.now() - this.startTime;
            const uptimeMin = Math.floor(uptimeMs / 60000);
            const uptimeSec = Math.floor((uptimeMs % 60000) / 1000);

            console.log("\n📊 Agent Status:");
            console.log("━".repeat(40));
            console.log(`  Uptime:           ${uptimeMin}m ${uptimeSec}s`);
            console.log(`  Inbound queue:    ${inboundQueue.length} pending`);
            console.log(`  Outbound queue:   ${outboundQueue.length} pending`);

            // List registered channels
            const channels: string[] = [];
            for (const name of channelRegistry.list()) {
                channels.push(name);
            }
            console.log(`  Channels:         ${channels.length > 0 ? channels.join(", ") : "none"}`);
            console.log("━".repeat(40));
        });

        this.registerCommand("/clear", "Clear the terminal screen", () => {
            console.clear();
            console.log("🧹 Screen cleared.\n");
        });

        this.registerCommand("/quit", "Shut down the agent", () => {
            this.rl.close();
        });

        this.registerCommand("/exit", "Shut down the agent", () => {
            this.rl.close();
        });
    }

    /**
     * Register a custom CLI command.
     *
     * @param command   The command trigger (e.g. "/memory"). Include the leading slash.
     * @param description   A short description shown in /help.
     * @param handler   The function to execute when the command is triggered.
     *                  Receives optional arguments string (everything after the command name).
     */
    registerCommand(command: string, description: string, handler: CommandHandler): void {
        this.commands.set(command.toLowerCase(), { handler, description });
    }

    /**
     * Register a handler to run when the CLI is closed (e.g. flush memory).
     */
    onClose(handler: () => Promise<void> | void): void {
        this.onCloseHandler = handler;
    }

    /**
     * Display the welcome banner with startup info.
     */
    private showBanner(): void {
        console.log("");
        console.log("╔══════════════════════════════════════════╗");
        console.log("║       🐾 OpenPaw Multi-Agent System     ║");
        console.log("╠══════════════════════════════════════════╣");
        console.log("║  Type a message to chat with the agent   ║");
        console.log("║  Type /help to see available commands    ║");
        console.log("╚══════════════════════════════════════════╝");
        console.log("");
    }

    /**
     * Start the CLI — displays the banner and begins listening for input.
     * Each line is either handled as a command or enqueued
     * to the inbound queue for agent processing.
     */
    start(): void {
        this.showBanner();
        this.rl.prompt();

        this.rl.on("line", async (input) => {
            const userInput = input.trim();

            if (!userInput) return this.rl.prompt();

            // Check registered commands (starts with /)
            if (userInput.startsWith("/")) {
                // Parse command and arguments
                const spaceIdx = userInput.indexOf(" ");
                const cmdName = spaceIdx === -1
                    ? userInput.toLowerCase()
                    : userInput.substring(0, spaceIdx).toLowerCase();
                const cmdArgs = spaceIdx === -1
                    ? undefined
                    : userInput.substring(spaceIdx + 1).trim() || undefined;

                const cmd = this.commands.get(cmdName);
                if (cmd) {
                    await cmd.handler(cmdArgs);
                } else {
                    console.log(`\n❌ Unknown command: ${cmdName}. Type /help to see available commands.`);
                }
                return this.rl.prompt();
            }

            // Regular text → enqueue for agent processing
            inboundQueue.enqueue({
                id: crypto.randomUUID(),
                source: "cli",
                chatId: "cli",
                text: userInput,
                timestamp: Date.now(),
            });

            this.rl.prompt();
        });

        this.rl.on("close", async () => {
            if (this.onCloseHandler) {
                await this.onCloseHandler();
            }
            process.exit(0);
        });
    }
}
