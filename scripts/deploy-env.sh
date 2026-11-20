# Sourced by the deploy scripts. Loads .deploy.env (host and SSH key) and,
# with `--env NAME`, layers .deploy.NAME.env on top so a second client's
# environment on the same server can override paths, ports, services and the
# domain. Remaining arguments are left in ARGS.
#
#   npm run deploy:prod -- --env booth
#
# Defaults below describe the original environment (voters.iramediaconcepts.com).

if [[ ! -f .deploy.env ]]; then
  echo "Missing .deploy.env — copy .deploy.env.example and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.env

DEPLOY_ENV=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) DEPLOY_ENV="${2:?--env needs a name, e.g. --env booth}"; shift 2 ;;
    --env=*) DEPLOY_ENV="${1#--env=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [[ -n "$DEPLOY_ENV" ]]; then
  [[ -f ".deploy.$DEPLOY_ENV.env" ]] || { echo "Missing .deploy.$DEPLOY_ENV.env" >&2; exit 1; }
  # .deploy.env describes the original environment; keep only its host and key.
  unset DEPLOY_PATH BACKUP_DIR API_HEALTH_URL WEB_HEALTH_URL
  # shellcheck disable=SC1090
  source ".deploy.$DEPLOY_ENV.env"
fi

: "${DEPLOY_HOST:?Set DEPLOY_HOST in .deploy.env, e.g. root@103.117.180.71}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/voter-management}"
DOMAIN="${DOMAIN:-voters.iramediaconcepts.com}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
API_SERVICE="${API_SERVICE:-voter-api}"
WEB_SERVICE="${WEB_SERVICE:-voter-web}"
BACKUP_DIR="${BACKUP_DIR:-/root/voter-backups}"
# Desktop installers for the dashboard's /download page.
UPLOAD_DOWNLOADS="${UPLOAD_DOWNLOADS:-true}"
API_HEALTH_URL="${API_HEALTH_URL:-https://$DOMAIN/backend/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-https://$DOMAIN/login}"
