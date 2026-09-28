/**
 * JS-thread frame sampler. UI/RenderThread jank is read separately from
 * `adb shell dumpsys gfxinfo`; this measures whether JS keeps up with vsync.
 */
const FRAME_MS = 1000 / 60;

export type FrameReport = Readonly<{
  durationMs: number;
  frames: number;
  fps: number;
  /** Share of expected vsync frames the JS thread missed. */
  droppedPct: number;
  p95IntervalMs: number;
  longestIntervalMs: number;
}>;

export function startFrameMonitor() {
  const intervals: number[] = [];
  let last = 0;
  let running = true;
  const started = performance.now();

  const tick = (now: number) => {
    if (!running) return;
    if (last > 0) intervals.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    stop(): FrameReport {
      running = false;
      const durationMs = performance.now() - started;
      const sorted = [...intervals].sort((a, b) => a - b);
      const expected = Math.max(1, Math.round(durationMs / FRAME_MS));
      const missed = intervals.reduce((sum, interval) => sum + Math.max(0, Math.round(interval / FRAME_MS) - 1), 0);
      return {
        durationMs: Math.round(durationMs),
        frames: intervals.length,
        fps: round1((intervals.length / durationMs) * 1000),
        droppedPct: round1((missed / expected) * 100),
        p95IntervalMs: round1(percentile(sorted, 0.95)),
        longestIntervalMs: round1(sorted[sorted.length - 1] ?? 0),
      };
    },
  };
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

type HermesStats = { js_heapSize?: number; js_allocatedBytes?: number };

/** Hermes heap size in MB, or null when the engine does not expose it. */
export function jsHeapMb(): number | null {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } }).HermesInternal;
  const stats = hermes?.getInstrumentedStats?.();
  const bytes = stats?.js_heapSize ?? stats?.js_allocatedBytes;
  return typeof bytes === 'number' ? round1(bytes / 1024 / 1024) : null;
}
