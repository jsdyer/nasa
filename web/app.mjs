import * as M from './model.mjs';

const STORE = 'coolcode:nasa:places';
const $ = (s, el = document) => el.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';

// --- Safe DOM building: strings always become text nodes ---------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'href' || k === 'src') { const u = safeUrl(v); if (u) el.setAttribute(k, u); }
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}
function safeUrl(u) {
  try { const url = new URL(u, location.href); return url.protocol === 'https:' || url.origin === location.origin ? url.href : null; } catch { return null; }
}
const fmt = new Intl.NumberFormat('en-CA');
const when = (iso, o = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) => new Date(iso).toLocaleString('en-CA', o);
const dayOf = (iso) => when(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const full = (iso) => when(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const brief = (reason = '') => { const r = String(reason).split(/[(;|]/)[0].trim(); return r.length > 70 ? `${r.slice(0, 70)}…` : r; };
const unavailable = (el, what, reason) => el.replaceChildren(h('p', { class: 'unavailable', title: reason || null }, `${what} wasn't available in this capture${reason ? ` (${brief(reason)})` : ''}.`));

let config, capture, map, mapLayer;

// --- 01 Earth ---------------------------------------------------------------------
function renderEarth(e) {
  const el = $('#earth .body');
  if (!e) return unavailable(el, 'The EPIC image', capture.status.earth);
  el.replaceChildren(h('figure', {},
    h('a', { href: e.full }, h('img', { src: e.image, alt: 'Full-disc image of Earth from the DSCOVR spacecraft', loading: 'lazy' })),
    h('figcaption', {},
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, `${e.lat.toFixed(1)}°, ${e.lon.toFixed(1)}°`), 'centre of view'),
        h('div', {}, h('b', {}, String(e.frames)), 'frames that day')),
      h('p', { class: 'meta' }, `Taken ${full(e.taken)}`),
      h('p', {}, "NASA's EPIC camera on DSCOVR sits 1.5 million km away at the Sun–Earth L1 point and sees the whole sunlit face at once. This is the day's frame centred closest to Canada."))));
}

// --- 02 APOD + 07 week strip --------------------------------------------------------
function apodMedia(a) {
  if (a.media_type === 'image') return h('a', { href: a.hdurl || a.url }, h('img', { src: a.url, alt: a.title }));
  const embed = safeUrl(a.url);
  if (a.media_type === 'video' && embed && /\.(mp4|webm)(?:[?#]|$)/i.test(embed))
    return h('video', { src: embed, controls: '', preload: 'metadata', poster: safeUrl(a.thumbnail_url) || '', 'aria-label': a.title });
  if (a.media_type === 'video' && embed && /^https:\/\/(www\.)?(youtube(-nocookie)?\.com\/embed|player\.vimeo\.com)\//.test(embed))
    return h('iframe', { src: embed, title: a.title, allowfullscreen: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  if (a.thumbnail_url) return h('a', { href: a.url }, h('img', { src: a.thumbnail_url, alt: a.title }));
  return h('p', {}, h('a', { href: a.page_url || M.apodPage(a.date) }, 'Open APOD article'));
}
function renderApod(list) {
  const el = $('#apod .body');
  const strip = $('#week .strip');
  if (!list?.length) { unavailable(strip, 'APOD'); return unavailable(el, 'APOD', capture.status.apod); }
  const a = list[0];
  const expl = h('p', { class: 'expl' }, a.explanation);
  const more = h('button', { class: 'quiet', type: 'button', 'aria-expanded': 'false', onclick: () => {
    const open = expl.classList.toggle('open');
    more.textContent = open ? 'Show less' : 'Read more';
    more.setAttribute('aria-expanded', String(open));
  } }, 'Read more');
  el.replaceChildren(h('figure', {}, apodMedia(a), h('figcaption', {},
    h('h3', {}, a.title),
    h('p', { class: 'meta' }, a.date, a.copyright ? ` · © ${a.copyright}` : ''),
    expl, more, ' ', h('a', { href: a.page_url || M.apodPage(a.date) }, 'APOD article ↗'))));
  strip.replaceChildren(...list.map((d) => {
    const img = d.media_type === 'image' ? d.url : d.thumbnail_url;
    return h('a', { href: d.page_url || M.apodPage(d.date) }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'ph' }), h('span', { class: 'd' }, d.date), d.title);
  }));
}

// --- 03 Asteroids ------------------------------------------------------------------
function renderAsteroids(rows) {
  const chart = $('#ast-chart'), lede = $('#ast-lede'), table = $('#ast-table'), detail = $('#ast-detail');
  const sum = rows && M.summarizeAsteroids(rows);
  if (!sum) { lede.textContent = ''; table.replaceChildren(); detail.textContent = ''; return unavailable(chart, 'The asteroid feed', capture.status.asteroids); }
  const days = capture.coverage?.asteroid_days ?? 7;
  lede.textContent =
    `${sum.count} known asteroids pass Earth in the ${days} days from ${dayOf(capture.captured)}. ` +
    `The closest, ${sum.closest.name}, comes within ${sum.closest.lunar} lunar distances (${fmt.format(sum.closest.km)} km) on ${dayOf(sum.closest.approach)}. ` +
    (sum.insideMoon ? `${sum.insideMoon} pass${sum.insideMoon === 1 ? 'es' : ''} inside the Moon's orbit. ` : '') +
    `The largest is roughly ${fmt.format(sum.largest.diameter_m)} m across.` +
    (sum.hazardous ? ` ${sum.hazardous} carry NASA's "potentially hazardous" class, which describes orbit and size, not this week's risk.` : '');

  const W = 1000, H = 380, m = { l: 62, r: 16, t: 16, b: 34 };
  const t0 = new Date(Math.min(...rows.map((r) => Date.parse(r.approach)))); t0.setUTCHours(0, 0, 0, 0);
  const span = Math.max(days, Math.ceil((Math.max(...rows.map((r) => Date.parse(r.approach))) - t0) / 864e5)) * 864e5;
  const lo = Math.log10(Math.min(0.3, ...rows.map((r) => r.lunar)) * 0.8);
  const hi = Math.log10(Math.max(...rows.map((r) => r.lunar)) * 1.15);
  const x = (t) => m.l + ((t - t0) / span) * (W - m.l - m.r);
  const y = (ld) => H - m.b - ((Math.log10(ld) - lo) / (hi - lo)) * (H - m.t - m.b);
  const maxD = Math.max(1, ...rows.map((r) => r.diameter_m));
  const rad = (d) => 3 + 18 * Math.sqrt(d / maxD);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Close approaches by date and distance' });
  for (const v of [0.1, 0.3, 1, 3, 10, 30, 100, 300]) {
    if (Math.log10(v) < lo || Math.log10(v) > hi) continue;
    svg.append(s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, `${v} LD`));
  }
  for (let t = +t0; t <= +t0 + span; t += 864e5) {
    svg.append(s('line', { class: 'grid', x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }));
    if (t < +t0 + span) svg.append(s('text', { x: x(t + 432e5), y: H - 10, 'text-anchor': 'middle' }, new Date(t).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })));
  }
  if (lo < 0 && hi > 0) svg.append(s('line', { class: 'moon', x1: m.l, x2: W - m.r, y1: y(1), y2: y(1) }), s('text', { x: W - m.r, y: y(1) - 6, 'text-anchor': 'end' }, "Moon's distance"));

  const describe = (r) => `${r.name}: ${full(r.approach)} · ${r.lunar} LD (${fmt.format(r.km)} km) · ~${fmt.format(r.diameter_m)} m · ${r.kps} km/s${r.hazardous ? ' · potentially hazardous' : ''}`;
  for (const r of [...rows].sort((a, b) => b.diameter_m - a.diameter_m)) {
    const c = s('circle', { class: `neo${r.hazardous ? ' haz' : ''}`, cx: x(Date.parse(r.approach)).toFixed(1), cy: y(r.lunar).toFixed(1), r: rad(r.diameter_m).toFixed(1), tabindex: '0', role: 'button', 'aria-label': describe(r) }, s('title', {}, describe(r)));
    const pick = () => { svg.querySelectorAll('.sel').forEach((n) => n.classList.remove('sel')); c.classList.add('sel'); detail.replaceChildren(describe(r), ' ', h('a', { href: r.url }, 'JPL record ↗')); };
    c.addEventListener('click', pick);
    c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    svg.append(c);
  }
  chart.replaceChildren(svg);
  detail.textContent = 'Select a circle for details.';

  table.replaceChildren(
    h('thead', {}, h('tr', {}, ...['Asteroid', 'Closest approach', 'Lunar dist.', 'km', 'Size (m)', 'km/s'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', { class: r.hazardous ? 'haz' : null }, h('a', { href: r.url }, r.name)),
      h('td', {}, when(r.approach)), h('td', {}, String(r.lunar)), h('td', {}, fmt.format(r.km)),
      h('td', {}, fmt.format(r.diameter_m)), h('td', {}, String(r.kps))))));
}

// --- 04 Aurora ------------------------------------------------------------------------
function loadUserPlaces() {
  try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.flatMap((p) => { try { return [M.parsePlace(`${p.name}, ${p.lat}, ${p.lon}`)]; } catch { return []; } }) : []; } catch { return []; }
}
function saveUserPlaces(list) { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage unavailable */ } }

function renderAurora() {
  const kp = capture.kp;
  const ul = $('#places'), chart = $('#kp-chart'), lede = $('#aurora-lede');
  const peak = kp ? M.peakKp(kp, Date.parse(capture.captured)) : null;
  const user = loadUserPlaces();
  const places = [...config.places.map((p) => ({ ...p, user: false })), ...user.map((p) => ({ ...p, user: true }))]
    .map((p) => M.auroraForPlace(p, config.aurora, peak?.kp ?? null));

  lede.textContent = peak
    ? `Highest forecast Kp in the three days after this capture: ${peak.kp.toFixed(1)}, around ${when(peak.t).replace(/\.$/, '')}.`
    : `No Kp forecast in this capture${capture.status.kp && capture.status.kp !== 'ok' ? ` (${capture.status.kp})` : ''}.`;
  ul.replaceChildren(...places.map((p, i) => h('li', {},
    h('div', { class: 'name' }, p.name),
    p.user ? h('button', { class: 'quiet', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => { saveUserPlaces(user.filter((_, j) => j !== i - config.places.length)); renderAurora(); } }, 'Remove') : null,
    h('div', { class: `verdict ${p.verdict.level}` }, p.verdict.text),
    h('div', { class: 'meta' }, `geomagnetic lat ${p.maglat.toFixed(1)}° · needs Kp ≈ ${p.need}+`))));

  if (!kp?.length) return chart.replaceChildren();
  const need = Math.min(...places.map((p) => p.need));
  const W = 700, H = 180, m = { l: 24, r: 6, t: 8, b: 22 };
  const bw = (W - m.l - m.r) / kp.length;
  const y = (v) => H - m.b - (v / 9) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Planetary Kp index, observed and forecast' });
  for (const v of [0, 3, 6, 9]) svg.append(s('text', { x: m.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, String(v)));
  kp.forEach((k, i) => {
    const cls = k.kind === 'predicted' ? (k.kp >= need ? 'bar hot' : 'bar predicted') : 'bar';
    svg.append(s('rect', { class: cls, x: m.l + i * bw + 0.5, y: y(k.kp), width: Math.max(bw - 1, 1), height: y(0) - y(k.kp) }, s('title', {}, `${when(k.t)} · Kp ${k.kp} (${k.kind})`)));
    const d = new Date(k.t);
    if (d.getUTCHours() === 0) svg.append(s('text', { x: m.l + i * bw, y: H - 6 }, d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })));
  });
  if (need <= 9) svg.append(s('line', { class: 'thr', x1: m.l, x2: W - m.r, y1: y(need), y2: y(need) }));
  chart.replaceChildren(svg);
}

$('#place-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('#place-input'), err = $('#place-error');
  try {
    const place = M.parsePlace(input.value);
    saveUserPlaces([...loadUserPlaces(), place]);
    input.value = ''; err.textContent = '';
    if (capture) renderAurora();
  } catch (e) { err.textContent = e.message; }
});

// --- 05 Sun -----------------------------------------------------------------------
function renderSun(sun) {
  const el = $('#sun .body');
  if (!sun) return unavailable(el, 'DONKI space weather', capture.status.sun);
  const sum = M.summarizeSun(sun);
  const missing = sun.missing || {};
  const na = (k, v) => (k in missing ? '—' : String(v));
  const days = capture.coverage?.space_weather_days ?? 30;
  el.replaceChildren(...[
    h('p', { class: 'small' }, `The ${days} days up to ${dayOf(capture.captured)}, from NASA's DONKI space-weather database.`),
    h('div', { class: 'stats' },
      ...[[na('flares', sum.x), 'X-class flares'], [na('flares', sum.m), 'M-class flares'], [na('cmes', sum.cmes), 'coronal mass ejections'], [na('storms', sum.storms), 'geomagnetic storms']]
        .map(([v, l]) => h('div', {}, h('b', {}, v), l))),
    Object.keys(missing).length ? h('p', { class: 'unavailable' }, `Not available in this capture: ${Object.keys(missing).map((k) => ({ flares: 'solar flares', storms: 'geomagnetic storms', cmes: 'CMEs' }[k])).join(', ')}.`) : null,
    'flares' in missing ? null : sum.strongest.length
      ? h('ul', { class: 'flares', 'aria-label': 'Strongest flares' }, ...sum.strongest.map((f) => h('li', {},
          h('span', { class: `cls ${f.cls[0]}` }, f.cls), h('span', {}, when(f.peak)),
          h('span', { class: 'small' }, [f.region ? `AR ${f.region}` : '', f.where || ''].filter(Boolean).join(' · ')),
          f.link ? h('a', { href: f.link, class: 'small' }, 'DONKI ↗') : null)))
      : h('p', {}, 'No flares logged in this window.'),
    h('p', { class: 'small' },
      sum.fastestCme ? `Fastest CME: ${fmt.format(sum.fastestCme.speed)} km/s on ${dayOf(sum.fastestCme.start)}. ` : '',
      sum.biggestStorm ? `Strongest storm reached Kp ${sum.biggestStorm.maxKp} on ${dayOf(sum.biggestStorm.start)}. ` : 'No geomagnetic storms recorded. ',
      'Flare classes are logarithmic: an X1 flare is ten times an M1.')].filter(Boolean));
}

// --- 06 Events ----------------------------------------------------------------------
function renderEvents(evs) {
  const list = $('#ev-list'), lede = $('#ev-lede');
  if (mapLayer) mapLayer.clearLayers();
  if (!evs) { lede.textContent = ''; return unavailable(list, 'EONET', capture.status.events); }
  const region = capture.coverage?.events || 'the configured region';
  lede.textContent = evs.length
    ? `NASA's Earth Observatory Natural Event Tracker listed ${evs.length} open events in or near ${region}: ${M.countBy(evs, 'category').map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}.`
    : `No open events in or near ${region} at capture time.`;

  if (window.L && !map) {
    map = L.map('map', { scrollWheelZoom: false, worldCopyJump: true }).setView([58, -96], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
  } else if (!window.L) $('#map').replaceChildren(h('p', { class: 'unavailable', style: 'padding:1rem' }, "The map library didn't load."));

  const markers = evs.map((e) => {
    if (!mapLayer) return null;
    const pop = h('div', {}, h('strong', {}, e.title), h('br'), `${e.category} · ${e.date ? dayOf(e.date) : ''}${e.magnitude ? ` · ${e.magnitude}` : ''}`,
      e.source ? h('div', {}, h('a', { href: e.source }, 'Source ↗')) : null);
    return L.circleMarker([e.lat, e.lon], { radius: 7, weight: 1.5, fillOpacity: 0.6, color: e.category === 'Wildfires' ? '#c2410c' : '#2f7d95' }).bindPopup(pop).addTo(mapLayer);
  });
  if (map && evs.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25), { maxZoom: 5 });

  list.replaceChildren(...evs.map((e, i) => h('li', {}, h('button', { type: 'button', onclick: () => { if (markers[i]) { map.setView(markers[i].getLatLng(), 6); markers[i].openPopup(); } } },
    h('span', { class: 'cat' }, `${e.category}${e.date ? ` · ${dayOf(e.date)}` : ''}`), e.title))));
}

// --- Capture selection --------------------------------------------------------------
async function getJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  return r.json();
}

async function show(date) {
  const note = $('#capture-note');
  note.textContent = 'Loading…';
  try {
    capture = await getJson(`./data/captures/${encodeURIComponent(date)}.json`);
  } catch (e) { note.textContent = `Couldn't load the ${date} capture.`; return; }
  const failed = M.SOURCES.filter((k) => capture.status[k] !== 'ok').map((k) => ({ apod: 'astronomy picture', sun: 'space weather', kp: 'Kp forecast', events: 'natural events', earth: 'EPIC image' }[k] || k));
  note.textContent = `Fetched ${full(capture.captured)}.${failed.length ? ` Unavailable in this capture: ${failed.join(', ')}.` : ''}`;
  for (const [name, fn] of [['earth', renderEarth], ['apod', renderApod], ['asteroids', renderAsteroids], ['sun', renderSun], ['events', renderEvents]]) {
    try { fn(capture[name]); } catch (e) { console.error(name, e); }
  }
  try { renderAurora(); } catch (e) { console.error('aurora', e); }
  try { const u = new URL(location.href); if (u.searchParams.get('capture') !== date) { u.searchParams.set('capture', date); history.replaceState(null, '', u); } } catch { /* ignore */ }
}

try {
  config = await getJson('./config.json');
  const index = await getJson('./data/index.json');
  const sel = $('#capture');
  if (!index.captures?.length) throw new Error('no captures');
  sel.replaceChildren(...index.captures.map((c, i) => h('option', { value: c.date }, `${c.date}${i === 0 ? ' (latest)' : ''}`)));
  const wanted = new URL(location.href).searchParams.get('capture');
  sel.value = index.captures.some((c) => c.date === wanted) ? wanted : index.captures[0].date;
  sel.disabled = index.captures.length < 2;
  sel.addEventListener('change', () => show(sel.value));
  await show(sel.value);
} catch (e) {
  $('#capture').replaceChildren(h('option', {}, 'None'));
  $('#capture-note').textContent = 'No data has been captured yet. The scheduled build fetches it from NASA.';
  console.error(e);
}
