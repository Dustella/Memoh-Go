import { Redirect } from 'expo-router';

import type { HomeSnapshot } from '../../application/conversation/homeService';
import { buildHome, homeKey } from '../../core/home/home';
import { HomeView } from '../../features/home/HomeScreen';

/**
 * DEV-ONLY MOCK (documented in docs/HANDOFF.md): the home list rendered from
 * fixture sessions, so every section and "needs you" reason can be checked on
 * screen. The dev-stack model never calls tools, so approvals and questions
 * cannot be produced for real. Release builds redirect to the home tab.
 */
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const s = (id: string, title: string, minAgo: number, botName = 'Kitty') => ({
  botId: botName,
  botName,
  sessionId: id,
  title,
  updatedAt: iso(minAgo),
});
const k = (id: string, bot = 'Kitty') => homeKey(bot, id);
const run = (status: string, decision: 'approval' | 'question' | null = null, minAgo = 1) => ({
  status,
  decision,
  updatedAt: iso(minAgo),
  observedAt: now,
});

const sections = buildHome({
  sessions: [
    s('deploy', '把 staging 部署到新集群', 2, 'Ops'),
    s('survey', '整理用户调研问卷', 5),
    s('backup', '每晚备份数据库', 30, 'Ops'),
    s('report', '生成本周周报', 4),
    s('crawl', '抓取竞品价格', 12, 'Research'),
    s('ask-fail', '翻译发布说明', 8),
    s('tides', '潮汐的形成', 20),
    s('tea', '茶的历史', 90),
    s('rivers', '中国的三条河流', 200),
  ],
  runs: new Map([
    [k('deploy', 'Ops'), run('waiting_decision', 'approval')],
    [k('survey'), run('waiting_decision', 'question')],
    [k('backup', 'Ops'), run('errored', null, 1)],
    [k('report'), run('running')],
    [k('crawl', 'Research'), run('finishing')],
  ]),
  liveKeys: new Set([k('deploy', 'Ops'), k('survey'), k('report')]),
  outbox: new Map([[k('ask-fail'), { unsure: 1, failed: 0, queued: 0 }]]),
  seen: new Map([
    [k('tides'), now - 60 * 60_000],
    [k('tea'), now - 10 * 60_000],
    [k('rivers'), now - 100 * 60_000],
  ]),
  baseline: now - 24 * 60 * 60_000,
});

const snapshot: HomeSnapshot = { loaded: true, refreshing: false, error: null, sections, watching: 3, watchLimit: 8 };

export default function HomePreviewRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <HomeView snap={snapshot} onRefresh={() => undefined} />;
}
