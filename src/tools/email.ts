import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";

const DRAFT_FILE = path.join(process.cwd(), "data", "email-draft.json");
const CREDENTIALS_PATH = path.join(
  process.cwd(),
  process.env.GOOGLE_CREDENTIALS_PATH!
);
const TOKEN_PATH = path.join(
  process.cwd(),
  process.env.GOOGLE_TOKEN_PATH!
);

/* =========================
   TOOL DEFINITIONS
========================= */

export const emailTools = [
  {
    name: "create_email_draft",
    description: "Create and store an email draft. Does NOT send.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "show_email_draft",
    description: "Show current pending email draft.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "send_email",
    description:
      "Send the currently stored draft ONLY after explicit user approval.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

/* =========================
   DRAFT STORAGE
========================= */

async function ensureDataDir() {
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
}

export async function createEmailDraft(
  to: string,
  subject: string,
  body: string
) {
  await ensureDataDir();

  const draft = { to, subject, body };
  await fs.writeFile(DRAFT_FILE, JSON.stringify(draft, null, 2));

  return `Draft created:

To: ${to}
Subject: ${subject}

${body}

Ask the user for approval before sending.`;
}

export async function showEmailDraft() {
  try {
    const draft = JSON.parse(await fs.readFile(DRAFT_FILE, "utf-8"));

    return `📧 Current Draft

To: ${draft.to}
Subject: ${draft.subject}

${draft.body}`;
  } catch {
    return "No draft exists.";
  }
}

/* =========================
   GMAIL SEND
========================= */

async function getGmailClient() {
  const credentials = JSON.parse(
    await fs.readFile(CREDENTIALS_PATH, "utf-8")
  );
  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));

  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  auth.setCredentials(token);

  return google.gmail({ version: "v1", auth });
}

export async function sendEmailFromDraft() {
  const draft = JSON.parse(await fs.readFile(DRAFT_FILE, "utf-8"));

  const gmail = await getGmailClient();

  const message = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    "",
    draft.body,
  ].join("\n");

  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
    },
  });

  await fs.unlink(DRAFT_FILE);

  return `✅ Email sent to ${draft.to}`;
}

/* =========================
   TOOL EXECUTOR
========================= */

export async function executeEmailTool(name: string, args: any) {
  switch (name) {
    case "create_email_draft":
      return createEmailDraft(args.to, args.subject, args.body);

    case "show_email_draft":
      return showEmailDraft();

    case "send_email":
      return sendEmailFromDraft();

    default:
      throw new Error(`Unknown email tool: ${name}`);
  }
}
