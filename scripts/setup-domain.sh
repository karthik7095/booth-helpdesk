#!/usr/bin/env bash
#
# Puts the dashboard behind https://voters.iramediaconcepts.com on the
# production server (AlmaLinux + Virtualmin + Apache).
#
#   npm run domain:setup
#   npm run domain:setup -- --env booth   # another environment (.deploy.booth.env)
#
# What it does, over SSH using the settings in .deploy.env:
#   0. With --env, creates the domain in Virtualmin if it is not there yet, as
#      a sub-server of the virtual server that owns voters.iramediaconcepts.com.
#   1. Issues a Let's Encrypt certificate for the domain through Virtualmin
#      (which also installs it into the vhost and renews it automatically).
#   2. Adds reverse proxies in the domain's HTTPS vhost: /backend/ goes to
#      the API (port 4000, used by the mobile and desktop apps) and
#      everything else to the Next.js dashboard (port 3000). Plain HTTP is
#      redirected to HTTPS. /etc/httpd/conf/httpd.conf is backed up first
#      and tested with `httpd -t` before Apache is reloaded.
#   3. Sets COOKIE_SECURE=true on the dashboard service (systemd drop-in) so
#      the admin session cookie carries the Secure flag, and restarts it.
#   4. Checks the public URLs.
#
# Safe to re-run: each proxy block is only inserted once, and a server set up
# before the API proxy existed gets just that block added. The dashboard still
# reaches the API over localhost, and port 4000 stays open for older app
# builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=deploy-env.sh
source scripts/deploy-env.sh "$@"
# The original environment's domain; a new one is created under its owner.
MAIN_DOMAIN="voters.iramediaconcepts.com"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

step "Checking that $DOMAIN resolves to the server"
SERVER_IP="${DEPLOY_HOST##*@}"
RESOLVED="$(dig +short @1.1.1.1 "$DOMAIN" A | head -1)"
if [[ "$RESOLVED" != "$SERVER_IP" ]]; then
  echo "$DOMAIN resolves to '${RESOLVED:-nothing}', expected $SERVER_IP." >&2
  echo "Fix the DNS record (A record, DNS only) before running this." >&2
  exit 1
fi
echo "  $DOMAIN → $SERVER_IP"

step "Configuring the server"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s -- "$DOMAIN" "$WEB_PORT" "$API_PORT" "$WEB_SERVICE" "$MAIN_DOMAIN" <<'REMOTE'
set -euo pipefail
DOMAIN="$1" WEB_PORT="$2" API_PORT="$3" WEB_SERVICE="$4" MAIN_DOMAIN="$5"
CONF=/etc/httpd/conf/httpd.conf
MARKER="# voter-dashboard-proxy"
API_MARKER="# voter-api-proxy"
# Other environments' blocks carry their domain so each is detected on its own.
if [[ "$DOMAIN" != "$MAIN_DOMAIN" ]]; then
  MARKER="$MARKER $DOMAIN"
  API_MARKER="$API_MARKER $DOMAIN"
fi
has_marker() {
  awk -v m="$1" '{ sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") } $0 == m { found = 1 } END { exit !found }' "$CONF"
}

# Backs up httpd.conf, writes the output of an awk program over it, tests the
# result and reloads Apache; restores the backup if the test fails.
apply_conf() {
  local program="$1"
  BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CONF" "$BACKUP"
  echo "  backup: $BACKUP"
  awk -v domain="$DOMAIN" -v port="$WEB_PORT" -v api_port="$API_PORT" \
      -v marker="$MARKER" -v api_marker="$API_MARKER" "$program" "$BACKUP" > "$CONF"
  echo "• Testing the Apache configuration"
  if ! httpd -t; then
    echo "  config test failed — restoring $BACKUP" >&2
    cp -a "$BACKUP" "$CONF"
    exit 1
  fi
  systemctl reload httpd
  echo "  Apache reloaded"
}

# The API lines must come before the dashboard's catch-all ProxyPass, since
# Apache uses the first ProxyPass whose path matches. The connection pool to
# the API is dropped after 30 s idle, under the API's own 65 s keep-alive, so
# Apache never reuses a socket the API has already closed.
API_LINES='
  print "    " api_marker
  print "    ProxyPass /backend/ http://127.0.0.1:" api_port "/ timeout=120 keepalive=On ttl=30"
  print "    ProxyPassReverse /backend/ http://127.0.0.1:" api_port "/"
'

if ! virtualmin list-domains --domain "$DOMAIN" --name-only | grep -qx "$DOMAIN"; then
  # The top-level virtual server that owns the main domain becomes the parent.
  PARENT="$(virtualmin list-domains --domain "$MAIN_DOMAIN" --multiline | awk -F': ' '/^ *Parent domain:/ && !p { p = $2 } END { print p }')"
  PARENT="${PARENT:-$MAIN_DOMAIN}"
  echo "• Creating $DOMAIN in Virtualmin under $PARENT"
  virtualmin create-domain --domain "$DOMAIN" --parent "$PARENT" --dir --web --ssl
fi

echo "• Requesting a Let's Encrypt certificate for $DOMAIN"
if virtualmin list-domains --domain "$DOMAIN" --multiline | grep -q "Lets Encrypt renewal: Enabled"; then
  echo "  already issued through Virtualmin, skipping"
else
  virtualmin generate-letsencrypt-cert --domain "$DOMAIN" --host "$DOMAIN" --renew --web
fi
CERT_FILE="$(virtualmin list-domains --domain "$DOMAIN" --multiline | awk -F': ' '/SSL cert file:/ {print $2}')"
openssl x509 -in "$CERT_FILE" -noout -issuer -enddate | sed 's/^/  /'

if has_marker "$MARKER"; then
  echo "• Dashboard proxy already configured in $CONF, skipping"
else
  echo "• Adding the dashboard and API proxies to $CONF"
  apply_conf '
    /^<VirtualHost / { inv = 1; ssl = ($0 ~ /:443>/); ours = 0 }
    inv && $0 ~ ("ServerName " domain "$") { ours = 1 }
    inv && /^<\/VirtualHost>/ {
      if (ours) {
        print "    " marker
        if (ssl) {
          print "    ProxyPreserveHost On"
          '"$API_LINES"'
          print "    ProxyPass / http://127.0.0.1:" port "/"
          print "    ProxyPassReverse / http://127.0.0.1:" port "/"
          print "    RequestHeader set X-Forwarded-Proto \"https\""
        } else {
          print "    RewriteCond %{REQUEST_URI} !^/\\.well-known/"
          print "    RewriteRule ^ https://" domain "%{REQUEST_URI} [R=301,L]"
        }
      }
      inv = 0
    }
    { print }
  '
fi

if has_marker "$API_MARKER"; then
  echo "• API proxy already configured in $CONF, skipping"
else
  echo "• Adding the API proxy to the existing dashboard proxy in $CONF"
  apply_conf '
    /^<VirtualHost / { inv = 1; ssl = ($0 ~ /:443>/); ours = 0 }
    inv && $0 ~ ("ServerName " domain "$") { ours = 1 }
    { print }
    inv && ssl && ours && $0 ~ (marker "$") {
      '"$API_LINES"'
    }
    /^<\/VirtualHost>/ { inv = 0 }
  '
fi

# The dashboard's session cookie must carry the Secure flag now that the site
# is on HTTPS. The service's environment is set in its systemd unit, so a
# drop-in overrides COOKIE_SECURE without editing the unit itself.
DROPIN_DIR="/etc/systemd/system/$WEB_SERVICE.service.d"
DROPIN="$DROPIN_DIR/cookie-secure.conf"
CURRENT="$(systemctl show "$WEB_SERVICE" -p Environment | tr ' ' '\n' | grep -E '^COOKIE_SECURE=' | tail -1)"
if [[ "$CURRENT" == "COOKIE_SECURE=true" ]]; then
  echo "• COOKIE_SECURE is already true for $WEB_SERVICE, skipping"
else
  echo "• Setting COOKIE_SECURE=true for $WEB_SERVICE (was: ${CURRENT:-unset})"
  mkdir -p "$DROPIN_DIR"
  printf '[Service]\nEnvironment=COOKIE_SECURE=true\n' > "$DROPIN"
  systemctl daemon-reload
  systemctl restart "$WEB_SERVICE"
  sleep 3
  systemctl is-active --quiet "$WEB_SERVICE" || { echo "  $WEB_SERVICE failed to start — see: journalctl -u $WEB_SERVICE -n 50" >&2; exit 1; }
  NOW="$(systemctl show "$WEB_SERVICE" -p Environment | tr ' ' '\n' | grep -E '^COOKIE_SECURE=' | tail -1)"
  [[ "$NOW" == "COOKIE_SECURE=true" ]] || { echo "  expected COOKIE_SECURE=true, got '${NOW:-unset}'" >&2; exit 1; }
  echo "  $WEB_SERVICE restarted with $NOW"
fi
REMOTE

step "Checking the public URLs"
sleep 2
ok=true
check() {
  local url="$1" want="$2" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)"
  if [[ "$code" =~ ^($want)$ ]]; then
    echo "  ✓ $url ($code)"
  else
    echo "  ✗ $url ($code, wanted $want)"
    ok=false
  fi
}
check "https://$DOMAIN/login" "200"
check "https://$DOMAIN/backend/health" "200"
check "http://$DOMAIN/" "301"
echo "  certificate:"
curl -vs -o /dev/null --max-time 20 "https://$DOMAIN/" 2>&1 | grep -E 'issuer:|expire date' | sed 's/^\*/   /'

if [[ "$ok" == false ]]; then
  echo "Something is off — check: ssh $DEPLOY_HOST tail -50 /var/log/virtualmin/${DOMAIN}_error_log" >&2
  exit 1
fi
printf '\n\033[1;32m✓ https://%s is serving the dashboard and https://%s/backend the API\033[0m\n' "$DOMAIN" "$DOMAIN"
