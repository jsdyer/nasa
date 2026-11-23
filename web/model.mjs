// Pure data logic shared by the browser (web/app.mjs) and the refresh script
// (scripts/refresh.mjs). No DOM, no network: everything here is unit-tested.

export const SOURCES = ['apod', 'asteroids', 'sun', 'kp', 'events', 'earth'];

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isoOrNull = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** UTC calendar date (YYYY-MM-DD) offset by `days` from `now`. */
export function utcDay(days = 0, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ APOD
export function normalizeApod(list) {
  if (!Array.isArray(list)) throw new TypeError('APOD: expected an array');
  return list
    .filter((a) => a && typeof a.date === 'string' && typeof a.title === 'string')
    .map((a) => ({
      date: a.date,
      title: a.title.trim(),
      explanation: String(a.explanation ?? '').trim(),
      media_type: a.media_type === 'video' ? 'video' : a.media_type === 'image' ? 'image' : 'other',
      url: String(a.url ?? ''),
      hdurl: a.hdurl ? String(a.hdurl) : null,
      thumbnail_url: a.thumbnail_url ? String(a.thumbnail_url) : null,
      copyright: a.copyright ? String(a.copyright).replace(/\s+/g, ' ').trim() : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** apod.nasa.gov archive page for a YYYY-MM-DD date. */
export const apodPage = (date) => `https://apod.nasa.gov/apod/ap${date.slice(2).replaceAll('-', '')}.html`;

// ------------------------------------------------------------------ NeoWs
export function normalizeNeoFeed(feed) {
  if (!feed || typeof feed.near_earth_objects !== 'object') throw new TypeError('NeoWs: missing near_earth_objects');
  const rows = [];
  const seen = new Set();
  for (const list of Object.values(feed.near_earth_objects)) {
    for (const neo of list) {
      const approaches = neo.close_approach_data || [];
      const ca = approaches.find((c) => c.orbiting_body === 'Earth') || approaches[0];
      if (!ca || seen.has(neo.id)) continue;
      seen.add(neo.id);
      const m = neo.estimated_diameter?.meters || {};
      const lunar = num(ca.miss_distance?.lunar);
      const epoch = num(ca.epoch_date_close_approach);
      if (!Number.isFinite(lunar) || !Number.isFinite(epoch)) continue;
      rows.push({
        id: String(neo.id),
        name: String(neo.name).replace(/^\((.*)\)$/, '$1').trim(),
        url: String(neo.nasa_jpl_url || ''),
        hazardous: Boolean(neo.is_potentially_hazardous_asteroid),
        diameter_m: Math.round((num(m.estimated_diameter_min) + num(m.estimated_diameter_max)) / 2) || 0,
        approach: new Date(epoch).toISOString(),
        lunar: Math.round(lunar * 100) / 100,
        km: Math.round(num(ca.miss_distance.kilometers)),
        kps: Math.round(num(ca.relative_velocity?.kilometers_per_second) * 100) / 100,
      });
    }
  }
  return rows.sort((a, b) => a.lunar - b.lunar);
}

export function summarizeAsteroids(rows) {
  if (!rows.length) return null;
  return {
    count: rows.length,
    closest: rows.reduce((a, b) => (b.lunar < a.lunar ? b : a)),
    insideMoon: rows.filter((r) => r.lunar < 1).length,
    hazardous: rows.filter((r) => r.hazardous).length,
    largest: rows.reduce((a, b) => (b.diameter_m > a.diameter_m ? b : a)),
  };
}

// ------------------------------------------------------------------ DONKI
export function normalizeDonki({ flares, storms, cmes }) {
  const arr = (v, name) => {
    if (v === null || v === undefined || v === '') return []; // DONKI returns an empty body for "none"
    if (!Array.isArray(v)) throw new TypeError(`DONKI ${name}: expected an array`);
    return v;
  };
  return {
    flares: arr(flares, 'FLR')
      .map((f) => ({
        peak: isoOrNull(f.peakTime || f.beginTime),
        cls: typeof f.classType === 'string' ? f.classType.trim() : null,
        region: f.activeRegionNum ?? null,
        where: f.sourceLocation || null,
        link: f.link || null,
      }))
      .filter((f) => f.peak && f.cls),
    storms: arr(storms, 'GST')
      .map((g) => ({
        start: isoOrNull(g.startTime),
        maxKp: Math.max(0, ...(g.allKpIndex || []).map((k) => num(k.kpIndex)).filter(Number.isFinite)),
        link: g.link || null,
      }))
      .filter((g) => g.start),
    cmes: arr(cmes, 'CME')
      .map((c) => {
        const list = c.cmeAnalyses || [];
        const a = list.find((x) => x.isMostAccurate) || list[0];
        const speed = num(a?.speed);
        return { start: isoOrNull(c.startTime), speed: Number.isFinite(speed) ? speed : null, link: c.link || null };
      })
      .filter((c) => c.start),
  };
}

/** Orders flare classes: X2.1 > X1 > M9.9 > C1. */
export function flareRank(cls = '') {
  const band = { X: 4, M: 3, C: 2, B: 1, A: 0 }[cls[0]] ?? -1;
  return band * 1000 + (num(cls.slice(1)) || 0);
}

export function summarizeSun(sun) {
  const by = (letter) => sun.flares.filter((f) => f.cls[0] === letter).length;
  return {
    x: by('X'),
    m: by('M'),
    cmes: sun.cmes.length,
    storms: sun.storms.length,
    strongest: [...sun.flares].sort((a, b) => flareRank(b.cls) - flareRank(a.cls)).slice(0, 6),
    fastestCme: sun.cmes.filter((c) => c.speed).sort((a, b) => b.speed - a.speed)[0] || null,
    biggestStorm: sun.storms.length ? sun.storms.reduce((a, b) => (b.maxKp > a.maxKp ? b : a)) : null,
  };
}

// ------------------------------------------------------------------ NOAA Kp
export function normalizeKp(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new TypeError('Kp: expected a non-empty array');
  // Older SWPC format: array of arrays with a header row. Newer: array of objects.
  const rows = Array.isArray(raw[0]) ? raw.slice(1).map(([time_tag, kp, observed]) => ({ time_tag, kp, observed })) : raw;
  return rows
    .map((r) => {
      const tag = String(r.time_tag || '').replace(' ', 'T');
      const t = isoOrNull(/Z|[+-]\d\d:?\d\d$/.test(tag) ? tag : `${tag}Z`);
      const kp = num(r.kp);
      const kind = ['observed', 'estimated', 'predicted'].includes(r.observed) ? r.observed : 'predicted';
      return { t, kp, kind };
    })
    .filter((r) => r.t && Number.isFinite(r.kp) && r.kp >= 0 && r.kp <= 9);
}

/** Highest Kp from three hours before `now` onward (null if nothing ahead). */
export function peakKp(kp, now = Date.now()) {
  const ahead = kp.filter((k) => Date.parse(k.t) >= now - 3 * 3600e3);
  return ahead.length ? ahead.reduce((a, b) => (b.kp > a.kp ? b : a)) : null;
}

// ------------------------------------------------------------------ Aurora rule of thumb
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Centred-dipole geomagnetic latitude for a place, given the north geomagnetic pole. */
export function geomagneticLatitude(lat, lon, pole) {
  const s = Math.sin(rad(lat)) * Math.sin(rad(pole.lat)) + Math.cos(rad(lat)) * Math.cos(rad(pole.lat)) * Math.cos(rad(lon - pole.lon));
  return deg(Math.asin(Math.max(-1, Math.min(1, s))));
}

/** Kp at which aurora typically reaches the poleward horizon: (base − |maglat|) / degrees_per_kp, clamped 0–9. */
export function kpNeeded(maglat, rule) {
  return Math.max(0, Math.min(9, Math.round((rule.base_latitude - Math.abs(maglat)) / rule.degrees_per_kp)));
}

export function auroraVerdict(peak, need) {
  if (peak === null || peak === undefined) return { level: 'unknown', text: 'No forecast' };
  if (need > 9) return { level: 'no', text: 'Out of range' };
  if (peak >= need) return { level: 'yes', text: 'Good chance' };
  if (peak >= need - 1) return { level: 'maybe', text: 'Possible, low on the horizon' };
  return { level: 'no', text: 'Unlikely' };
}

export function auroraForPlace(place, rule, peak) {
  const maglat = geomagneticLatitude(place.lat, place.lon, rule.geomagnetic_pole);
  const need = kpNeeded(maglat, rule);
  return { ...place, maglat, need, verdict: auroraVerdict(peak, need) };
}

/**
 * Parse a visitor's place: "Name, lat, lon" or "lat, lon". Returns {name, lat, lon}
 * or throws with a readable message.
 */
export function parsePlace(text) {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error('Enter a name, latitude and longitude, e.g. "Whitehorse, 60.72, -135.06".');
  const lon = num(parts.at(-1));
  const lat = num(parts.at(-2));
  const name = parts.slice(0, -2).join(', ').slice(0, 60) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be a number from −90 to 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Longitude must be a number from −180 to 180.');
  return { name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

// ------------------------------------------------------------------ EONET
export function eonetBbox({ west, south, east, north }) {
  return `${west},${north},${east},${south}`; // EONET order: min_lon,max_lat,max_lon,min_lat
}

export function normalizeEonet(data) {
  if (!data || !Array.isArray(data.events)) throw new TypeError('EONET: missing events');
  return data.events
    .map((e) => {
      const g = (e.geometry || []).at(-1);
      if (!g) return null;
      let c = g.coordinates;
      while (Array.isArray(c?.[0])) c = c[0]; // polygons: use the first vertex
      const [lon, lat] = c || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: String(e.id),
        title: String(e.title || 'Untitled event'),
        category: e.categories?.[0]?.title || 'Other',
        date: isoOrNull(g.date),
        lat,
        lon,
        magnitude: Number.isFinite(g.magnitudeValue) ? `${g.magnitudeValue} ${g.magnitudeUnit || ''}`.trim() : null,
        source: e.sources?.[0]?.url || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function countBy(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1;
  return Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ------------------------------------------------------------------ EPIC
const lonDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function pickEpic(frames, targetLon) {
  if (!Array.isArray(frames) || !frames.length) throw new TypeError('EPIC: no frames');
  const best = frames.reduce((a, b) =>
    lonDistance(b.centroid_coordinates.lon, targetLon) < lonDistance(a.centroid_coordinates.lon, targetLon) ? b : a);
  const [day] = best.date.split(' ');
  const [y, m, d] = day.split('-');
  const base = `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}`;
  return {
    taken: isoOrNull(best.date.replace(' ', 'T') + 'Z'),
    lat: best.centroid_coordinates.lat,
    lon: best.centroid_coordinates.lon,
    image: `${base}/jpg/${best.image}.jpg`,
    full: `${base}/png/${best.image}.png`,
    frames: frames.length,
  };
}

// ------------------------------------------------------------------ Captures
/** Problems with a capture; empty array means it's publishable. */
export function validateCapture(capture, minSources = 3) {
  const problems = [];
  if (!capture || !isoOrNull(capture.captured)) return ['missing capture time'];
  const ok = SOURCES.filter((s) => capture.status?.[s] === 'ok');
  if (ok.length < minSources) problems.push(`only ${ok.length} of ${SOURCES.length} sources succeeded (need ${minSources})`);
  for (const s of ok) if (capture[s] === undefined || capture[s] === null) problems.push(`${s} marked ok but empty`);
  if (ok.includes('apod') && !capture.apod.length) problems.push('apod has no entries');
  if (ok.includes('asteroids') && capture.asteroids.some((r) => !isFiniteNum(r.lunar) || r.lunar <= 0)) problems.push('asteroid with invalid distance');
  if (ok.includes('kp') && !capture.kp.length) problems.push('kp has no rows');
  if (ok.includes('earth') && !/^https:\/\/epic\.gsfc\.nasa\.gov\//.test(capture.earth.image)) problems.push('earth image URL unexpected');
  return problems;
}

/** Add/replace a capture entry (one per UTC date), newest first, keeping `keep`. */
export function updateIndex(index, entry, keep) {
  const rest = (Array.isArray(index) ? index : []).filter((e) => e.date !== entry.date);
  const all = [entry, ...rest].sort((a, b) => b.date.localeCompare(a.date));
  return { kept: all.slice(0, keep), dropped: all.slice(keep) };
}
