#!/usr/bin/env bash
#
# Deploys the API and the web dashboard to the production server.
#
#   npm run deploy:prod
#   npm run deploy:prod -- --skip-checks     # skip the local typecheck
#   npm run deploy:prod -- --env booth       # another environment (.deploy.booth.env)
#
# Everything is built here and only the output is shipped — the server has
# too little memory to run `next build`. Production layout (systemd):
#
#   /opt/voter-management/api        voter-api.service  → node dist/server.js
#     dist/  prisma/  prisma.config.ts  vendor/voter-shared/  node_modules/  .env
#   /opt/voter-management/web        voter-web.service  → node apps/web/server.js
#     (a Next.js standalone build)
#
# The server's api/.env and node_modules are never touched. Before anything
# changes, the database is dumped and the current api/dist, api/vendor and web
# are copied aside with a timestamp, so a bad deploy can be rolled back.
#
# Settings come from .deploy.env (gitignored — see .deploy.env.example), plus
# .deploy.NAME.env with --env NAME (see scripts/deploy-env.sh). The paths and
# service names above are the defaults for the original environment.
# Authentication is by SSH key only; no password is read or stored here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=deploy-env.sh
source scripts/deploy-env.sh "$@"
# Deploy backups of api/dist, api/vendor and web kept on the server.
KEEP_BACKUPS="${KEEP_BACKUPS:-3}"

SKIP_CHECKS=false
# --api-only: build, upload, migrate and restart the API; leave the dashboard untouched.
API_ONLY=false
for arg in "${ARGS[@]+"${ARGS[@]}"}"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=true ;;
    --api-only) API_ONLY=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST")
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

step "Checking SSH access to $DEPLOY_HOST"
if ! "${SSH[@]}" true 2>/dev/null; then
  echo "Can't log in to $DEPLOY_HOST with an SSH key (DEPLOY_KEY=${DEPLOY_KEY:-default})." >&2
  exit 1
fi

step "Building shared schemas and the Prisma client"
npm run build -w @voter/shared >/dev/null
npm exec -w @voter/api -- prisma generate >/dev/null

if [[ "$SKIP_CHECKS" == false ]]; then
  step "Typechecking"
  if [[ "$API_ONLY" == true ]]; then
    npm run typecheck -w @voter/shared -w @voter/api
  else
    npm run typecheck -w @voter/shared -w @voter/api -w @voter/web
  fi
fi

step "Building the API"
rm -rf apps/api/dist
npm run build -w @voter/api

if [[ "$API_ONLY" == false ]]; then
  step "Building the dashboard"
  npm run build -w @voter/web
fi

step "Staging the release"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/api/vendor/voter-shared" "$STAGE/web"
cp -R apps/api/dist "$STAGE/api/dist"
cp -R apps/api/prisma "$STAGE/api/prisma"
cp apps/api/prisma.config.ts "$STAGE/api/"
cp packages/shared/package.json "$STAGE/api/vendor/voter-shared/"
cp -R packages/shared/dist "$STAGE/api/vendor/voter-shared/dist"

if [[ "$API_ONLY" == false ]]; then
  # Next's standalone output leaves static assets and public/ for us to add.
  cp -R apps/web/.next/standalone/. "$STAGE/web/"
  cp -R apps/web/.next/static "$STAGE/web/apps/web/.next/static"
  [[ -d apps/web/public ]] && cp -R apps/web/public "$STAGE/web/apps/web/public"
  # Installers for the /download page (~300 MB) are uploaded on their own below.
  rm -rf "$STAGE/web/apps/web/downloads"
fi

RELEASE="$(date +%Y%m%d-%H%M%S)"
REMOTE_STAGE="/tmp/voter-release-$RELEASE"

step "Uploading release $RELEASE"
rsync -az -e "$RSYNC_SSH" "$STAGE/" "$DEPLOY_HOST:$REMOTE_STAGE/"

# Installers go to a folder kept on the server, so a deploy only sends the ones
# that changed; --partial lets an interrupted upload resume on the next run.
if [[ "$API_ONLY" == false && "$UPLOAD_DOWNLOADS" == true && -d apps/web/downloads ]]; then
  step "Uploading desktop installers (only changed files)"
  rsync -az --partial --progress --delete -e "$RSYNC_SSH" apps/web/downloads/ "$DEPLOY_HOST:$DEPLOY_PATH/downloads/"
fi

# The desktop app's licence leases are signed with LICENSE_SIGNING_KEY. The server
# keeps its own .env, so copy the key there once if it is missing (never printed).
KEYLINE="$(grep '^LICENSE_SIGNING_KEY=' apps/api/.env 2>/dev/null || true)"
if [[ -n "$KEYLINE" ]]; then
  printf '%s\n' "$KEYLINE" | "${SSH[@]}" "F='$DEPLOY_PATH/api/.env'; if grep -q '^LICENSE_SIGNING_KEY=' \"\$F\" 2>/dev/null; then cat >/dev/null; echo '  LICENSE_SIGNING_KEY already on the server'; else cat >> \"\$F\"; echo '  LICENSE_SIGNING_KEY copied to the server'; fi"
fi

step "Backing up, migrating and switching over on the server"
"${SSH[@]}" bash -s -- "$DEPLOY_PATH" "$BACKUP_DIR" "$REMOTE_STAGE" "$RELEASE" "$KEEP_BACKUPS" "$API_ONLY" "$API_SERVICE" "$WEB_SERVICE" <<'REMOTE'
set -euo pipefail
DEPLOY_PATH="$1" BACKUP_DIR="$2" STAGE="$3" RELEASE="$4" KEEP="$5" API_ONLY="${6:-false}"
API_SERVICE="$7" WEB_SERVICE="$8"
API="$DEPLOY_PATH/api"
WEB="$DEPLOY_PATH/web"

echo "• Dumping the database"
mkdir -p "$BACKUP_DIR"
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$API/.env" | head -1 | cut -d= -f2- | tr -d "\"'")"
DUMP="$BACKUP_DIR/voter-$RELEASE.sql.gz"
# pg_dump rejects Prisma's ?schema= query string.
pg_dump "${DATABASE_URL%%\?*}" | gzip > "$DUMP"
echo "  $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "• Keeping the current release aside"
cp -a "$API/dist" "$API/dist.backup-$RELEASE"
cp -a "$API/vendor" "$API/vendor.backup-$RELEASE"
[[ "$API_ONLY" == true ]] || cp -a "$WEB" "$WEB.backup-$RELEASE"

echo "• Installing the new API files"
rsync -a --delete "$STAGE/api/dist/" "$API/dist/"
rsync -a --delete "$STAGE/api/prisma/" "$API/prisma/"
cp "$STAGE/api/prisma.config.ts" "$API/prisma.config.ts"
rsync -a --delete "$STAGE/api/vendor/voter-shared/" "$API/vendor/voter-shared/"
# The API resolves @voter/shared through node_modules; keep that copy current too.
if [[ -d "$API/node_modules/@voter/shared" && ! -L "$API/node_modules/@voter/shared" ]]; then
  rsync -a --delete "$STAGE/api/vendor/voter-shared/" "$API/node_modules/@voter/shared/"
fi

echo "• Applying database migrations"
(cd "$API" && ./node_modules/.bin/prisma migrate deploy)

if [[ "$API_ONLY" == true ]]; then
  echo "• Restarting the API (dashboard left as is)"
  systemctl restart "$API_SERVICE"
  sleep 4
  systemctl is-active "$API_SERVICE"
else
  echo "• Installing the new dashboard"
  if [[ -d "$DEPLOY_PATH/downloads" ]]; then
    mkdir -p "$STAGE/web/apps/web/downloads"
    rsync -a "$DEPLOY_PATH/downloads/" "$STAGE/web/apps/web/downloads/"
  fi
  rsync -a --delete "$STAGE/web/" "$WEB/"

  echo "• Restarting services"
  systemctl restart "$API_SERVICE" "$WEB_SERVICE"
  sleep 4
  systemctl is-active "$API_SERVICE" "$WEB_SERVICE"
fi

echo "• Pruning old deploy backups (keeping $KEEP)"
for pattern in "$API/dist.backup-" "$API/vendor.backup-" "$WEB.backup-"; do
  ls -d "$pattern"* 2>/dev/null | sort | head -n "-$KEEP" | xargs -r rm -rf
done
rm -rf "$STAGE"

echo
echo "  Roll back with:"
echo "    rsync -a --delete $API/dist.backup-$RELEASE/ $API/dist/ && \\"
echo "    rsync -a --delete $API/vendor.backup-$RELEASE/ $API/vendor/ && \\"
echo "    rsync -a --delete $WEB.backup-$RELEASE/ $WEB/ && systemctl restart $API_SERVICE $WEB_SERVICE"
echo "    (the database dump is $DUMP)"
REMOTE

step "Health checks"
sleep 3
failed=false
[[ "$API_ONLY" == true ]] && WEB_HEALTH_URL=""
for url in "$API_HEALTH_URL" "$WEB_HEALTH_URL"; do
  [[ -z "$url" ]] && continue
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
  if [[ "$code" =~ ^(200|204|307|308)$ ]]; then
    echo "  ✓ $url ($code)"
  else
    echo "  ✗ $url ($code)"
    failed=true
  fi
done

if [[ "$failed" == true ]]; then
  echo "Deploy finished but a health check failed — see: ssh $DEPLOY_HOST journalctl -u $API_SERVICE -u $WEB_SERVICE -n 50" >&2
  exit 1
fi

printf '\n\033[1;32m✓ Release %s is live on %s\033[0m\n' "$RELEASE" "$DEPLOY_HOST"
