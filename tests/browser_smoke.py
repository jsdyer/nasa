"""Exercise the built tool at a project subpath in Chromium, using offline fixture data."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / "browser-checks"
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        site = Path(temporary) / "nasa"
        shutil.copytree(ROOT / "dist", site)
        shutil.rmtree(site / "data", ignore_errors=True)
        for now in ("2026-11-22T15:00:00Z", "2026-11-23T15:00:00Z"):
            subprocess.run(["node", str(ROOT / "scripts/refresh.mjs"), "--fixtures", str(ROOT / "tests/fixtures/raw"),
                            "--cache", str(Path(temporary) / "cache"), "--out", str(site / "data"), "--now", now],
                           check=True, capture_output=True)
        # Exercise a direct-video entry from the replacement APOD contract.
        older = site / 'data/captures/2026-11-22.json'
        payload = json.loads(older.read_text())
        payload['apod'][0].update(media_type='video', url='https://assets.science.nasa.gov/sample.mp4',
                                  page_url='https://science.nasa.gov/image-article/sample/', hdurl=None)
        older.write_text(json.dumps(payload))
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={"width": 1280, "height": 1000})
                page.route("**/*", lambda route: route.abort() if "127.0.0.1" not in route.request.url else route.continue_())
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/nasa/")
                page.wait_for_selector("#ast-chart svg")

                # Capture selector lists both captures, newest first, and shows the fetch time.
                assert page.locator("#capture option").count() == 2
                assert page.locator("#capture").input_value() == "2026-11-23"
                assert "Fetched" in page.locator("#capture-note").inner_text()

                # Every section rendered from the capture.
                assert page.locator("#ast-chart .neo").count() > 40
                assert page.locator("#places li").count() == 2
                assert page.locator("#kp-chart rect").count() == 56
                assert page.locator(".flares li").count() == 5
                assert page.locator("#ev-list li").count() == 6
                assert page.locator("#week .strip a").count() == 7

                # Untrusted NASA text is shown as text, never parsed as markup.
                assert "<img src=x" in page.locator("#apod h3").inner_text()
                assert page.locator("img[onerror]").count() == 0
                assert page.locator("#ev-list b").count() == 0

                # Visitors can add places beyond the configured ones; bad input is explained.
                for text in ("Whitehorse, 60.72, -135.06", "Hobart, Tasmania, -42.88, 147.33"):
                    page.fill("#place-input", text)
                    page.click("#place-form button")
                assert page.locator("#places li").count() == 4
                page.fill("#place-input", "nowhere")
                page.click("#place-form button")
                assert "latitude" in page.locator("#place-error").inner_text()
                page.reload()
                page.wait_for_selector("#places li")
                assert page.locator("#places li").count() == 4, "added places persist"
                page.get_by_role("button", name="Remove Whitehorse").click()
                assert page.locator("#places li").count() == 3

                # Selecting an asteroid shows its details; switching capture keeps working.
                page.locator("#ast-chart .neo").first.click()
                assert "LD" in page.locator("#ast-detail").inner_text()
                page.select_option("#capture", "2026-11-22")
                page.wait_for_function("document.querySelector('#capture-note').textContent.includes('Nov 22')")
                assert "capture=2026-11-22" in page.url
                page.wait_for_selector('#apod video')
                assert page.locator('#apod video').get_attribute('src').endswith('/sample.mp4')
                assert page.locator('#apod video').get_attribute('controls') is not None
                assert page.get_by_role('link', name='APOD article ↗').get_attribute('href') == 'https://science.nasa.gov/image-article/sample/'


                page.screenshot(path=str(screenshots / "desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(screenshots / "mobile.png"), full_page=True)
                assert not errors, errors
                browser.close()
            print("Browser checks passed: subpath, captures, all sections, safe text, places and mobile layout")
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
