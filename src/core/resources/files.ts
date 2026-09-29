/**
 * FL-01/02: pure helpers for the workspace file browser and viewer. Paths are
 * container-absolute, as the server returns them (`/bots/:id/container/fs/*`).
 */
export type FileKind = 'markdown' | 'text' | 'code' | 'image' | 'other';

const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
const TEXT = new Set(['txt', 'log', 'csv', 'tsv', 'env', 'ini', 'cfg', 'conf', 'gitignore']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const CODE: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

/** Largest file shown inline as text; bigger ones are offered for sharing instead. */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile' || lower === 'makefile') return lower;
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : dot === 0 ? lower.slice(1) : '';
}

export function fileKind(name: string): FileKind {
  const ext = extensionOf(name);
  if (MARKDOWN.has(ext)) return 'markdown';
  if (IMAGE.has(ext)) return 'image';
  if (ext in CODE) return 'code';
  if (TEXT.has(ext) || ext === '') return 'text';
  return 'other';
}

export const codeLanguage = (name: string): string | undefined => CODE[extensionOf(name)];

/** Folders first, then by name (case-insensitive, numeric-aware); hidden entries last within each group. */
export function sortEntries<T extends { name: string; isDir: boolean }>(entries: readonly T[]): T[] {
  const hidden = (n: string) => (n.startsWith('.') ? 1 : 0);
  return [...entries].sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      hidden(a.name) - hidden(b.name) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function normalisePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** A child of `dir`; `name` must already be a single safe segment. */
export function joinPath(dir: string, name: string): string {
  const d = normalisePath(dir);
  return d === '/' ? `/${name}` : `${d}/${name}`;
}

export function parentPath(path: string): string {
  const p = normalisePath(path);
  if (p === '/') return '/';
  return p.slice(0, p.lastIndexOf('/')) || '/';
}

export function baseName(path: string): string {
  const p = normalisePath(path);
  return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1);
}

export type Crumb = Readonly<{ label: string; path: string }>;

/**
 * Breadcrumbs from `root` (shown as `rootLabel`) down to `path`. A path
 * outside the root is shown from the filesystem root.
 */
export function breadcrumbs(path: string, root: string, rootLabel: string): Crumb[] {
  const p = normalisePath(path);
  const r = normalisePath(root);
  const inside = r === '/' ? true : p === r || p.startsWith(`${r}/`);
  const start = inside ? r : '/';
  const crumbs: Crumb[] = [{ label: inside ? rootLabel : '/', path: start }];
  const rest = p.slice(start === '/' ? 1 : start.length + 1);
  let current = start;
  for (const part of rest.split('/').filter(Boolean)) {
    current = current === '/' ? `/${part}` : `${current}/${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Symlinks report as non-directories with mode `L…`; they can still be opened as a folder or file. */
export const isSymlink = (mode?: string) => Boolean(mode && mode.startsWith('L'));
