/**
 * SS-05: `GET /bots/:bot_id/sessions/events` (text/event-stream). One JSON
 * object per `data:` frame; frames recorded on the dev stack 2026-09-29:
 *
 *   {"type":"activity_ready","cache_invalidation":true,"session_id":""}
 *   {"type":"session_touched","session_id":"…","updated_at":"…"}   (often twice)
 *   {"type":"session_invalidated","session_id":"…"}
 *   {"type":"session_created","session_id":"…","title":"…"}
 *   {"type":"session_title_changed","session_id":"…","title":"…"}
 *   {"type":"session_compaction","session_ids":[],"session_id":""}
 *   {"type":"dropped","count":n}   {"type":"ping"}                  (ping every ~20 s)
 *
 * Frames never carry message content. There is no "deleted" frame.
 */
export type SessionActivity =
  | Readonly<{ type: 'touched'; sessionId: string; updatedAt?: string }>
  | Readonly<{ type: 'created'; sessionId: string; title?: string }>
  | Readonly<{ type: 'title'; sessionId: string; title: string }>
  /** Resync everything from REST: stream (re)opened with cache invalidation, or events were dropped. */
  | Readonly<{ type: 'resync' }>;

export function toActivity(frame: unknown): SessionActivity | null {
  if (!frame || typeof frame !== 'object') return null;
  const f = frame as { type?: unknown; session_id?: unknown; updated_at?: unknown; title?: unknown };
  const sessionId = typeof f.session_id === 'string' ? f.session_id : '';
  switch (f.type) {
    case 'session_touched':
    case 'session_invalidated':
      return sessionId ? { type: 'touched', sessionId, updatedAt: typeof f.updated_at === 'string' ? f.updated_at : undefined } : null;
    case 'session_created':
      return sessionId ? { type: 'created', sessionId, title: typeof f.title === 'string' ? f.title : undefined } : null;
    case 'session_title_changed':
    case 'session_title_updated':
      return sessionId && typeof f.title === 'string' ? { type: 'title', sessionId, title: f.title } : null;
    case 'dropped':
      return { type: 'resync' };
    case 'activity_ready':
      return (f as { cache_invalidation?: unknown }).cache_invalidation === true ? { type: 'resync' } : null;
    default:
      return null;
  }
}

/**
 * Incremental text/event-stream parser: feed chunks as they arrive (a chunk
 * may end mid-line or mid-event); each complete event's joined `data:` lines
 * are handed to `onData`. Comments and other fields are ignored.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = '';
  let data: string[] = [];
  const line = (raw: string) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (text === '') {
      if (data.length > 0) onData(data.join('\n'));
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
  };
  return {
    feed(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    },
    reset() {
      buffer = '';
      data = [];
    },
  };
}
