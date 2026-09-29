import { describe, expect, it } from 'vitest';

import { failureState, summaryState, targetState, targetViews } from './environment';
import { baseName, breadcrumbs, extensionOf, fileKind, formatBytes, normalisePath, parentPath, sortEntries } from './files';
import { looksLikeCron, parsePattern, toPattern } from './schedule';

describe('files', () => {
  it('classifies files by extension', () => {
    expect(fileKind('weekly.md')).toBe('markdown');
    expect(fileKind('chart.PNG')).toBe('image');
    expect(fileKind('data.json')).toBe('code');
    expect(fileKind('Dockerfile')).toBe('code');
    expect(fileKind('notes.txt')).toBe('text');
    expect(fileKind('README')).toBe('text');
    expect(fileKind('.gitignore')).toBe('text');
    expect(fileKind('archive.tar.gz')).toBe('other');
    expect(extensionOf('/data/a.b/c')).toBe('');
  });

  it('lists folders first, hidden entries last, numbers in order', () => {
    const e = (name: string, isDir = false) => ({ name, isDir });
    expect(sortEntries([e('b.txt'), e('.cache', true), e('src', true), e('a10.txt'), e('a2.txt'), e('.env')]).map((x) => x.name)).toEqual([
      'src',
      '.cache',
      'a2.txt',
      'a10.txt',
      'b.txt',
      '.env',
    ]);
  });

  it('normalises paths and builds breadcrumbs from the root', () => {
    expect(normalisePath('//data/./reports/../x/')).toBe('/data/x');
    expect(parentPath('/data/reports')).toBe('/data');
    expect(parentPath('/data')).toBe('/');
    expect(baseName('/data/reports/weekly.md')).toBe('weekly.md');
    expect(breadcrumbs('/data/reports/q3', '/data', 'Home')).toEqual([
      { label: 'Home', path: '/data' },
      { label: 'reports', path: '/data/reports' },
      { label: 'q3', path: '/data/reports/q3' },
    ]);
    expect(breadcrumbs('/etc/hosts', '/data', 'Home').map((c) => c.path)).toEqual(['/', '/etc', '/etc/hosts']);
    expect(breadcrumbs('/data', '/data', 'Home')).toEqual([{ label: 'Home', path: '/data' }]);
  });

  it('formats sizes', () => {
    expect(formatBytes(123)).toBe('123 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2_461_488_017)).toBe('2.3 GB');
  });
});

describe('schedule patterns', () => {
  it('round-trips the presets', () => {
    const presets = [
      { kind: 'hourly', minute: 15 },
      { kind: 'daily', hour: 9, minute: 0 },
      { kind: 'weekdays', hour: 8, minute: 30 },
      { kind: 'weekly', weekday: 1, hour: 18, minute: 5 },
    ] as const;
    for (const f of presets) expect(parsePattern(toPattern(f))).toEqual(f);
    expect(toPattern({ kind: 'weekdays', hour: 9, minute: 0 })).toBe('0 9 * * 1-5');
  });

  it('keeps anything else as custom', () => {
    expect(parsePattern('*/5 * * * *')).toEqual({ kind: 'custom', pattern: '*/5 * * * *' });
    expect(parsePattern('0 9 1 * *')).toEqual({ kind: 'custom', pattern: '0 9 1 * *' });
    expect(parsePattern('0 0 9 * * *')).toEqual({ kind: 'custom', pattern: '0 0 9 * * *' });
    expect(parsePattern('@daily')).toEqual({ kind: 'daily', hour: 0, minute: 0 });
    expect(parsePattern('0 9 * * 7')).toEqual({ kind: 'weekly', weekday: 0, hour: 9, minute: 0 });
  });

  it('checks the shape of a custom expression', () => {
    expect(looksLikeCron('*/5 * * * *')).toBe(true);
    expect(looksLikeCron('0 0 9 * * MON-FRI')).toBe(true);
    expect(looksLikeCron('@every 1h30m')).toBe(true);
    expect(looksLikeCron('every day')).toBe(false);
    expect(looksLikeCron('0 9 * *')).toBe(false);
  });
});

describe('environment', () => {
  it('maps target status, preferring the explicit status', () => {
    expect(targetState({ online: true, status: 'online' })).toBe('online');
    expect(targetState({ online: false, status: 'client_update_required' })).toBe('update_required');
    expect(targetState({ online: false })).toBe('offline');
    expect(targetState({})).toBe('unknown');
  });

  it('puts the primary target first and uses it for the summary', () => {
    const views = targetViews([
      { target_id: 'r1', name: 'Laptop', kind: 'remote', online: false, status: 'offline' },
      { target_id: 'native', name: 'Server Workspace', kind: 'native', primary: true, online: true, status: 'online' },
    ]);
    expect(views.map((v) => v.id)).toEqual(['native', 'r1']);
    expect(summaryState(views)).toBe('online');
    expect(summaryState([])).toBe('unknown');
  });

  it('turns request failures into states', () => {
    expect(failureState(403)).toBe('forbidden');
    expect(failureState(503)).toBe('unreachable');
    expect(failureState(0)).toBe('unreachable');
    expect(failureState(500)).toBe('unknown');
  });
});
