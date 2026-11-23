# Monthly keep-alive on your own server

GitHub pauses scheduled workflows in public repositories after 60 days without activity. Once a month, `nasa-keepalive.sh` re-enables the daily workflow (a no-op if it's already on), runs it, waits for the new capture to appear on coolcode.ca, and lists any NASA sources that failed. If no new capture appears, it exits non-zero, so systemd marks the run as failed.

## Install (AlmaLinux / any systemd host)

1. Create a fine-grained GitHub token: **Settings → Developer settings → Fine-grained tokens**. Give it access to `jsdyer/nasa` only, with **Actions: Read and write**.
2. Install curl and jq: `sudo dnf install -y curl jq`
3. Install the files, from a clone of this repo:

```sh
sudo install -m 0755 ops/keepalive/nasa-keepalive.sh /usr/local/bin/
sudo install -m 0644 ops/keepalive/nasa-keepalive.{service,timer} /etc/systemd/system/
sudo install -m 0600 /dev/null /etc/nasa-keepalive.env
echo 'GITHUB_TOKEN=github_pat_…' | sudo tee /etc/nasa-keepalive.env >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now nasa-keepalive.timer
```

4. Test it once: `sudo systemctl start nasa-keepalive.service && journalctl -u nasa-keepalive -n 20`

`systemctl list-timers nasa-keepalive.timer` shows the next run (the 1st of each month, 13:27 Pacific, within a 15-minute random delay). `Persistent=true` catches up after downtime.

Optional settings in `/etc/nasa-keepalive.env`: `NASA_WAIT_MINUTES` (default 25), `NASA_REPO`, `NASA_WORKFLOW`, `NASA_INDEX_URL`.

Prefer cron? Use `27 13 1 * * GITHUB_TOKEN=… /usr/local/bin/nasa-keepalive.sh` with `CRON_TZ=America/Vancouver`. Keep the token out of world-readable files.
