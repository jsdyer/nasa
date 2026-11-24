# NASA Overhead

A daily NASA briefing for Canada, published at **https://coolcode.ca/nasa/**. Each section draws on a different public source:

| # | Section | Source |
|---|---------|--------|
| 01 | Earth from a million miles: the day's full-disc frame centred nearest Canada | NASA EPIC (DSCOVR at Sun–Earth L1) |
| 02 | Astronomy Picture of the Day | NASA APOD |
| 03 | Asteroids passing Earth this week: date vs. distance, Moon's orbit marked | NASA NeoWs (JPL close-approach data) |
| 04 | Aurora outlook for Vancouver, Halifax and any place you add | NOAA SWPC planetary Kp forecast |
| 05 | The Sun over the last 30 days: flares, CMEs, geomagnetic storms | NASA DONKI |
| 06 | Open natural events (wildfires, storms, sea ice) on a map | NASA EONET |
| 07 | Recent astronomy pictures | NASA APOD |

## Reading the results

<!-- coolcode:guide -->
Each day's build saves a dated capture. Use the Capture menu to compare earlier days. The asteroid chart plots each close approach by date and by distance in lunar distances (LD, about 384,400 km) on a log scale. Anything below the dashed line passes inside the Moon's orbit. "Potentially hazardous" is NASA's orbital class, not a risk for this week. For the aurora, a city with a geomagnetic latitude of about 54° (Vancouver, Halifax) typically needs Kp 6 or higher to see a glow on the northern horizon. Add your own place as "Name, latitude, longitude", for example "Whitehorse, 60.72, -135.06".
APOD uses NASA’s APOD Basic feed: each entry links to its dated article, with an image, video, or article-only fallback. A successful daily capture can contain a source error; its public source results show which feeds were unavailable.
<!-- /coolcode:guide -->

The aurora threshold is a rule of thumb, not a forecast: Kp ≈ (66° − |geomagnetic latitude|) ÷ 2. Geomagnetic latitude comes from a centred-dipole model with the north geomagnetic pole at 80.8°N, 72.7°W (IGRF, 2025). Clouds, moonlight and city light matter as much as Kp.

## How it works

```
GitHub Actions (daily 13:17 UTC, on push to main, or run by hand)
  └─ scripts/refresh.mjs   NASA_API_KEY → NASA + NOAA → validate → .cache/captures/<date>.json
  └─ scripts/build.py      web/ (+ web/data/) → dist/ → GitHub Pages → coolcode.ca/nasa/
```

- **The key never reaches the browser.** `refresh.mjs` runs only in Actions, and the published site holds only the fetched JSON. Visitors send no NASA requests.
- **Each source is fetched independently.** If one fails, its section says so and names the error. If fewer than `min_sources` succeed, or the data fails validation, the job fails and the previous deployment stays live.
- **APOD migration:** pictures use NASA's [APOD Basic API](https://science.nasa.gov/wp-json/wp/v2/apod-basic), replacing the legacy endpoint being retired on 1 December 2026. Its `url`/`permalink` is the article; `hdurl` is an optional image. Direct video and iframe URLs are extracted from `basic_html` without inserting that HTML into the app. Entries without usable media keep their article link. Dates are checked against the requested seven-day window. APOD needs no key; the repository key is still used by the other NASA APIs.
- **Partial source failures:** DONKI feeds try api.nasa.gov, then NASA CCMC directly. Failed feeds remain visible in the capture and public index, including individual Sun feeds. A publishable capture can still have a failed source; the admin reports this separately from workflow success.
- **Captures persist** in the Actions cache: one per UTC day (a rerun the same day replaces it), keeping the newest `keep_captures`. Each capture records its own coverage, so older ones still read correctly after you change the configuration.
- The page is plain HTML, CSS and ES modules. Leaflet 1.9.4 is vendored under `web/vendor/leaflet/`, so no CDN is used. Map tiles come from OpenStreetMap, and images load directly from NASA.

## Expand or customize

All defaults live in **`web/config.json`**:

| Key | Meaning | Change takes effect |
|---|---|---|
| `places` | Places with aurora cards shown to every visitor (`name`, `lat`, `lon`). Visitors can add their own in the page, saved in their browser as `coolcode:nasa:places`. | next deploy (push) |
| `aurora` | Geomagnetic pole and the rule-of-thumb constants. | next deploy (push) |
| `events.bbox`, `events.label`, `events.days` | Region and lookback for EONET events. For example, set `{"west": -170, "south": 15, "east": -50, "north": 84}` and `"label": "North America"`. | next capture |
| `apod_days`, `asteroid_days` (max 7, a NeoWs limit), `space_weather_days` | Lookback and lookahead windows. | next capture |
| `earth_target_longitude` | Which EPIC frame to feature (−100 is central Canada; −64 favours the Maritimes). | next capture |
| `keep_captures` | How many daily captures to keep. | next capture |
| `min_sources` | How many of the six sources must succeed before a capture can be published. | next capture |

A push to `main` runs the full workflow: tests, a fresh capture, build and deploy. So both kinds of change go live on the next push. To refresh without pushing, go to **Actions → Browser tool · Check and publish → Run workflow** on `main`.

To add a place for everyone, append it to `places`, for example `{ "name": "Whitehorse", "lat": 60.72, "lon": -135.06 }`, then push. `tests/model.test.mjs` checks places beyond the starter two.

## Publish and register

1. **Settings → Secrets and variables → Actions → Secrets:** `NASA_API_KEY`. The workflow uses the secret and falls back to a variable of the same name if no secret exists. Keep it as a secret only and delete the variable, because variables are stored in plain text and are not masked in logs.
2. **Settings → Pages → Build and deployment → Source → GitHub Actions.**
3. Push to `main`, or run the workflow by hand. Then check https://coolcode.ca/nasa/.
4. Copy the reviewed `tool.json` object into `data/tools.json` in [jsdyer.github.io](https://github.com/jsdyer/jsdyer.github.io), then run `python3 scripts/sync_guides.py --tool nasa` and `python3 scripts/sync_readme.py` there.

GitHub pauses scheduled workflows in public repositories after 60 days without activity. If captures stop, run the workflow by hand or push a commit. To handle this automatically from your own server, see [`ops/keepalive/`](ops/keepalive/README.md): a monthly systemd timer that re-enables and runs the workflow, then checks that the new capture was published.

## Develop and test

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
node scripts/refresh.mjs --fixtures tests/fixtures/raw --now 2026-11-23T15:00:00Z   # offline sample capture
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

For a real capture locally, run `NASA_API_KEY=… node scripts/refresh.mjs` before building. `tests/browser_smoke.py` (Playwright, test-only) serves the build at `/nasa/` with fixture data. It checks every section, the capture menu, adding and removing places, that NASA's text renders as plain text, and the mobile layout. `tests/fixtures/raw/` holds saved API response shapes, including deliberately hostile titles.

## Files

| Path | Purpose |
| --- | --- |
| `web/config.json` | Places, region, windows and retention |
| `web/model.mjs` | All parsing, validation and calculations (shared by the page and refresh) |
| `web/app.mjs` | DOM rendering; text is set with `textContent` only |
| `scripts/refresh.mjs` | Fetch, validate and publish a dated capture into `web/data/` |
| `scripts/build.py` | Build `web/` into `dist/` (from the CoolCode template) |
| `tests/` | Model, refresh, builder and browser tests, plus fixtures |
| `.github/workflows/pages.yml` | Test, capture, build and deploy |

Data: NASA (APOD, NeoWs, DONKI, EPIC, EONET) via api.nasa.gov and eonet.gsfc.nasa.gov, and NOAA SWPC. APOD images can carry their own copyright, shown where NASA provides it. Leaflet is BSD-2-Clause (`web/vendor/leaflet/LICENSE`).

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
