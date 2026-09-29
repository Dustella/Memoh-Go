import type { Logger } from '../../core/diagnostics/log';
import { diffAlerts, type InAppAlert } from '../../core/home/alerts';
import { homeKey, type HomeSections } from '../../core/home/home';
import type { HomeService } from './homeService';

/**
 * NT-01: while the app is in the foreground (and alerts are on), keeps Home
 * live and turns its transitions into one banner at a time. It reuses Home's
 * capped watch set (at most WATCH_LIMIT sessions, plus per-Bot activity
 * streams), so it sees exactly what Home sees; it adds no subscriptions.
 * Background delivery is push (NT-02, M4), not this.
 */
export class AlertCenter {
  private readonly listeners = new Set<() => void>();
  private current: InAppAlert | null = null;
  private previous: HomeSections | null = null;
  private viewing: string | null = null;
  private release: (() => void) | null = null;
  private readonly shown = new Set<string>();

  constructor(
    private readonly home: HomeService,
    private readonly log?: Logger,
  ) {
    home.subscribe(this.onHome);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCurrent = () => this.current;

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Foreground + signed in + preference on. Off drops the baseline, so a later "on" starts quiet. */
  setEnabled(enabled: boolean) {
    if (enabled && !this.release) {
      this.previous = null;
      this.release = this.home.retain();
    } else if (!enabled && this.release) {
      this.release();
      this.release = null;
      this.previous = null;
      this.dismiss();
    }
  }

  /** The chat on screen: its own changes are not news. */
  setViewing(botId: string | null, sessionId?: string) {
    this.viewing = botId && sessionId ? homeKey(botId, sessionId) : null;
    if (this.current && this.viewing === homeKey(this.current.botId, this.current.sessionId)) this.dismiss();
  }

  dismiss() {
    if (!this.current) return;
    this.current = null;
    this.emit();
  }

  private onHome = () => {
    const snap = this.home.getSnapshot();
    if (!snap.loaded) {
      this.previous = null;
      return;
    }
    const alerts = this.release ? diffAlerts(this.previous, snap.sections, this.viewing).filter((a) => !this.shown.has(a.id)) : [];
    this.log?.debug('alerts.home', {
      enabled: Boolean(this.release),
      baseline: this.previous !== null,
      running: snap.sections.running.length,
      needs: snap.sections.needsYou.length,
      fired: alerts.length,
    });
    this.previous = snap.sections;
    const latest = alerts.at(-1);
    if (!latest) return;
    for (const a of alerts) this.shown.add(a.id);
    this.log?.info('alerts.shown', { kind: latest.kind, session_id: latest.sessionId, count: alerts.length });
    this.current = latest;
    this.emit();
  };
}
