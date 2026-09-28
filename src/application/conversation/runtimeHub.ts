import { runtimeSocketUrl, RuntimeSocket, type ServerEvent, type SocketFactory, type SocketStatus } from '../../data/remote/runtimeSocket';
import type { ConnectionManager } from '../access/connectService';

export type HubListener = Readonly<{
  sessionId: string;
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: SocketStatus) => void;
}>;

type Entry = { socket: RuntimeSocket; listeners: Set<HubListener> };

/**
 * One runtime socket per Bot, shared by every open session of that Bot and
 * closed when the last one leaves. Events are routed by `session_id`; frames
 * without one (connection-level `error`) go to every listener.
 */
export class RuntimeHub {
  private readonly bots = new Map<string, Entry>();

  constructor(
    private readonly access: ConnectionManager,
    private readonly factory: SocketFactory,
  ) {}

  attach(botId: string, listener: HubListener): { socket: RuntimeSocket; detach: () => void } {
    let entry = this.bots.get(botId);
    if (!entry) {
      const state = this.access.state;
      if (state.kind !== 'signed_in') throw new Error('Not signed in');
      const listeners = new Set<HubListener>();
      const socket = new RuntimeSocket({
        url: runtimeSocketUrl(state.session.connection.deployment, botId),
        getToken: async () => (await this.access.ensureFresh()).credential.accessToken,
        factory: this.factory,
        onEvent: (event) => {
          for (const l of listeners) if (!event.session_id || event.session_id === l.sessionId) l.onEvent(event);
        },
        onStatus: (status) => {
          for (const l of listeners) l.onStatus(status);
        },
      });
      entry = { socket, listeners };
      this.bots.set(botId, entry);
      socket.start();
    }
    entry.listeners.add(listener);
    entry.socket.subscribe(listener.sessionId);
    const current = entry;
    return {
      socket: current.socket,
      detach: () => {
        current.listeners.delete(listener);
        if (![...current.listeners].some((l) => l.sessionId === listener.sessionId)) current.socket.unsubscribe(listener.sessionId);
        if (current.listeners.size === 0) {
          current.socket.stop();
          this.bots.delete(botId);
        }
      },
    };
  }

  /** App returned to the foreground: reconnect closed sockets immediately. */
  wake() {
    for (const { socket } of this.bots.values()) socket.reconnectNow();
  }

  /** Sign-out / account switch. */
  closeAll() {
    for (const { socket } of this.bots.values()) socket.stop();
    this.bots.clear();
  }
}
