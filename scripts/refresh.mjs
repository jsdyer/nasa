#!/usr/bin/env node
// Fetch one dated capture from NASA (and NOAA's Kp forecast), validate it, and
// publish it into web/data/ alongside earlier captures kept in .cache/captures/.
//
//   NASA_API_KEY=… node scripts/refresh.mjs                # live
//   node scripts/refresh.mjs --fixtures tests/fixtures/raw  # offline, from saved responses
//
// Exits non-zero (so CI does not deploy) when validation fails; the previous
// deployment then stays live. The API key is used only here, never in web/.

import { mkdir, readFile, writeFile, readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../web/model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const fixtures = opt('--fixtures') ? path.resolve(opt('--fixtures')) : null;
const CACHE = path.resolve(opt('--cache') || path.join(ROOT, '.cache', 'captures'));
const OUT = path.resolve(opt('--out') || path.join(ROOT, 'web', 'data'));
const KEY = process.env.NASA_API_KEY || '';
if (!fixtures && !KEY) {
  console.error('NASA_API_KEY is not set. Add it as a repository secret (or pass --fixtures DIR for offline data).');
  process.exit(1);
}

const config = JSON.parse(await readFile(path.join(ROOT, 'web', 'config.json'), 'utf8'));
const now = opt('--now') ? new Date(opt('--now')) : new Date(); // --now lets fixtures replay a fixed day
const day = (o) => M.utcDay(o, now);

const describe = (e) => [e.message, e.cause?.code || e.cause?.message].filter(Boolean).join(' / ');

async function get(name, url) {
  if (fixtures) return JSON.parse(await readFile(path.join(fixtures, `${name}.json`), 'utf8'));
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'coolcode.ca/nasa (github.com/jsdyer/nasa)' }, signal: AbortSignal.timeout(45000) });
    if (res.ok) {
      const text = await res.text();
      return text.trim() ? JSON.parse(text) : null; // DONKI sends an empty body when there's nothing
    }
    if (attempt >= 3 || res.status < 500) throw new Error(`${res.status} ${res.statusText}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
}
// DONKI: api.nasa.gov mirror, with NASA CCMC's own web service (no key) as a fallback.
const donki = (type, params) => `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/${type}?${new URLSearchParams(params)}`;
const nasa = (p, params) => `https://api.nasa.gov${p}?${new URLSearchParams({ ...params, api_key: KEY })}`;

const fetchers = {
  apod: async () => {
    const from = day(1 - config.apod_days), to = day(0);
    const code = date => date.slice(2).replaceAll('-', '');
    const url = `${M.APOD_API}?${new URLSearchParams({date_from:code(from), date_to:code(to), per_page:25})}`;
    const list = M.normalizeApodBasic(await get('apod-basic', url))
      .filter(a => a.date >= from && a.date <= to && !M.isPlaceholderApod(a));
    if (!list.length) throw new Error('APOD Basic returned no usable dated entries in the requested window');
    return [...new Map(list.map(a => [a.date, a])).values()];
  },
  asteroids: async () => M.normalizeNeoFeed(await get('neo', nasa('/neo/rest/v1/feed', { start_date: day(0), end_date: day(config.asteroid_days - 1) }))),
  sun: async () => {
    const range = { startDate: day(-config.space_weather_days), endDate: day(0) };
    // Try api.nasa.gov first, then CCMC directly; report every host's error if both fail.
    const one = async (type) => {
      const errors = [];
      for (const url of [nasa(`/DONKI/${type}`, range), donki(type, range)]) {
        try { return await get(type.toLowerCase(), url); } catch (e) { errors.push(`${new URL(url).host}: ${describe(e)}`); if (fixtures) break; }
      }
      throw new Error(`${type} ${errors.join('; ')}`);
    };
    // Each feed is optional: a failed one is recorded and its part of the section says so.
    const results = await Promise.allSettled(['FLR', 'GST', 'CME'].map(one));
    if (results.every((r) => r.status === 'rejected')) throw new Error(results.map((r) => r.reason.message).join(' | '));
    const [flares, storms, cmes] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const missing = Object.fromEntries(['flares', 'storms', 'cmes'].flatMap((k, i) => (results[i].status === 'rejected' ? [[k, results[i].reason.message.slice(0, 200)]] : [])));
    return { ...M.normalizeDonki({ flares, storms, cmes }), missing };
  },
  kp: async () => M.normalizeKp(await get('kp', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json')),
  events: async () => M.normalizeEonet(await get('eonet',
    `https://eonet.gsfc.nasa.gov/api/v3/events?${new URLSearchParams({ status: 'open', days: config.events.days, bbox: M.eonetBbox(config.events.bbox) })}`)),
  earth: async () => M.pickEpic(await get('epic', nasa('/EPIC/api/natural', {})), config.earth_target_longitude),
};

const capture = { captured: now.toISOString(), date: day(0), coverage: { events: config.events.label, apod_days: config.apod_days, asteroid_days: config.asteroid_days, space_weather_days: config.space_weather_days }, status: {} };
await Promise.all(Object.entries(fetchers).map(async ([name, fn]) => {
  try {
    capture[name] = await fn();
    capture.status[name] = 'ok';
    console.log(`✓ ${name}`);
  } catch (err) {
    capture[name] = null;
    capture.status[name] = describe(err).replaceAll(KEY || '\0', '***').slice(0, 200);
    console.error(`✗ ${name}: ${capture.status[name]}`);
  }
}));

const problems = M.validateCapture(capture, config.min_sources);
if (problems.length) {
  console.error(`Capture rejected, keeping the last good deployment:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

// Store this capture with earlier ones, then publish the kept set into web/data/.
await mkdir(CACHE, { recursive: true });
await writeFile(path.join(CACHE, `${capture.date}.json`), JSON.stringify(capture));
let index = [];
try { index = JSON.parse(await readFile(path.join(CACHE, 'index.json'), 'utf8')); } catch { /* first run */ }
const entry = { date: capture.date, captured: capture.captured, status: { ...capture.status, ...Object.fromEntries(Object.entries(capture.sun?.missing || {}).map(([name, error]) => ['sun.' + name, error])) }, coverage: capture.coverage };
const { kept, dropped } = M.updateIndex(index, entry, config.keep_captures);
for (const d of dropped) await rm(path.join(CACHE, `${d.date}.json`), { force: true });
await writeFile(path.join(CACHE, 'index.json'), JSON.stringify(kept));

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'captures'), { recursive: true });
const present = new Set(await readdir(CACHE));
const published = kept.filter((e) => present.has(`${e.date}.json`));
for (const e of published) await copyFile(path.join(CACHE, `${e.date}.json`), path.join(OUT, 'captures', `${e.date}.json`));
await writeFile(path.join(OUT, 'index.json'), JSON.stringify({ built: now.toISOString(), captures: published }, null, 1));
console.log(`Published ${published.length} capture(s); newest ${capture.date}.`);
