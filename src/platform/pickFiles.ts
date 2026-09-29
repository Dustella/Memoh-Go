import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { attachmentType, safeFileName, type PickedFile } from '../core/resources/attachments';
import type { OutgoingAttachment } from '../core/operations/outbox';
import { ApiError } from '../data/remote/memohClient';

export type PickSource = 'photos' | 'camera' | 'files';

function nameFromUri(uri: string, fallback: string) {
  const last = decodeURIComponent(uri.split('?')[0].split('/').pop() ?? '');
  return last || fallback;
}

/**
 * System pickers. All of them hand back a copy in the app cache, so the
 * result can be read or uploaded without extra storage permissions. Android
 * 13+ uses the system photo picker; the camera asks for its permission the
 * first time.
 */
export async function pickFiles(source: PickSource, multiple = true): Promise<PickedFile[] | 'denied'> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ multiple, copyToCacheDirectory: true, type: '*/*' });
    if (result.canceled) return [];
    return result.assets.map((a) => ({ uri: a.uri, name: a.name || nameFromUri(a.uri, 'file'), mime: a.mimeType || 'application/octet-stream', size: a.size ?? fileSize(a.uri) }));
  }
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: multiple, selectionLimit: multiple ? 9 : 1, quality: 1 });
  }
  if (result.canceled) return [];
  return result.assets.map((a, i) => {
    const mime = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
    // The Android photo picker hands back a numeric media id instead of a file name.
    const fallback = `${a.type === 'video' ? 'video' : 'photo'}-${stamp()}${result.assets.length > 1 ? `-${i + 1}` : ''}.${mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
    const name = a.fileName && !/^\d+(\.\w+)?$/.test(a.fileName) ? a.fileName : fallback;
    return { uri: a.uri, name, mime, size: a.fileSize ?? fileSize(a.uri) };
  });
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fileSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------ chat attachments (CH-16)

const STAGING = 'outbox';

/**
 * Copy picked files into the document directory, which the OS does not clear
 * like the cache. The Outbox references these copies, so a message queued
 * offline or across a crash still has its files when it is finally sent.
 */
export async function stageAttachments(files: readonly PickedFile[], id: () => string): Promise<OutgoingAttachment[]> {
  const root = new Directory(Paths.document, STAGING);
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  const staged: OutgoingAttachment[] = [];
  for (const f of files) {
    const dir = new Directory(root, id());
    dir.create({ idempotent: true });
    const target = new File(dir, safeFileName(f.name));
    await new File(f.uri).copy(target);
    staged.push({ type: attachmentType(f.mime), uri: target.uri, name: f.name, mime: f.mime, size: f.size || (target.size ?? 0) });
  }
  return staged;
}

export async function readAttachmentBase64(a: OutgoingAttachment): Promise<string> {
  const file = new File(a.uri);
  if (!file.exists) throw new Error('attachment file is gone');
  return file.base64();
}

/** Remove staged copies (a chip the user removed before sending). */
export function discardStaged(list: readonly OutgoingAttachment[]) {
  for (const a of list) {
    try {
      const file = new File(a.uri);
      const dir = file.parentDirectory;
      if (file.exists) file.delete();
      if (dir.exists && dir.list().length === 0) dir.delete();
    } catch {
      // Best effort; the startup sweep catches leftovers.
    }
  }
}

/** Startup sweep: delete staged files no remaining message refers to. */
export function sweepStaged(keep: ReadonlySet<string>): number {
  const root = new Directory(Paths.document, STAGING);
  if (!root.exists) return 0;
  let removed = 0;
  for (const dir of root.list()) {
    if (!(dir instanceof Directory)) continue;
    const files = dir.list();
    if (files.some((f) => f instanceof File && keep.has(f.uri))) continue;
    try {
      dir.delete();
      removed += 1;
    } catch {
      // Try again next start.
    }
  }
  return removed;
}

// ------------------------------------------------------------ workspace upload (FL-04)

/**
 * `POST /bots/:id/container/fs/upload` (multipart `path` + `file`). The
 * native uploader streams the file from disk and reports progress; the token
 * goes in a header.
 */
export async function uploadToWorkspace(
  url: string,
  token: string,
  file: PickedFile,
  destination: string,
  onProgress?: (fraction: number) => void,
): Promise<{ path: string; size: number }> {
  let result;
  try {
    result = await new File(file.uri).upload(url, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mime,
      parameters: { path: destination },
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      onProgress: onProgress ? ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress(Math.min(1, bytesSent / totalBytes)) : undefined,
    });
  } catch (e) {
    throw new ApiError('network', e instanceof Error ? e.message : 'Upload failed');
  }
  let body: { path?: string; size?: number; message?: string; detail?: string; code?: string } = {};
  try {
    body = JSON.parse(result.body || '{}');
  } catch {
    // Non-JSON error page; the status says enough.
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError('http', body.message || body.detail || `HTTP ${result.status}`, result.status, body.code);
  }
  return { path: body.path ?? destination, size: body.size ?? file.size };
}
