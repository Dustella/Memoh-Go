import type { OutgoingAttachment } from '../operations/outbox';

/**
 * CH-16 / FL-04 rules that do not touch the device.
 *
 * Chat attachments travel inline (base64 in the WS frame), as the web client
 * does. The server accepts up to 200 MiB per asset, but a phone holds the
 * whole data URL in JS memory while sending, so the app caps each file at
 * 20 MB and a message at 9 files.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 9;
/** Workspace uploads stream from disk, so they can be larger. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export type PickedFile = Readonly<{ uri: string; name: string; mime: string; size: number }>;
export type Rejection = Readonly<{ name: string; reason: 'too_large' | 'too_many' }>;

/** "20 MB" for limits, which are whole megabytes. */
export function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function attachmentType(mime: string): OutgoingAttachment['type'] {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Split a pick into what fits next to the files already attached. */
export function admitAttachments(
  picked: readonly PickedFile[],
  existing: number,
  maxBytes = MAX_ATTACHMENT_BYTES,
): { accepted: PickedFile[]; rejected: Rejection[] } {
  const accepted: PickedFile[] = [];
  const rejected: Rejection[] = [];
  for (const file of picked) {
    if (file.size > maxBytes) rejected.push({ name: file.name, reason: 'too_large' });
    else if (existing + accepted.length >= MAX_ATTACHMENTS) rejected.push({ name: file.name, reason: 'too_many' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${base64}`;
}

/** The WS attachment object (same fields as the web client's ChatAttachment). */
export function wireAttachment(a: OutgoingAttachment, dataUrl: string) {
  return { type: a.type, base64: dataUrl, mime: a.mime, name: a.name, ...(a.size > 0 ? { size: a.size } : {}) };
}

/** A file name that is safe on disk and in a workspace path. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
}

/** "notes.txt" → "notes (1).txt", the first name not in `taken`. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every staged file URI still needed by an unfinished or resendable message. */
export function referencedUris(payloads: readonly { attachments?: readonly OutgoingAttachment[] }[]): Set<string> {
  const keep = new Set<string>();
  for (const p of payloads) for (const a of p.attachments ?? []) keep.add(a.uri);
  return keep;
}
