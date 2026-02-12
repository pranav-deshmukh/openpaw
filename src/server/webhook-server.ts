import express from "express";

export class WebhookServer {
  private app = express();
  private handlers = new Map<string, (data: any) => Promise<void>>();

  constructor(private port = 3000) {
    this.app.use(express.json());

    this.app.post("/webhook/gmail", async (req, res) => {
      try {
        const pubsubMessage = req.body.message;

        if (!pubsubMessage?.data) {
          console.warn("No Pub/Sub message data");
          return res.sendStatus(400);
        }

        const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
        const data = JSON.parse(decoded);

        console.log("Gmail webhook received:", data);

        await this.handlers.get("gmail")?.(data);

        res.sendStatus(200);
      } catch (err) {
        console.error("Webhook error:", err);
        res.sendStatus(500);
      }
    });
  }

  onWebhook(type: string, handler: (data: any) => Promise<void>) {
    this.handlers.set(type, handler);
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`Webhook server running on http://localhost:${this.port}`);
    });
  }
}
