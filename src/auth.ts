import { google } from "googleapis";
import fs from "fs/promises";
import readline from "readline";

async function main() {
  const credentials = JSON.parse(await fs.readFile("credentials.json", "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"]
  });

  console.log("Authorize this app by visiting this URL:\n", authUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Enter the code from that page: ", async (code) => {
    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile("token.json", JSON.stringify(tokens));
    console.log("Token saved to token.json");
    rl.close();
  });
}

main();
