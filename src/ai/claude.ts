import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

export class OpenAIClient {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.systemPrompt = "";
  }

  async loadSkills() {
    try {
      const skillPath = path.join(
        process.cwd(),
        "src",
        "skills",
        "note-taking.md",
      );
      const skillContent = await fs.readFile(skillPath, "utf-8");

      this.systemPrompt = `You are a helpful AI assistant with note-taking capabilities.

${skillContent}

Follow the guidelines in the skill document above. Be concise, helpful, and always confirm actions.`;
    } catch (error) {
      console.warn("Could not load skills, using basic prompt");
      this.systemPrompt =
        "You are a helpful AI assistant with note-taking capabilities.";
    }
  }

  async chat(
    userMessage: string,
    tools: any[],
    conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [],
  ) {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
    });

    return response;
  }
}
