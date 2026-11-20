#!/usr/bin/env bash
#
# Installs or updates the self-hosted OCR service (services/ocr) on the
# production server, next to the API:
#
#   npm run deploy:ocr
#
#   /opt/voter-management/ocr    voter-ocr.service -> venv/bin/python server.py
#     server.py  requirements.txt  venv/  python/ (uv-managed 3.11)  cache/ (models)
#
# The service listens on 127.0.0.1:4500 only; the API proxies to it after the
# desktop licence check. It runs as the unprivileged voter-ocr user, capped at
# 3.5 GB of memory and 3 cores (see voter-ocr.service). The server's system
# Python is 3.9, so a standalone 3.11 is installed with uv. PyTorch comes from
# the CPU-only index. Safe to re-run: unchanged dependencies are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .deploy.env ]] || { echo "Missing .deploy.env" >&2; exit 1; }
# shellcheck disable=SC1091
source .deploy.env
: "${DEPLOY_HOST:?Set DEPLOY_HOST in .deploy.env}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/voter-management}"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

step "Uploading services/ocr"
rsync -az -e "ssh ${SSH_OPTS[*]}" services/ocr/server.py services/ocr/requirements.txt services/ocr/voter-ocr.service "$DEPLOY_HOST:$DEPLOY_PATH/ocr/"

step "Installing on the server"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s -- "$DEPLOY_PATH/ocr" <<'REMOTE'
set -euo pipefail
DIR="$1"
cd "$DIR"
id voter-ocr >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --shell /sbin/nologin voter-ocr

if [[ ! -x bootstrap/bin/uv ]]; then
  echo "• bootstrapping uv"
  python3 -m venv bootstrap && bootstrap/bin/pip install -q --upgrade pip uv
fi
export UV_PYTHON_INSTALL_DIR="$DIR/python" UV_CACHE_DIR="$DIR/uv-cache"
if [[ ! -x venv/bin/python ]]; then
  echo "• creating a Python 3.11 environment"
  bootstrap/bin/uv python install 3.11
  bootstrap/bin/uv venv -q --python 3.11 venv
fi

HASH="$(sha256sum requirements.txt | cut -c1-16)"
if [[ "$(cat .requirements.hash 2>/dev/null)" != "$HASH" ]]; then
  echo "• installing CPU PyTorch and Surya (first run downloads ~1 GB)"
  bootstrap/bin/uv pip install -q --python venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch
  bootstrap/bin/uv pip install -q --python venv/bin/python -r requirements.txt
  echo "$HASH" > .requirements.hash
else
  echo "• dependencies unchanged"
fi

mkdir -p cache
chown -R voter-ocr:voter-ocr "$DIR"
install -m 644 voter-ocr.service /etc/systemd/system/voter-ocr.service
systemctl daemon-reload
systemctl enable voter-ocr >/dev/null 2>&1
systemctl restart voter-ocr

echo "• waiting for the models to load (the first start downloads them)"
for i in $(seq 1 120); do
  if curl -fsS -m 5 http://127.0.0.1:4500/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:4500/health; echo
    systemctl show voter-ocr -p MemoryCurrent -p MemoryMax
    exit 0
  fi
  systemctl is-active --quiet voter-ocr || { journalctl -u voter-ocr -n 40 --no-pager; exit 1; }
  sleep 5
done
echo "OCR service did not become healthy in 10 minutes" >&2
journalctl -u voter-ocr -n 40 --no-pager
exit 1
REMOTE

printf '\n\033[1;32m✓ OCR service is running on %s (127.0.0.1:4500)\033[0m\n' "$DEPLOY_HOST"
