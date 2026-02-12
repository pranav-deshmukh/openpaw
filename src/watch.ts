import { google } from "googleapis";
import fs from "fs/promises";

async function main() {
  const credentials = JSON.parse(await fs.readFile("credentials.json", "utf-8"));
  const token = JSON.parse(await fs.readFile("token.json", "utf-8"));

  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const topicName = "projects/xeno-oauth/topics/gmail-notifications";

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"]
    }
  });

  console.log("Watch response:", res.data);
}

main();
