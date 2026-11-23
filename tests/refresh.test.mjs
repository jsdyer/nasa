import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'refresh.mjs');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'raw');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, NASA_API_KEY: '' } });

test('captures accumulate by date and earlier ones stay readable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nasa-'));
  const cache = path.join(dir, 'cache'), out = path.join(dir, 'out');
  for (const now of ['2026-11-21T15:00:00Z', '2026-11-22T15:00:00Z', '2026-11-23T15:00:00Z', '2026-11-23T20:00:00Z']) {
    const r = run(['--fixtures', FIX, '--cache', cache, '--out', out, '--now', now]);
    assert.equal(r.status, 0, r.stderr);
  }
  const index = JSON.parse(readFileSync(path.join(out, 'index.json'), 'utf8'));
  assert.deepEqual(index.captures.map((c) => c.date), ['2026-11-23', '2026-11-22', '2026-11-21']);
  assert.equal(index.captures[0].captured, '2026-11-23T20:00:00.000Z'); // same-day rerun replaces
  assert.deepEqual(readdirSync(path.join(out, 'captures')).sort(), ['2026-11-21.json', '2026-11-22.json', '2026-11-23.json']);
  const old = JSON.parse(readFileSync(path.join(out, 'captures', '2026-11-21.json'), 'utf8'));
  assert.equal(old.status.asteroids, 'ok');
});

test('a refresh with too many failed sources exits non-zero and publishes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nasa-'));
  const fix = path.join(dir, 'raw');
  cpSync(FIX, fix, { recursive: true });
  for (const f of ['apod', 'neo', 'kp', 'eonet']) writeFileSync(path.join(fix, `${f}.json`), '{"broken":');
  const out = path.join(dir, 'out');
  const r = run(['--fixtures', fix, '--cache', path.join(dir, 'cache'), '--out', out, '--now', '2026-11-23T15:00:00Z']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /keeping the last good deployment/);
  assert.throws(() => readdirSync(out));
});

test('live mode refuses to run without a key', () => {
  const r = run([]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /NASA_API_KEY is not set/);
});
