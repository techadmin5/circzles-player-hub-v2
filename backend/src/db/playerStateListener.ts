import pg from "pg";
import { PLAYER_STATE_CHANNEL, PlayerStateEvents } from "../domain/playerStateEvents.js";

export class PlayerStateListener {
  private stopped = false;
  private client?: pg.Client;
  private retry?: ReturnType<typeof setTimeout>;
  private retryMs = 1000;

  constructor(private url: string, private events: PlayerStateEvents, private warn: () => void,
    private createClient = () => new pg.Client({ connectionString: this.url, connectionTimeoutMillis: 10_000, keepAlive: true })) {}

  async start() {
    if (this.stopped) return;
    const client = this.createClient();
    this.client = client;
    let failed = false;
    const disconnected = () => {
      if (failed || this.client !== client) return;
      failed = true;
      this.events.setReady(false);
      void client.end().catch(() => undefined);
      if (this.stopped) return;
      this.warn(); // Never log connection URLs or notification payloads.
      this.retry = setTimeout(() => { void this.start(); }, this.retryMs);
      this.retry.unref();
      this.retryMs = Math.min(30_000, this.retryMs * 2);
    };
    client.on("error", disconnected);
    client.on("end", disconnected);
    client.on("notification", (message) => {
      if (!failed && this.client === client && message.channel === PLAYER_STATE_CHANNEL && message.payload) this.events.receive(message.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${PLAYER_STATE_CHANNEL}`);
      if (failed || this.stopped) { await client.end().catch(() => undefined); return; }
      this.retryMs = 1000;
      this.events.setReady(true);
    } catch { disconnected(); }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.events.setReady(false);
    await this.client?.end().catch(() => undefined);
  }
}
