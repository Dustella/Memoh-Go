import { Platform, type View } from 'react-native';

import { jsHeapMb, percentile, round1, startFrameMonitor, type FrameReport } from '../../platform/diagnostics/frameMonitor';
import type { BenchListHandle, ListImpl } from './BenchList';
import { buildHistory, buildHugeMessage, streamChunks, type ChatRow, type Scenario } from './scenarios';
import type { StreamingRowsStore } from './streamingRowsStore';

export type BenchResult = Readonly<{
  scenario: string;
  impl: ListImpl;
  dev: boolean;
  device: string;
  rows: number;
  mountMs: number;
  frames: FrameReport | null;
  latency: Readonly<{ p50: number; p95: number; max: number; flushes: number }> | null;
  heapMb: Readonly<{ start: number | null; end: number | null }>;
  /** Largest on-screen movement of the anchored row across prepends; null when not measured, -1 when lost. */
  anchorDriftPx: number | null;
}>;

export type RunContext = Readonly<{
  scenario: Scenario;
  impl: ListImpl;
  store: StreamingRowsStore;
  list: () => BenchListHandle | null;
  commits: number[];
  anchor: { key: string | null; view: View | null };
  setAnchorKey: (key: string | null) => void;
  isCancelled: () => boolean;
}>;

const SEED = 20260928;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

function deviceLabel(): string {
  const constants = Platform.constants as { Model?: string; Release?: string };
  return `${constants.Model ?? Platform.OS} / Android ${constants.Release ?? Platform.Version}`;
}

function measureY(view: View | null): Promise<number | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((_x, y, _w, height) => resolve(height > 0 ? y : null));
  });
}

export async function runScenario(ctx: RunContext): Promise<BenchResult> {
  const { scenario, store } = ctx;
  const heapStart = jsHeapMb();

  const initial: ChatRow[] =
    scenario.id === 'huge100k' ? buildHugeMessage(SEED) : buildHistory(scenario.historyTurns, scenario.historyChars, SEED);
  const mountStart = performance.now();
  store.setHistory(initial);
  await frames(3);
  const mountMs = Math.round(performance.now() - mountStart);
  await sleep(600);

  let frameReport: FrameReport | null = null;
  let latency: BenchResult['latency'] = null;
  let anchorDriftPx: number | null = null;

  if (scenario.rate > 0) {
    ctx.list()?.scrollToEnd(false);
    await sleep(400);
    const chunks = streamChunks(scenario, SEED);
    store.startStreamingTurn('live');
    store.flushes.length = 0;
    ctx.commits.length = 0;
    const monitor = startFrameMonitor();
    const started = performance.now();
    let sent = 0;
    while (sent < chunks.length && !ctx.isCancelled()) {
      const due = Math.min(chunks.length, Math.floor(((performance.now() - started) / 1000) * scenario.rate));
      while (sent < due) store.append(chunks[sent++]!);
      await sleep(8);
    }
    await sleep(300);
    frameReport = monitor.stop();

    const samples = store.flushes
      .map((flush) => {
        const commit = ctx.commits.find((at) => at >= flush.publishedAt);
        return commit === undefined ? null : commit - flush.enqueuedAt;
      })
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    latency = {
      p50: round1(percentile(samples, 0.5)),
      p95: round1(percentile(samples, 0.95)),
      max: round1(samples[samples.length - 1] ?? 0),
      flushes: samples.length,
    };
  }

  if (scenario.sweep) {
    const list = ctx.list();
    list?.scrollToEnd(false);
    await sleep(500);
    const monitor = startFrameMonitor();
    const deadline = performance.now() + 12_000;
    let { offset, viewportHeight } = list?.metrics() ?? { offset: 0, viewportHeight: 800 };
    const step = Math.max(600, viewportHeight * 3);
    // Up to the top, then back down: flings of ~3 screens.
    while (offset > 0 && performance.now() < deadline && !ctx.isCancelled()) {
      offset = Math.max(0, offset - step);
      list?.scrollToOffset(offset, true);
      await sleep(350);
    }
    const bottom = list?.metrics().contentHeight ?? 0;
    while (offset < bottom && performance.now() < deadline && !ctx.isCancelled()) {
      offset = Math.min(bottom, offset + step);
      list?.scrollToOffset(offset, true);
      await sleep(350);
    }
    frameReport = monitor.stop();
  }

  if (scenario.prependPages > 0) {
    const mid = Math.floor(initial.length / 2);
    ctx.list()?.scrollToIndex(mid);
    await sleep(900);
    ctx.setAnchorKey(initial[mid]!.key);
    await sleep(400);
    const baseline = await measureY(ctx.anchor.view);
    const monitor = startFrameMonitor();
    let drift = 0;
    for (let page = 1; page <= scenario.prependPages && !ctx.isCancelled(); page += 1) {
      store.prependHistory(buildHistory(50, scenario.historyChars, SEED + page * 1000, `p${page}-`));
      await frames(2);
      await sleep(350);
      const y = await measureY(ctx.anchor.view);
      if (baseline === null || y === null) {
        drift = -1;
        break;
      }
      drift = Math.max(drift, Math.abs(y - baseline));
    }
    frameReport = monitor.stop();
    anchorDriftPx = drift < 0 ? -1 : round1(drift);
  }

  return {
    scenario: scenario.id,
    impl: ctx.impl,
    dev: __DEV__,
    device: deviceLabel(),
    rows: store.getSnapshot().length,
    mountMs,
    frames: frameReport,
    latency,
    heapMb: { start: heapStart, end: jsHeapMb() },
    anchorDriftPx,
  };
}
