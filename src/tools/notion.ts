import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DB_ID = process.env.NOTION_DATABASE_ID!;

/* =====================================
   Tool definitions
===================================== */

export const notionTools = [
  {
    name: "notion_add_item",
    description: "Save a note, task, idea or email to Notion memory database.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: {
          type: "string",
          enum: ["note", "task", "idea", "email"],
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        source: {
          type: "string",
          enum: ["chat", "email", "system"],
        },
      },
      required: ["title", "type"],
    },
  },
];

/* =====================================
   Execute Notion tools
===================================== */

export async function executeNotionTool(name: string, args: any) {
  switch (name) {
    case "notion_add_item":
      await notion.pages.create({
        parent: { database_id: DB_ID },
        properties: {
          Title: {
            title: [{ text: { content: args.title } }],
          },
          Type: {
            select: { name: args.type },
          },
          Priority: {
            select: { name: args.priority || "medium" },
          },
          Source: {
            select: { name: args.source || "chat" },
          },
          Status: {
            select: { name: "open" },
          },
        },
      });

      return "Saved to Notion successfully.";

    default:
      throw new Error(`Unknown Notion tool: ${name}`);
  }
}
