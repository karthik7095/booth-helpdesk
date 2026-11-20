#!/usr/bin/env bash
#
# Runs a SQL file, or shows the roll's activity counts, on the production
# database. Uses the SSH settings from .deploy.env like the deploy script.
#
#   bash scripts/prod-sql.sh check                          # counts only, changes nothing
#   bash scripts/prod-sql.sh run scripts/sample-data.sql 60  # a file, with assembly_no
#   bash scripts/prod-sql.sh run scripts/sample-data-cleanup.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .deploy.env ]]; then
  echo "Missing .deploy.env — copy .deploy.env.example and fill it in." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .deploy.env
: "${DEPLOY_HOST:?Set DEPLOY_HOST in .deploy.env}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/voter-management}"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)

# The remote side reads the API's own DATABASE_URL; pg tools reject Prisma's
# ?schema= suffix, so it is stripped.
REMOTE_DB='DB="$(grep -E "^DATABASE_URL=" '"$DEPLOY_PATH"'/api/.env | head -1 | cut -d= -f2- | tr -d "\"'"'"'")"; DB="${DB%%\?*}"'

mode="${1:-check}"

case "$mode" in
  check)
    ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "$REMOTE_DB"'; psql "$DB" <<"SQL"
SELECT a.assembly_no, a.e_assemblyname AS name,
       (SELECT count(*) FROM voters v WHERE v.assembly_id = a.id) AS voters,
       (SELECT count(*) FROM voters v WHERE v.assembly_id = a.id AND has_voted) AS voted,
       (SELECT count(*) FROM slip_prints p WHERE p.assembly_id = a.id) AS prints,
       (SELECT count(*) FROM login_sessions s JOIN access_pins ap ON ap.id = s.access_pin_id
         WHERE ap.assembly_id = a.id AND s.id LIKE '"'"'sample-agent-%'"'"') AS sample_agents
FROM assemblies a ORDER BY a.assembly_no;
SQL'
    ;;
  run)
    file="${2:?Usage: prod-sql.sh run <file.sql> [assembly_no]}"
    assembly_no="${3:-}"
    remote="/tmp/$(basename "$file")"
    scp -q "${SSH_OPTS[@]}" "$file" "$DEPLOY_HOST:$remote"
    vars=()
    [[ -n "$assembly_no" ]] && vars=(-v "assembly_no=$assembly_no")
    ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "$REMOTE_DB"'; psql "$DB" '"${vars[*]:-}"' -f '"$remote"' && rm -f '"$remote"
    ;;
  *)
    echo "Unknown mode: $mode (use check or run)" >&2
    exit 1
    ;;
esac
