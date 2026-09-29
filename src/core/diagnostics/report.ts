import type { OutboxEntry } from '../operations/outbox';
import { formatEntry, scrubValue, type LogEntry } from './log';

export type DiagnosticsInput = Readonly<{
  generatedAt: number;
  app: Readonly<{ version: string; build: string; platform: string; osVersion: string }>;
  /** Null when signed out. */
  server: Readonly<{
    deployment: string;
    version: string;
    commit: string;
    invocationLookup: string;
    admissionDedup: string;
    session: string;
  }> | null;
  outbox: readonly OutboxEntry[];
  entries: readonly LogEntry[];
}>;

/**
 * PF-04: the text a user can copy and hand to support. It contains versions,
 * capability knowledge, counts and the redacted event log; no account name,
 * token, or message content (the outbox is summarised by status only).
 */
export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const lines: string[] = [];
  lines.push('Memoh Go diagnostics');
  lines.push(`generated: ${new Date(input.generatedAt).toISOString()}`);
  lines.push(`app: ${input.app.version} (${input.app.build}) ${input.app.platform} ${input.app.osVersion}`);
  if (input.server) {
    const s = input.server;
    lines.push(`server: ${scrubValue('deployment', s.deployment)} version=${s.version || 'unknown'} commit=${s.commit || 'unknown'}`);
    lines.push(`capabilities: invocation_lookup=${s.invocationLookup} admission_dedup=${s.admissionDedup}`);
    lines.push(`session: ${s.session}`);
  } else {
    lines.push('server: signed out');
  }
  const byStatus = new Map<string, number>();
  for (const e of input.outbox) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  const needsUser = input.outbox.filter((e) => e.needsUser).length;
  const summary = [...byStatus].map(([status, n]) => `${status}=${n}`).join(' ') || 'empty';
  lines.push(`outbox: ${summary}${needsUser ? ` needs_user=${needsUser}` : ''}`);
  lines.push(`log (${input.entries.length} entries, oldest first):`);
  for (const entry of input.entries) lines.push(formatEntry(entry));
  return lines.join('\n');
}
