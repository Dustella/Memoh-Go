#!/usr/bin/env node
// Drive the render benchmark on a connected device/emulator over adb.
// Each list × scenario runs in a fresh process (force-stop + deep link), then
// the JS result line and UI-thread jank from `dumpsys gfxinfo` are collected.
//
//   node scripts/run-bench.mjs --serial emulator-5554 [--repeat 1] [--out tests/performance/results]
//
// Requires a release build made with EXPO_PUBLIC_BENCH=1 (dev builds are not
// representative).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

const adbPath = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
const serial = args.serial;
const repeat = Number(args.repeat ?? 1);
const outDir = args.out ?? 'tests/performance/results';
const lists = (args.lists ?? 'flat,flash,legend').split(',');
const scenarios = (args.scenarios ?? 'stream100,burst500,history10k,huge100k,prepend').split(',');
const PKG = 'ai.memoh.mobile';

function adb(...command) {
  const full = serial ? ['-s', serial, ...command] : command;
  return execFileSync(adbPath, full, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseGfx(text) {
  const number = (pattern) => {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : null;
  };
  return {
    totalFrames: number(/Total frames rendered:\s*(\d+)/),
    jankyPct: number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p90Ms: number(/90th percentile:\s*(\d+)ms/),
    p95Ms: number(/95th percentile:\s*(\d+)ms/),
  };
}

async function runOnce(list, scenario) {
  adb('shell', 'am', 'force-stop', PKG);
  adb('logcat', '-c');
  adb('shell', `am start -a android.intent.action.VIEW -d 'memoh://bench?list=${list}&scenario=${scenario}&auto=1' ${PKG}`);
  await sleep(1500);
  adb('shell', 'dumpsys', 'gfxinfo', PKG, 'reset');

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const log = adb('logcat', '-d', '-s', 'ReactNativeJS:*');
    const line = log.split('\n').find((entry) => entry.includes('[bench-result]'));
    if (line) {
      const result = JSON.parse(line.slice(line.indexOf('{')));
      return { ...result, gfx: parseGfx(adb('shell', 'dumpsys', 'gfxinfo', PKG)) };
    }
  }
  return { scenario, impl: list, error: 'timeout' };
}

const results = [];
for (let round = 0; round < repeat; round += 1) {
  for (const scenario of scenarios) {
    for (const list of lists) {
      process.stdout.write(`${scenario} × ${list} (round ${round + 1}) … `);
      const result = await runOnce(list, scenario);
      results.push(result);
      console.log(result.error ?? `JS drop ${result.frames?.droppedPct}% · UI jank ${result.gfx?.jankyPct}%`);
    }
  }
}
adb('shell', 'am', 'force-stop', PKG);

const cell = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);
const rows = results.map((r) =>
  r.error
    ? `| ${r.scenario} | ${r.impl} | ${r.error} | | | | | |`
    : `| ${r.scenario} | ${r.impl} | ${cell(r.mountMs, 'ms')} | ${cell(r.frames?.droppedPct, '%')} | ${cell(r.frames?.p95IntervalMs, 'ms')} | ${cell(r.gfx?.jankyPct, '%')} | ${r.latency ? `${r.latency.p50}/${r.latency.p95}ms` : '—'} | ${r.anchorDriftPx === null ? '—' : r.anchorDriftPx < 0 ? 'lost' : `${r.anchorDriftPx}px`} | ${cell(r.heapMb?.end, 'MB')} |`,
);
const device = results.find((r) => r.device)?.device ?? 'unknown';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const table = [
  `Device: ${device} · build: ${results[0]?.dev ? 'dev' : 'release'} · ${new Date().toISOString()}`,
  '',
  '| scenario | list | mount | JS dropped | JS p95 frame | UI janky | visible latency p50/p95 | anchor drift | heap end |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows,
].join('\n');

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${device.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${stamp}`);
writeFileSync(`${base}.json`, JSON.stringify(results, null, 2));
writeFileSync(`${base}.md`, `${table}\n`);
console.log(`\n${table}\n\nSaved ${base}.{json,md}`);
