import { describe, expect, it } from 'vitest';

import { diffAlerts } from './alerts';
import type { HomeItem, HomeSections } from './home';

const item = (sessionId: string, extra: Partial<HomeItem> = {}): HomeItem => ({
  key: `b1/${sessionId}`,
  botId: 'b1',
  botName: 'Kitty',
  sessionId,
  title: `t-${sessionId}`,
  updatedAt: '2026-09-29T01:00:00Z',
  ...extra,
});
const sections = (patch: Partial<HomeSections>): HomeSections => ({
  continueWith: null,
  needsYou: [],
  running: [],
  newResults: [],
  recent: [],
  ...patch,
});

describe('diffAlerts (NT-01)', () => {
  it('says nothing for the first snapshot', () => {
    expect(diffAlerts(null, sections({ needsYou: [item('s1', { reason: 'approval' })] }), null)).toEqual([]);
  });

  it('alerts when a live run finishes', () => {
    const prev = sections({ running: [item('s1', { phase: 'running', cached: false })] });
    const next = sections({ newResults: [item('s1', { updatedAt: '2026-09-29T02:00:00Z' })] });
    expect(diffAlerts(prev, next, null)).toEqual([
      { id: 'b1/s1:completed:2026-09-29T02:00:00Z', kind: 'completed', botId: 'b1', sessionId: 's1', botName: 'Kitty', title: 't-s1' },
    ]);
  });

  it('alerts once per new decision or failure, not for unchanged ones', () => {
    const prev = sections({ needsYou: [item('s1', { reason: 'approval' })] });
    const next = sections({
      needsYou: [item('s1', { reason: 'approval' }), item('s2', { reason: 'question' }), item('s3', { reason: 'send_unsure' }), item('s4', { reason: 'run_failed' })],
    });
    expect(diffAlerts(prev, next, null).map((a) => `${a.sessionId}:${a.kind}`)).toEqual(['s2:question', 's4:failed']);
  });

  it('a run that ends waiting for the user alerts as the decision, not as completed', () => {
    const prev = sections({ running: [item('s1', { phase: 'running', cached: false })] });
    const next = sections({ needsYou: [item('s1', { reason: 'run_failed' })] });
    expect(diffAlerts(prev, next, null).map((a) => a.kind)).toEqual(['failed']);
  });

  it('stays quiet about the session on screen and about cached rows', () => {
    const prev = sections({ running: [item('s1', { cached: false }), item('s2', { cached: true })] });
    const next = sections({ recent: [item('s1'), item('s2')], needsYou: [item('s5', { reason: 'approval' })] });
    expect(diffAlerts(prev, next, 'b1/s1').map((a) => a.sessionId)).toEqual(['s5']);
    expect(diffAlerts(sections({}), next, 'b1/s5')).toEqual([]);
  });
});
