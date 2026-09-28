/**
 * Runtime WebSocket (contracts/runtime-ws.md): one connection per Bot,
 * several session subscriptions. Reconnects with backoff (1 s × 1.5, max
 * 10 s) and re-subscribes every session on each open; nothing here resumes
 * from a cursor, a fresh snapshot always follows a subscribe.
 */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/** Opens a socket that authenticates with an `Authorization: Bearer` header. */
export type SocketFactory = (url: string, token: string) => SocketLike;

export type ServerEvent = Readonly<{ type: string; session_id?: string; invocation_id?: string; [key: string]: unknown }>;

export type SocketStatus = 'connecting' | 'open' | 'closed';

type Timer = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

const OPEN = 1;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;

export function runtimeSocketUrl(deployment: string, botId: string): string {
  const url = new URL(`${deployment.replace(/\/+$/, '')}/bots/${encodeURIComponent(botId)}/web/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class RuntimeSocket {
  private socket: SocketLike | null = null;
  private readonly sessions = new Set<string>();
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private status: SocketStatus = 'closed';

  constructor(
    private readonly options: {
      url: string;
      getToken: () => Promise<string>;
      factory: SocketFactory;
      onEvent: (event: ServerEvent) => void;
      onStatus?: (status: SocketStatus) => void;
      timer?: Timer;
    },
  ) {}

  private get timer() {
    return this.options.timer ?? realTimer;
  }

  get currentStatus() {
    return this.status;
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer !== null) this.timer.clear(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.setStatus('closed');
  }

  /** Reconnect now (e.g. app returned to the foreground). */
  reconnectNow() {
    if (this.stopped) return;
    if (this.socket && this.socket.readyState === OPEN) return;
    if (this.reconnectTimer !== null) this.timer.clear(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    void this.connect();
  }

  subscribe(sessionId: string) {
    this.sessions.add(sessionId);
    this.send({ type: 'runtime_subscribe', session_id: sessionId });
  }

  unsubscribe(sessionId: string) {
    this.sessions.delete(sessionId);
    this.send({ type: 'runtime_unsubscribe', session_id: sessionId });
  }

  /** False when not connected: the caller keeps the request and retries on open. */
  send(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private async connect() {
    if (this.stopped) return;
    this.setStatus('connecting');
    let token: string;
    try {
      token = await this.options.getToken();
    } catch {
      // Signed out or needs sign-in: stay closed until started again.
      this.stopped = true;
      this.setStatus('closed');
      return;
    }
    if (this.stopped) return;
    const socket = this.options.factory(this.options.url, token);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus('open');
      for (const sessionId of this.sessions) socket.send(JSON.stringify({ type: 'runtime_subscribe', session_id: sessionId }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
        this.options.onEvent(parsed as ServerEvent);
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 1.5 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = this.timer.set(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
