import { t, tn } from '../core/i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short relative time for list metadata ("刚刚"/"Just now", "5 分钟前", "昨天", "9月3日"/"Sep 3"). */
export function relativeTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = Math.max(0, now - time);
  const minute = 60_000;
  if (diff < minute) return t('time.justNow');
  if (diff < 60 * minute) return tn('time.minutesAgo', Math.floor(diff / minute));
  const date = new Date(time);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (time >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (time >= startOfToday - 86_400_000) return t('time.yesterday');
  if (date.getFullYear() === today.getFullYear()) {
    return t('time.monthDay', { month: date.getMonth() + 1, monthName: MONTHS[date.getMonth()]!, day: date.getDate() });
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
