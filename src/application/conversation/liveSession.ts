import { isRunActive, type RunView } from '../../core/conversation/types';
import { observeRunAccepted } from '../../core/identity/capabilities';
import type { ScopeKey } from '../../core/identity/scope';
import { lookupInvocation, type LookupRequest } from '../../core/operations/invocationLookup';
import {
  createOutboxEntry,
  markSent,
  onAckLost,
  onRejected,
  onRunAccepted,
  onRunObserved,
  recover,
  type OutboxEntry,
  type Recovery,
} from '../../core/operations/outbox';
import { afterLookup, planRecovery } from '../../core/operations/recovery';
import { createSessionStream, receiveRuntimeEvent, awaitSnapshot, type RuntimeEvent, type SessionStream } from '../../core/sync/runtimeStream';
import { loadRuntimeCheckpoint, saveRuntimeCheckpoint, type SessionKey } from '../../data/local/conversationStore';
import { loadPendingOutbox, saveOutboxEntry } from '../../data/local/outboxStore';
import type { SqlDatabase } from '../../data/local/sql';
import type { FetchFn } from '../../data/remote/memohClient';
import type { RuntimeSocket, ServerEvent, SocketStatus } from '../../data/remote/runtimeSocket';
import type { ConnectionManager } from '../access/connectService';
import type { ConversationSync } from './conversationSync';
import type { RuntimeHub } from './runtimeHub';

export type LiveSnapshot = Readonly<{
  /** Live projection of the current run (null when idle or not yet known). */
  run: RunView | null;
  /** A fresh server snapshot has been adopted since the last (re)subscribe. */
  live: boolean;
  socket: SocketStatus;
  /** This session's unfinished sends, oldest first. */
  pending: readonly OutboxEntry[];
  /** Failed sends still shown so the user can resend or discard. */
  failed: readonly OutboxEntry[];
}>;

export type LiveDeps = Readonly<{
  db: SqlDatabase;
  access: ConnectionManager;
  sync: ConversationSync;
  hub: RuntimeHub;
  fetchFn: FetchFn;
  now: () => number;
  newId: () => string;
  /** Retry cadence for queued sends and recovery steps. */
  tickMs?: number;
}>;

const RUNTIME_TYPES = new Set(['runtime_snapshot', 'runtime_delta', 'runtime_dropped']);
const SETTLE_RETRY_MS = 5_000;

/**
 * Everything a chat screen needs for one session: live projection, sending
 * through the durable Outbox, recovery of lost acks, and stop.
 *
 * Instances come from LiveSessionPool, shared by the chat screen and the
 * OutboxPump, which keeps sessions with unsent messages running while their
 * screen is closed (for as long as the app process is alive).
 */
export class LiveSession {
  private stream: SessionStream;
  private socketStatus: SocketStatus = 'closed';
  private entries: OutboxEntry[] = [];
  private failed: OutboxEntry[] = [];
  private attachment: { socket: RuntimeSocket; detach: () => void } | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: LiveSnapshot;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private working = false;
  private checkpointDirty = false;
  private lastTerminalRun: string | null = null;
  private lastSettleAttempt = Number.NEGATIVE_INFINITY;
  /** start() has run and stop() has not. */
  started = false;
  /** The Outbox of this session has been read at least once. */
  loaded = false;

  constructor(
    private readonly deps: LiveDeps,
    readonly botId: string,
    readonly sessionId: string,
  ) {
    this.stream = createSessionStream(sessionId);
    this.snapshot = this.buildSnapshot();
  }

  private get scope(): ScopeKey | null {
    const s = this.deps.access.state;
    return s.kind === 'signed_in' ? s.session.scope : null;
  }

  private get key(): SessionKey | null {
    const scope = this.scope;
    return scope ? { scope, botId: this.botId, sessionId: this.sessionId } : null;
  }

  // ------------------------------------------------------------ subscription

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private buildSnapshot(): LiveSnapshot {
    return { run: this.stream.run, live: this.stream.live, socket: this.socketStatus, pending: this.entries, failed: this.failed };
  }

  private publish() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    const key = this.key;
    if (!key || this.started) return;
    this.started = true;
    // Show the last known live state at once; it is replaced by the next snapshot.
    const checkpoint = await loadRuntimeCheckpoint(this.deps.db, key);
    if (checkpoint?.run && isRunActive(checkpoint.run.status)) {
      this.stream = { ...awaitSnapshot(this.stream), run: checkpoint.run };
    }
    await this.reloadOutbox();
    this.loaded = true;
    if (!this.started) return; // stopped while loading
    this.attachment = this.deps.hub.attach(this.botId, {
      sessionId: this.sessionId,
      onEvent: (event) => void this.onEvent(event),
      onStatus: (status) => this.onSocketStatus(status),
    });
    this.socketStatus = this.attachment.socket.currentStatus;
    this.tickTimer = setInterval(() => void this.work(), this.deps.tickMs ?? 1_000);
    this.publish();
    void this.work();
  }

  stop() {
    this.started = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.attachment?.detach();
    this.attachment = null;
    this.stream = awaitSnapshot(this.stream);
    void this.flushCheckpoint();
  }

  private async reloadOutbox() {
    const scope = this.scope;
    if (!scope) return;
    const all = await loadPendingOutbox(this.deps.db, scope);
    this.entries = all.filter((e) => e.botId === this.botId && e.sessionId === this.sessionId);
  }

  private async persist(entry: OutboxEntry) {
    await saveOutboxEntry(this.deps.db, entry);
    if (entry.status === 'failed') {
      this.entries = this.entries.filter((e) => e.invocationId !== entry.invocationId);
      if (entry.lastCode !== 'discarded') this.failed = [...this.failed.filter((e) => e.invocationId !== entry.invocationId), entry];
    } else if (entry.status === 'settled') {
      this.entries = this.entries.filter((e) => e.invocationId !== entry.invocationId);
    } else {
      const i = this.entries.findIndex((e) => e.invocationId === entry.invocationId);
      this.entries = i < 0 ? [...this.entries, entry] : this.entries.map((e, j) => (j === i ? entry : e));
    }
  }

  // ------------------------------------------------------------ user actions

  /** Queue a message. It is durable before anything touches the network. */
  async send(text: string) {
    const scope = this.scope;
    const trimmed = text.trim();
    if (!scope || !trimmed) return;
    const entry = createOutboxEntry({
      invocationId: this.deps.newId(),
      scope,
      botId: this.botId,
      sessionId: this.sessionId,
      payload: { text: trimmed },
      now: this.deps.now(),
    });
    await this.persist(entry);
    this.publish();
    void this.work();
  }

  /** User chose to resend an unconfirmed message (same invocation id). */
  async confirmResend(invocationId: string) {
    await this.applyRecovery(invocationId, { kind: 'user_resend' });
  }

  async discard(invocationId: string) {
    const entry = this.entries.find((e) => e.invocationId === invocationId);
    if (entry?.status === 'unconfirmed') {
      await this.applyRecovery(invocationId, { kind: 'user_discard' });
      return;
    }
    const failed = this.failed.find((e) => e.invocationId === invocationId);
    if (failed) {
      await saveOutboxEntry(this.deps.db, { ...failed, lastCode: 'discarded', updatedAt: this.deps.now() });
      this.failed = this.failed.filter((e) => e.invocationId !== invocationId);
      this.publish();
    }
  }

  /** Send a failed message again as a new intent (new invocation id). */
  async retryFailed(invocationId: string) {
    const failed = this.failed.find((e) => e.invocationId === invocationId);
    if (!failed) return;
    await this.discard(invocationId);
    await this.send(failed.payload.text);
  }

  /** Stop the running turn. Best effort: control acks are not persisted. */
  abort() {
    const run = this.stream.run;
    if (!run || !isRunActive(run.status)) return false;
    return (
      this.attachment?.socket.send({
        type: 'abort',
        run_id: run.run_id,
        session_id: this.sessionId,
        control_id: this.deps.newId(),
      }) ?? false
    );
  }

  private async applyRecovery(invocationId: string, step: Recovery) {
    const entry = this.entries.find((e) => e.invocationId === invocationId);
    if (!entry) return;
    await this.persist(recover(entry, step, this.deps.now()));
    this.publish();
    void this.work();
  }

  // ------------------------------------------------------------ worker

  /** Drive the oldest unfinished entry forward. Serialised; safe to call often. */
  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      const head = this.entries[0];
      if (!head) return;
      const now = this.deps.now();
      if (head.status === 'queued' && head.nextAttemptAt <= now && this.socketStatus === 'open' && this.stream.live) {
        const sent = this.attachment?.socket.send({
          type: 'message',
          invocation_id: head.invocationId,
          session_id: head.sessionId,
          text: head.payload.text,
        });
        if (sent) await this.persist(markSent(head, now));
      } else if (head.status === 'unconfirmed' && !head.needsUser && head.nextAttemptAt <= now) {
        await this.recoverHead(head);
      } else if (head.status === 'accepted' && this.stream.live && now - this.lastSettleAttempt >= SETTLE_RETRY_MS) {
        // Accepted but its run is not the active one any more (finished while
        // we were away, or recovered via lookup): pull history to settle it,
        // otherwise it would block every later send in this session.
        const run = this.stream.run;
        if (!run || run.turn_id !== head.turnId || !isRunActive(run.status)) {
          this.lastSettleAttempt = now;
          try {
            await this.deps.sync.syncLatest({ botId: this.botId, sessionId: this.sessionId });
          } catch {
            // Offline; retried on a later tick.
          }
          await this.reloadOutbox();
        }
      }
      await this.flushCheckpoint();
      this.publish();
    } finally {
      this.working = false;
    }
  }

  private async recoverHead(entry: OutboxEntry) {
    const state = this.deps.access.state;
    if (state.kind !== 'signed_in') return;
    // A live snapshot showing this run settles it without asking anyone.
    if (this.stream.live && this.stream.run?.invocation_id === entry.invocationId) {
      await this.persist(onRunObserved(entry, this.stream.run, this.deps.now()));
      return;
    }
    const plan = planRecovery(state.session.capabilities);
    if (plan !== 'lookup') {
      await this.persist(recover(entry, plan, this.deps.now()));
      return;
    }
    const request: LookupRequest = {
      baseUrl: state.session.connection.deployment,
      accessToken: state.session.credential.accessToken,
      botId: entry.botId,
      sessionId: entry.sessionId,
      invocationId: entry.invocationId,
    };
    const outcome = await lookupInvocation(this.deps.fetchFn, request);
    const { caps, step } = afterLookup(state.session.capabilities, outcome);
    if (caps !== state.session.capabilities) await this.deps.access.updateCapabilities(caps);
    await this.persist(recover(entry, step, this.deps.now()));
  }

  // ------------------------------------------------------------ server events

  private onSocketStatus(status: SocketStatus) {
    void this.handleSocketStatus(status);
  }

  private async handleSocketStatus(status: SocketStatus) {
    this.socketStatus = status;
    if (status !== 'open') {
      this.stream = awaitSnapshot(this.stream);
      // Anything in flight lost its ack with the connection.
      const now = this.deps.now();
      for (const entry of this.entries.filter((e) => e.status === 'sent')) await this.persist(onAckLost(entry, now));
    }
    this.publish();
    void this.work();
  }

  private async onEvent(event: ServerEvent) {
    if (RUNTIME_TYPES.has(event.type)) {
      const wasLive = this.stream.live;
      const step = receiveRuntimeEvent(this.stream, event as unknown as RuntimeEvent);
      this.stream = step.stream;
      if (step.effect === 'resubscribe') this.attachment?.socket.subscribe(this.sessionId);
      if (step.effect === 'changed') {
        this.checkpointDirty = true;
        await this.onRunChanged();
      }
      this.publish();
      // A fresh snapshot is what queued sends wait for.
      if (!wasLive && this.stream.live) void this.work();
      return;
    }

    const entry = event.invocation_id ? this.entries.find((e) => e.invocationId === event.invocation_id) : undefined;
    switch (event.type) {
      case 'run_accepted': {
        const state = this.deps.access.state;
        if (state.kind === 'signed_in') await this.deps.access.updateCapabilities(observeRunAccepted(state.session.capabilities));
        if (entry) {
          await this.persist(
            onRunAccepted(entry, { run_id: String(event.run_id), turn_id: String(event.turn_id) }, this.deps.now()),
          );
        }
        break;
      }
      case 'run_rejected':
      case 'error':
        if (entry) await this.persist(onRejected(entry, typeof event.code === 'string' ? event.code : undefined, this.deps.now()));
        break;
      default:
        return;
    }
    this.publish();
    void this.work();
  }

  private async onRunChanged() {
    const run = this.stream.run;
    if (!run) return;
    const now = this.deps.now();
    for (const entry of this.entries) {
      if (entry.status === 'sent' || entry.status === 'unconfirmed' || entry.status === 'queued') {
        if (run.invocation_id === entry.invocationId) await this.persist(onRunObserved(entry, run, now));
      }
    }
    // Terminal: the turn is now in REST history (contracts/u3). Pull it; the
    // history save settles the accepted Outbox entry in the same transaction.
    if (!isRunActive(run.status) && this.lastTerminalRun !== run.run_id) {
      this.lastTerminalRun = run.run_id;
      try {
        await this.deps.sync.syncLatest({ botId: this.botId, sessionId: this.sessionId });
      } catch {
        // Offline: history catches up on the next refresh.
      }
      await this.reloadOutbox();
    }
  }

  private async flushCheckpoint() {
    const key = this.key;
    if (!key || !this.checkpointDirty || !this.stream.epoch) return;
    this.checkpointDirty = false;
    await saveRuntimeCheckpoint(this.deps.db, key, {
      epoch: this.stream.epoch,
      seq: this.stream.seq,
      run: this.stream.run,
      savedAt: this.deps.now(),
    });
  }
}
