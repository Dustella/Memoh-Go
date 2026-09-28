/** Short Chinese relative time for list metadata ("刚刚", "5 分钟前", "昨天", "9月3日"). */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  const date = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (t >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (t >= startOfToday - 86_400_000) return '昨天';
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
