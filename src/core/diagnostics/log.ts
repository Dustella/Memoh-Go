/**
 * PF-04: structured, redacted diagnostics log.
 *
 * Every entry is `{ at, level, event, fields }` with a dotted event name
 * (`socket.closed`, `outbox.ack_lost`). Fields are scrubbed when they are
 * written, not when they are shown, so nothing sensitive is ever held:
 *
 * - keys that can carry credentials or user content are replaced by a marker
 *   (token, password, authorization, cookie, secret, text, content, payload,
 *   message body, prompt, answer, input/output of tools);
 * - URLs keep scheme, host, port and path, never the query or fragment;
 * - long strings are cut, nested values are flattened to a shallow summary.
 *
 * The log is an in-memory ring (it does not survive a restart) and never
 * leaves the device unless the user copies it from the diagnostics page.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null;
export type LogEntry = Readonly<{ at: number; level: LogLevel; event: string; fields: Readonly<Record<string, LogValue>> }>;

export const REDACTED = '[redacted]';
const MAX_STRING = 200;
const SENSITIVE_KEY = /(token|password|passwd|secret|authorization|cookie|credential|text|content|payload|body|prompt|answer|message|input|output|draft)/i;
/** Identifiers are useful for correlating events and carry no content. */
const SAFE_KEY = /^(.*_id|.*Id|id|code|status|state|kind|event|phase|count|attempts|seq|epoch|version|reason)$/;
const URL_PATTERN = /\b(https?|wss?):\/\/[^\s?#"']+(?:[?#][^\s"']*)?/gi;

function scrubString(value: string): string {
  const noQuery = value.replace(URL_PATTERN, (url) => url.replace(/[?#].*$/, ''));
  // Anything that looks like a bearer header or a JWT is dropped even inside free text.
  const noBearer = noQuery.replace(/bearer\s+[\w.~+/=-]+/gi, `Bearer ${REDACTED}`).replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED);
  return noBearer.length > MAX_STRING ? `${noBearer.slice(0, MAX_STRING)}…(${noBearer.length})` : noBearer;
}

export function scrubValue(key: string, value: unknown): LogValue {
  if (SENSITIVE_KEY.test(key) && !SAFE_KEY.test(key)) return value === undefined || value === null || value === '' ? null : REDACTED;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return scrubString(value);
  if (value instanceof Error) return scrubString(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return `[array ${value.length}]`;
  if (typeof value === 'object') return `[object ${Object.keys(value).length} keys]`;
  return scrubString(String(value));
}

export function scrubFields(fields: Readonly<Record<string, unknown>> | undefined): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = scrubValue(key, value);
  }
  return out;
}

export type Logger = Readonly<{
  log: (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  debug: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  info: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  warn: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  error: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  entries: () => readonly LogEntry[];
  subscribe: (listener: () => void) => () => void;
  clear: () => void;
}>;

export function createLogger(options: { capacity?: number; now?: () => number; sink?: (entry: LogEntry) => void } = {}): Logger {
  const capacity = options.capacity ?? 500;
  const now = options.now ?? Date.now;
  let ring: LogEntry[] = [];
  const listeners = new Set<() => void>();

  const log: Logger['log'] = (level, event, fields) => {
    const entry: LogEntry = { at: now(), level, event, fields: scrubFields(fields) };
    // Copy-on-write so `entries()` snapshots stay stable for React.
    ring = ring.length >= capacity ? [...ring.slice(ring.length - capacity + 1), entry] : [...ring, entry];
    options.sink?.(entry);
    for (const listener of listeners) listener();
  };

  return {
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
    entries: () => ring,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => {
      ring = [];
      for (const listener of listeners) listener();
    },
  };
}

/** A logger that drops everything, for tests and callers that do not care. */
const noop = () => undefined;
export const silentLogger: Logger = {
  log: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  entries: () => [],
  subscribe: () => noop,
  clear: noop,
};

export function formatEntry(entry: LogEntry): string {
  const time = new Date(entry.at).toISOString();
  const fields = Object.entries(entry.fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return `${time} ${entry.level.toUpperCase().padEnd(5)} ${entry.event}${fields ? ` ${fields}` : ''}`;
}
