import { createSseParser, toActivity, type SessionActivity } from '../../core/sync/sessionEvents';
import type { ConnectionManager } from '../access/connectService';

export type EventStreamHandlers = Readonly<{
  onChunk: (text: string) => void;
  /** The stream ended. `status` is the HTTP status when known (0 for a network failure). */
  onClose: (status: number) => void;
}>;
export type EventStreamFactory = (url: string, headers: Readonly<Record<string, string>>, handlers: EventStreamHandlers) => { close: () => void };

type Listener = (activity: SessionActivity) => void;

type Entry = {
  listeners: Set<Listener>;
  stream: { close: () => void } | null;
  retry: ReturnType<typeof setTimeout> | null;
  failures: number;
};

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * SS-05: one `sessions/events` stream per Bot, shared by every screen that
 * listens to that Bot and closed when the last one leaves. Reconnects with
 * backoff; a 404 (server without the route) stops retrying for the process.
 * Frames only signal that something changed; listeners re-read over REST.
 */
export class SessionEventsHub {
  private readonly bots = new Map<string, Entry>();
  private readonly unsupported = new Set<string>();

  constructor(
    private readonly access: ConnectionManager,
    private readonly factory: EventStreamFactory,
  ) {}

  subscribe(botId: string, listener: Listener): () => void {
    let entry = this.bots.get(botId);
    if (!entry) {
      entry = { listeners: new Set(), stream: null, retry: null, failures: 0 };
      this.bots.set(botId, entry);
      void this.open(botId, entry);
    }
    entry.listeners.add(listener);
    const held = entry;
    return () => {
      held.listeners.delete(listener);
      if (held.listeners.size === 0) this.close(botId, held);
    };
  }

  private async open(botId: string, entry: Entry) {
    if (this.bots.get(botId) !== entry || this.unsupported.has(botId)) return;
    let token: string;
    let deployment: string;
    try {
      const session = await this.access.ensureFresh();
      token = session.credential.accessToken;
      deployment = session.connection.deployment;
    } catch {
      return; // Signed out or must sign in again; subscribers are torn down by the app.
    }
    if (this.bots.get(botId) !== entry) return;
    const parser = createSseParser((data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      const activity = toActivity(frame);
      if (!activity) return;
      entry.failures = 0;
      for (const l of entry.listeners) l(activity);
    });
    entry.stream = this.factory(
      `${deployment.replace(/\/+$/, '')}/bots/${encodeURIComponent(botId)}/sessions/events`,
      { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      {
        onChunk: (text) => parser.feed(text),
        onClose: (status) => {
          entry.stream = null;
          if (this.bots.get(botId) !== entry) return;
          if (status === 404) {
            this.unsupported.add(botId);
            return;
          }
          entry.failures += 1;
          const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(entry.failures - 1, 5));
          entry.retry = setTimeout(() => {
            entry.retry = null;
            void this.open(botId, entry);
          }, wait);
        },
      },
    );
  }

  private close(botId: string, entry: Entry) {
    if (entry.retry) clearTimeout(entry.retry);
    entry.retry = null;
    entry.stream?.close();
    entry.stream = null;
    if (this.bots.get(botId) === entry) this.bots.delete(botId);
  }

  /** Sign-out / Team switch: streams belong to the previous identity. */
  closeAll() {
    for (const [botId, entry] of [...this.bots]) {
      entry.listeners.clear();
      this.close(botId, entry);
    }
  }

  /** App returned to the foreground: reconnect streams waiting in backoff now. */
  wake() {
    for (const [botId, entry] of this.bots) {
      if (entry.retry) {
        clearTimeout(entry.retry);
        entry.retry = null;
        void this.open(botId, entry);
      }
    }
  }
}
