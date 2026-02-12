import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";

const CREDENTIALS_PATH = path.join(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH!);
const TOKEN_PATH = path.join(process.cwd(), process.env.GOOGLE_TOKEN_PATH!);

async function getClient() {
  const credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH, "utf-8"));
  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));

  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);

  return google.gmail({ version: "v1", auth: oAuth2Client });
}

let lastHistoryId: string | null = null;

export async function getLatestEmailSnippet(historyId: string) {
  const gmail = await getClient();

  // First webhook just sets baseline
  if (!lastHistoryId) {
    lastHistoryId = historyId;
    return null;
  }

  const res = await gmail.users.history.list({
    userId: "me",
    startHistoryId: lastHistoryId,
    historyTypes: ["messageAdded"]
  });

  lastHistoryId = historyId;

  for (const record of res.data.history || []) {
    for (const m of record.messagesAdded || []) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.message!.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From"]
      });

      const headers = msg.data.payload?.headers || [];
      return {
        subject: headers.find(h => h.name === "Subject")?.value || "(No subject)",
        from: headers.find(h => h.name === "From")?.value || "Unknown"
      };
    }
  }

  return null;
}

