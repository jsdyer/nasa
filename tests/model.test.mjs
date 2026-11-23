import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../web/model.mjs';

const raw = (name) => JSON.parse(readFileSync(new URL(`./fixtures/raw/${name}.json`, import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../web/config.json', import.meta.url), 'utf8'));

test('APOD is sorted newest first and copyright whitespace collapsed', () => {
  const list = M.normalizeApod(raw('apod'));
  assert.equal(list.length, 7);
  assert.ok(list[0].date > list[1].date);
  assert.ok(list.filter((a) => a.copyright).every((a) => a.copyright === 'Someone'));
  assert.equal(M.apodPage('2026-11-23'), 'https://apod.nasa.gov/apod/ap261123.html');
});

test('NeoWs feed flattens, de-duplicates and sorts by distance', () => {
  const rows = M.normalizeNeoFeed(raw('neo'));
  const total = Object.values(raw('neo').near_earth_objects).flat().length;
  assert.equal(rows.length, total);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].lunar >= rows[i - 1].lunar);
  assert.ok(!rows[0].name.startsWith('('));
  const dup = { near_earth_objects: { a: [raw('neo').near_earth_objects[Object.keys(raw('neo').near_earth_objects)[0]][0]], b: [raw('neo').near_earth_objects[Object.keys(raw('neo').near_earth_objects)[0]][0]] } };
  assert.equal(M.normalizeNeoFeed(dup).length, 1);
  const sum = M.summarizeAsteroids(rows);
  assert.equal(sum.count, rows.length);
  assert.equal(sum.closest, rows[0]);
  assert.equal(M.summarizeAsteroids([]), null);
});

test('DONKI accepts empty responses and ranks flare classes', () => {
  const sun = M.normalizeDonki({ flares: raw('flr'), storms: raw('gst'), cmes: raw('cme') });
  const sum = M.summarizeSun(sun);
  assert.deepEqual([sum.x, sum.m, sum.cmes, sum.storms], [1, 2, 2, 1]);
  assert.deepEqual(sum.strongest.map((f) => f.cls), ['X1.1', 'M5.6', 'M1.2', 'C8.0', 'C3.4']);
  assert.equal(sum.biggestStorm.maxKp, 7);
  assert.deepEqual(M.normalizeDonki({ flares: null, storms: '', cmes: [] }), { flares: [], storms: [], cmes: [] });
  assert.ok(M.flareRank('X1') > M.flareRank('M9.9'));
  assert.throws(() => M.normalizeDonki({ flares: {} }), TypeError);
});

test('Kp parses both SWPC formats and finds the peak ahead', () => {
  const kp = M.normalizeKp(raw('kp'));
  assert.equal(kp.length, 56);
  const objects = M.normalizeKp([{ time_tag: '2026-11-23T00:00:00', kp: 4.33, observed: 'predicted' }]);
  assert.equal(objects[0].t, '2026-11-23T00:00:00.000Z');
  const peak = M.peakKp(kp, Date.parse('2026-11-23T15:00:00Z'));
  assert.ok(peak.kp > 5);
  assert.equal(M.peakKp(kp, Date.parse('2030-01-01')), null);
});

test('geomagnetic latitude and Kp thresholds for the configured places', () => {
  const [van, hfx] = config.places.map((p) => M.auroraForPlace(p, config.aurora, 6));
  assert.ok(Math.abs(van.maglat - 54.5) < 0.5);
  assert.ok(Math.abs(hfx.maglat - 53.7) < 0.5);
  assert.equal(van.need, 6);
  assert.equal(van.verdict.level, 'yes');
  assert.equal(M.auroraVerdict(5, 6).level, 'maybe');
  assert.equal(M.auroraVerdict(3, 6).level, 'no');
  assert.equal(M.auroraVerdict(null, 6).level, 'unknown');
});

test('places beyond the starter list work, including the southern hemisphere', () => {
  const extra = ['Whitehorse, 60.72, -135.06', 'Iqaluit, 63.75, -68.52', 'Hobart, Tasmania, -42.88, 147.33', '45.5, -73.57'].map(M.parsePlace);
  assert.equal(extra[2].name, 'Hobart, Tasmania');
  assert.equal(extra[3].name, '45.50, -73.57');
  const all = [...config.places, ...extra].map((p) => M.auroraForPlace(p, config.aurora, 4));
  assert.equal(all.length, config.places.length + extra.length);
  assert.ok(all.find((p) => p.name === 'Whitehorse').need < all.find((p) => p.name === 'Vancouver').need);
  assert.ok(all.find((p) => p.name === 'Hobart, Tasmania').maglat < 0);
  assert.throws(() => M.parsePlace('Nowhere, 95, 10'), /Latitude/);
  assert.throws(() => M.parsePlace('x, 10, 200'), /Longitude/);
  assert.throws(() => M.parsePlace('just a name'), /name, latitude/);
});

test('EONET events normalize points and polygons; bbox uses EONET order', () => {
  const evs = M.normalizeEonet(raw('eonet'));
  assert.equal(evs.length, 6);
  assert.ok(evs[0].date >= evs[1].date);
  const poly = M.normalizeEonet({ events: [{ id: 1, title: 'Ice', categories: [{ title: 'Sea and Lake Ice' }], geometry: [{ date: '2026-11-01T00:00:00Z', type: 'Polygon', coordinates: [[[-80, 60], [-79, 61], [-80, 60]]] }] }] });
  assert.deepEqual([poly[0].lon, poly[0].lat], [-80, 60]);
  assert.equal(M.eonetBbox(config.events.bbox), '-141,84,-52,41.6');
  assert.deepEqual(M.countBy(evs, 'category')[0], ['Wildfires', 3]);
});

test('EPIC picks the frame nearest the target longitude, across the antimeridian', () => {
  const e = M.pickEpic(raw('epic'), -100);
  assert.equal(e.lon, -100);
  assert.match(e.image, /^https:\/\/epic\.gsfc\.nasa\.gov\/archive\/natural\/2026\/11\/22\/jpg\//);
  assert.equal(M.pickEpic(raw('epic'), -175).lon, 170);
});

test('capture validation and index retention', () => {
  const capture = { captured: '2026-11-23T15:00:00Z', status: { apod: 'ok', kp: 'ok', earth: '503' }, apod: M.normalizeApod(raw('apod')), kp: [{}], earth: null };
  assert.match(M.validateCapture(capture, 3).join(), /only 2 of 6/);
  assert.deepEqual(M.validateCapture(capture, 2), []);
  assert.deepEqual(M.validateCapture({}, 1), ['missing capture time']);
  let index = [];
  for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-21']) index = M.updateIndex(index, { date: d }, 2).kept;
  assert.deepEqual(index.map((e) => e.date), ['2026-11-22', '2026-11-21']);
});

test('APOD placeholders are detected and real pages are parsed instead', () => {
  const placeholder = { date: '2026-11-23', title: 'NASA Science', media_type: 'image', url: 'https://science.nasa.gov/wp-content/themes/nasa-child/assets/images/nasa-logo@2x.png' };
  assert.ok(M.isPlaceholderApod(placeholder));
  assert.ok(!M.isPlaceholderApod(M.normalizeApod(raw('apod'))[0]));
  assert.ok(!M.isPlaceholderApod({ title: 'A video', media_type: 'video', url: 'https://www.youtube.com/embed/abc' }));
  const page = readFileSync(new URL('./fixtures/apod-page.html', import.meta.url), 'utf8');
  const a = M.parseApodPage(page, '2026-11-23');
  assert.equal(a.title, 'Sample Nebula in Hydrogen & Oxygen');
  assert.equal(a.url, 'https://apod.nasa.gov/apod/image/2611/SampleNebula_1024.jpg');
  assert.equal(M.parseApodPage(page, '2026-11-23', 'https://www.star.ucl.ac.uk/~apod/apod/ap261123.html').url, 'https://www.star.ucl.ac.uk/~apod/apod/image/2611/SampleNebula_1024.jpg');
  assert.ok(!M.isPlaceholderApod(M.parseApodPage(page, '2026-11-23', 'https://www.star.ucl.ac.uk/~apod/apod/ap261123.html')));
  assert.equal(a.hdurl, 'https://apod.nasa.gov/apod/image/2611/SampleNebula_Big.jpg');
  assert.equal(a.copyright, 'A. Astrophotographer');
  assert.match(a.explanation, /^What lights up this nebula \? Ionized hydrogen glows red, while oxygen/);
  assert.ok(!a.explanation.includes('<'));
  assert.ok(!M.isPlaceholderApod(a));
  assert.throws(() => M.parseApodPage('<html>nothing</html>', '2026-11-23'), /unexpected layout/);
  const cap = { captured: '2026-11-23T15:00:00Z', status: { apod: 'ok', kp: 'ok', events: 'ok' }, apod: [placeholder], kp: [{}], events: [] };
  assert.match(M.validateCapture(cap, 3).join(), /placeholder/);
});
