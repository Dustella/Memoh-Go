import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * FL-03: download a workspace file into the app cache and hand it to the
 * system share sheet (save to Files, send to another app). The token goes
 * in a header; the cached copy lives under cache/shared and is overwritten
 * on the next share of the same name.
 */
export async function downloadAndShare(url: string, token: string, name: string, mimeType?: string): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = await downloadToCache(url, token, name, 'shared');
  await Sharing.shareAsync(file, { mimeType, dialogTitle: name });
  return 'shared';
}

/**
 * Download into cache/<folder> and return the file:// URI. Used for image
 * previews too: on the New Architecture, <Image source={{ headers }}> does
 * not send the header on Android (the dev stack answered 401), so images
 * are fetched here with the token and shown from disk.
 */
export async function downloadToCache(url: string, token: string, name: string, folder = 'preview'): Promise<string> {
  const dir = new Directory(Paths.cache, folder);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const safe = name.replace(/[\\/:*?"<>|]/g, '_') || 'file';
  const file = await File.downloadFileAsync(url, new File(dir, safe), { headers: { authorization: `Bearer ${token}` }, idempotent: true });
  return file.uri;
}
