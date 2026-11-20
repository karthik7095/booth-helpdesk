#!/usr/bin/env bash
#
# Installs or updates the name transliteration service (services/xlit) on the
# production server, next to the API and the OCR service:
#
#   npm run deploy:xlit
#
#   /opt/voter-management/xlit   voter-xlit.service -> venv/bin/python server.py
#     server.py  xlit.py  requirements.txt  venv/  python/ (uv-managed 3.10)
#
# The service listens on 127.0.0.1:4600 only; the API proxies to it after the
# desktop licence check (POST /api/ocr/transliterate). It runs as the
# unprivileged voter-xlit user, capped at 1.2 GB and one core. fairseq (under
# ai4bharat-transliteration) does not import on Python 3.11+, so a standalone
# 3.10 is installed with uv, and its metadata needs pip < 24.1. The first start
# downloads the IndicXlit model (~130 MB) into the venv. Safe to re-run.
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

step "Uploading services/xlit"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" mkdir -p "$DEPLOY_PATH/xlit"
rsync -az -e "ssh ${SSH_OPTS[*]}" services/xlit/server.py services/xlit/xlit.py services/xlit/requirements.txt services/xlit/voter-xlit.service "$DEPLOY_HOST:$DEPLOY_PATH/xlit/"

step "Installing on the server"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s -- "$DEPLOY_PATH/xlit" <<'REMOTE'
set -euo pipefail
DIR="$1"
cd "$DIR"
id voter-xlit >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --shell /sbin/nologin voter-xlit

if [[ ! -x bootstrap/bin/uv ]]; then
  echo "• bootstrapping uv"
  python3 -m venv bootstrap && bootstrap/bin/pip install -q --upgrade pip uv
fi
export UV_PYTHON_INSTALL_DIR="$DIR/python" UV_CACHE_DIR="$DIR/uv-cache"
if [[ ! -x venv/bin/python ]]; then
  echo "• creating a Python 3.10 environment"
  bootstrap/bin/uv python install 3.10
  bootstrap/bin/uv venv -q --seed --python 3.10 venv
fi

HASH="$(sha256sum requirements.txt | cut -c1-16)"
if [[ "$(cat .requirements.hash 2>/dev/null)" != "$HASH" ]]; then
  echo "• installing CPU PyTorch and IndicXlit"
  venv/bin/python -m pip install -q "pip<24.1" setuptools wheel
  venv/bin/python -m pip install -q --index-url https://download.pytorch.org/whl/cpu torch
  venv/bin/python -m pip install -q -r requirements.txt
  echo "$HASH" > .requirements.hash
else
  echo "• dependencies unchanged"
fi

chown -R voter-xlit:voter-xlit "$DIR"
install -m 644 voter-xlit.service /etc/systemd/system/voter-xlit.service
systemctl daemon-reload
systemctl enable voter-xlit >/dev/null 2>&1
systemctl restart voter-xlit

echo "• waiting for the model to load (the first start downloads it)"
for i in $(seq 1 60); do
  if curl -fsS -m 5 http://127.0.0.1:4600/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:4600/health; echo
    curl -fsS -X POST http://127.0.0.1:4600/transliterate -d '{"lang":"te","words":["Venkata","Ramana"]}'; echo
    systemctl show voter-xlit -p MemoryCurrent -p MemoryMax
    exit 0
  fi
  systemctl is-active --quiet voter-xlit || { journalctl -u voter-xlit -n 40 --no-pager; exit 1; }
  sleep 5
done
echo "Transliteration service did not become healthy in 5 minutes" >&2
journalctl -u voter-xlit -n 40 --no-pager
exit 1
REMOTE

printf '\n\033[1;32m✓ Transliteration service is running on %s (127.0.0.1:4600)\033[0m\n' "$DEPLOY_HOST"
