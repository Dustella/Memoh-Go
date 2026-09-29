import { afterEach, describe, expect, it } from 'vitest';

import { relativeTime } from '../../ui/time';
import { en } from './en';
import { getLocale, interpolate, resolveLocale, setLocale, t, tn } from './index';
import { zh } from './zh';

afterEach(() => setLocale('zh'));

describe('i18n tables', () => {
  it('define the same keys in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it('use the same placeholders in both languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      // English month names use {monthName}; everything else must match exactly.
      if (key === 'time.monthDay') continue;
      // A `.one` form may spell the number out instead of using {count}.
      const strip = (list: (string | undefined)[]) => (key.endsWith('.one') ? list.filter((n) => n !== 'count') : list);
      expect(strip(names(en[key])), key).toEqual(strip(names(zh[key])));
    }
  });
});

describe('t / tn', () => {
  it('translates and interpolates', () => {
    expect(t('connect.wrongAccount', { username: 'alice' })).toBe('请使用 alice 登录，或先退出这个账号。');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('connect.wrongAccount', { username: 'alice' })).toBe('Sign in as alice, or sign out of that account first.');
  });

  it('keeps unknown placeholders visible', () => {
    expect(interpolate('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });

  it('picks the singular form only for one', () => {
    setLocale('en');
    expect(tn('chat.status.failedSends', 1)).toBe('1 message failed to send');
    expect(tn('chat.status.failedSends', 3)).toBe('3 messages failed to send');
    setLocale('zh');
    expect(tn('chat.status.failedSends', 1)).toBe('1 条消息发送失败');
  });
});

describe('resolveLocale', () => {
  it('follows an explicit choice', () => {
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('zh', 'en-US')).toBe('zh');
  });

  it('maps the system language', () => {
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('zh');
    expect(resolveLocale('system', 'zh_TW')).toBe('zh');
    expect(resolveLocale('system', 'en-GB')).toBe('en');
    expect(resolveLocale('system', 'fr-FR')).toBe('en');
    expect(resolveLocale('system', undefined)).toBe('zh');
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 8, 29, 13, 0).getTime();
  it('formats in both languages', () => {
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 分钟前');
    expect(relativeTime(new Date(2026, 2, 4, 9).toISOString(), now)).toBe('3月4日');
    setLocale('en');
    expect(relativeTime(new Date(now - 60_000).toISOString(), now)).toBe('1 min ago');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(relativeTime(new Date(2026, 2, 4, 9).toISOString(), now)).toBe('Mar 4');
    expect(relativeTime(new Date(now - 26 * 3_600_000).toISOString(), now)).toBe('Yesterday');
  });
});
