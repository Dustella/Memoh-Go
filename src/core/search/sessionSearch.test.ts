import { describe, expect, it } from 'vitest';

import type { HomeSession } from '../home/home';
import { searchBots, searchSessions } from './sessionSearch';

const s = (sessionId: string, botId: string, botName: string, title: string, updatedAt: string): HomeSession => ({
  sessionId,
  botId,
  botName,
  title,
  updatedAt,
});

const sessions = [
  s('s1', 'b1', 'Kitty', 'The history of tea', '2026-09-29T01:00:00Z'),
  s('s2', 'b1', 'Kitty', 'Bridges of Isfahan', '2026-09-29T03:00:00Z'),
  s('s3', 'b2', 'Ops', 'Deploy staging 部署', '2026-09-29T02:00:00Z'),
  s('s4', 'b2', 'Ops', '', '2026-09-28T02:00:00Z'),
];

describe('searchSessions', () => {
  it('matches every term against title, Bot name and id, newest first', () => {
    expect(searchSessions({ sessions, query: 'kitty' }).map((x) => x.sessionId)).toEqual(['s2', 's1']);
    expect(searchSessions({ sessions, query: 'kitty TEA' }).map((x) => x.sessionId)).toEqual(['s1']);
    expect(searchSessions({ sessions, query: '部署' }).map((x) => x.sessionId)).toEqual(['s3']);
    expect(searchSessions({ sessions, query: 's4' }).map((x) => x.sessionId)).toEqual(['s4']);
    expect(searchSessions({ sessions, query: 'nothing' })).toEqual([]);
  });

  it('ignores case and character width', () => {
    expect(searchSessions({ sessions, query: 'ＢＲＩＤＧＥＳ' }).map((x) => x.sessionId)).toEqual(['s2']);
  });

  it('filters by Bot and lists everything for an empty query', () => {
    expect(searchSessions({ sessions, query: '', botId: 'b2' }).map((x) => x.sessionId)).toEqual(['s3', 's4']);
    expect(searchSessions({ sessions, query: '  ', limit: 2 }).map((x) => x.sessionId)).toEqual(['s2', 's3']);
  });
});

describe('searchBots', () => {
  it('matches display or handle names, never on an empty query', () => {
    const bots = [{ id: 'b1', display_name: 'Kitty' }, { id: 'b2', name: 'ops-bot' }];
    expect(searchBots(bots, 'OPS').map((b) => b.id)).toEqual(['b2']);
    expect(searchBots(bots, '')).toEqual([]);
  });
});
