#!/usr/bin/env bash
# Monthly keep-alive for coolcode.ca/nasa, run from your own server.
# GitHub pauses scheduled workflows in public repos after 60 days without
# activity. This re-enables the daily workflow (a no-op if it's already on),
# runs it once, waits for the new capture to publish, and reports any NASA
# sources that failed. Exits non-zero if the capture didn't publish.
#
# Needs: curl, jq, GNU date. GITHUB_TOKEN: a fine-grained token limited to
# jsdyer/nasa with "Actions: Read and write" (nothing else).
set -euo pipefail

REPO="${NASA_REPO:-jsdyer/nasa}"
WORKFLOW="${NASA_WORKFLOW:-pages.yml}"
INDEX="${NASA_INDEX_URL:-https://coolcode.ca/nasa/data/index.json}"
WAIT_MINUTES="${NASA_WAIT_MINUTES:-25}"
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN (fine-grained, Actions: read and write on $REPO)}"

api() {
  curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" "$@"
}
built_epoch() {
  local b
  b=$(curl -fsS "$INDEX?t=$(date +%s)" | jq -r '.built // empty') || return 1
  [ -n "$b" ] && date -d "$b" +%s
}

start=$(date +%s)
api -X PUT "https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/enable" >/dev/null
api -X POST "https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" -d '{"ref":"main"}' >/dev/null
echo "Re-enabled and started $WORKFLOW on $REPO; waiting up to ${WAIT_MINUTES} min for a new capture…"

for ((i = 0; i < WAIT_MINUTES; i++)); do
  sleep 60
  b=$(built_epoch || echo 0)
  if (( b >= start )); then
    json=$(curl -fsS "$INDEX?t=$(date +%s)")
    echo "NASA Overhead OK: capture published $(jq -r .built <<<"$json"), $(jq '.captures | length' <<<"$json") captures kept."
    failing=$(jq -r '.captures[0].status | to_entries[] | select(.value != "ok") | "  \(.key): \(.value[0:160])"' <<<"$json")
    [ -n "$failing" ] && printf 'Sources unavailable in this capture:\n%s\n' "$failing"
    exit 0
  fi
done

echo "NASA Overhead: no new capture after ${WAIT_MINUTES} min. Check https://github.com/$REPO/actions" >&2
exit 1
