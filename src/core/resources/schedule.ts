/**
 * SC-03: common schedule frequencies as cron patterns, and a readable
 * description of a pattern. Memoh parses `pattern` with robfig/cron
 * (optional seconds + 5 fields + descriptors) in the Bot's time zone; there
 * is no per-schedule time zone and the server does not report the next run.
 * Anything that is not one of these shapes is shown as the raw expression.
 */
import type { MessageKey } from '../i18n';

export type Frequency =
  | Readonly<{ kind: 'hourly'; minute: number }>
  | Readonly<{ kind: 'daily'; hour: number; minute: number }>
  | Readonly<{ kind: 'weekdays'; hour: number; minute: number }>
  | Readonly<{ kind: 'weekly'; weekday: number; hour: number; minute: number }>
  | Readonly<{ kind: 'custom'; pattern: string }>;

const int = (s: string, min: number, max: number) => {
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

export function toPattern(f: Frequency): string {
  switch (f.kind) {
    case 'hourly':
      return `${f.minute} * * * *`;
    case 'daily':
      return `${f.minute} ${f.hour} * * *`;
    case 'weekdays':
      return `${f.minute} ${f.hour} * * 1-5`;
    case 'weekly':
      return `${f.minute} ${f.hour} * * ${f.weekday}`;
    case 'custom':
      return f.pattern.trim();
  }
}

/** The preset a pattern corresponds to, or `custom`. */
export function parsePattern(pattern: string): Frequency {
  const trimmed = pattern.trim();
  const descriptors: Record<string, Frequency> = {
    '@hourly': { kind: 'hourly', minute: 0 },
    '@daily': { kind: 'daily', hour: 0, minute: 0 },
    '@midnight': { kind: 'daily', hour: 0, minute: 0 },
    '@weekly': { kind: 'weekly', weekday: 0, hour: 0, minute: 0 },
  };
  if (descriptors[trimmed]) return descriptors[trimmed]!;
  const f = trimmed.split(/\s+/);
  if (f.length !== 5 || f[2] !== '*' || f[3] !== '*') return { kind: 'custom', pattern: trimmed };
  const minute = int(f[0]!, 0, 59);
  if (minute === null) return { kind: 'custom', pattern: trimmed };
  if (f[1] === '*' && f[4] === '*') return { kind: 'hourly', minute };
  const hour = int(f[1]!, 0, 23);
  if (hour === null) return { kind: 'custom', pattern: trimmed };
  if (f[4] === '*') return { kind: 'daily', hour, minute };
  if (f[4] === '1-5') return { kind: 'weekdays', hour, minute };
  const weekday = int(f[4]!, 0, 7);
  if (weekday !== null) return { kind: 'weekly', weekday: weekday % 7, hour, minute };
  return { kind: 'custom', pattern: trimmed };
}

/** Light client-side check; the server is the authority and answers 400 for a bad pattern. */
export function looksLikeCron(pattern: string): boolean {
  const p = pattern.trim();
  if (/^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(p) || /^@every\s+\S+$/.test(p)) return true;
  const fields = p.split(/\s+/);
  return (fields.length === 5 || fields.length === 6) && fields.every((x) => /^[\d*/,\-A-Za-z?]+$/.test(x));
}

export const clock = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;


/** Readable frequency for list rows, in the active language. */
export function describePattern(pattern: string, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const f = parsePattern(pattern);
  switch (f.kind) {
    case 'hourly':
      return t('schedule.desc.hourly', { minute: String(f.minute).padStart(2, '0') });
    case 'daily':
      return t('schedule.desc.daily', { time: clock(f.hour, f.minute) });
    case 'weekdays':
      return t('schedule.desc.weekdays', { time: clock(f.hour, f.minute) });
    case 'weekly':
      return t('schedule.desc.weekly', { weekday: t(`weekday.${f.weekday}` as MessageKey), time: clock(f.hour, f.minute) });
    case 'custom':
      return t('schedule.desc.custom', { pattern: f.pattern });
  }
}
