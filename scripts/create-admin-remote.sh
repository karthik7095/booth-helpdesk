#!/usr/bin/env bash
#
# Creates (or resets) a super admin login on a deployed environment, using the
# API build already on the server — it has no tsx to run apps/api/scripts.
#
#   npm run admin:create -- --env booth <email> [name]
#
# The password is asked for here and sent over SSH on stdin; it is never put on
# a command line or printed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=deploy-env.sh
source scripts/deploy-env.sh "$@"
EMAIL="${ARGS[0]:-}"
NAME="${ARGS[1]:-Super Admin}"
[[ -n "$EMAIL" ]] || { echo "usage: npm run admin:create -- [--env NAME] <email> [name]" >&2; exit 1; }
# Both go into the remote command line.
[[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || { echo "Not an email address: $EMAIL" >&2; exit 1; }
[[ "$NAME" =~ ^[A-Za-z0-9\ .-]+$ ]] || { echo "Use only letters, digits, spaces, dots and dashes in the name." >&2; exit 1; }

read -rsp "Password for $EMAIL (8+ characters): " PASSWORD; echo
read -rsp "Again: " AGAIN; echo
[[ "$PASSWORD" == "$AGAIN" ]] || { echo "Passwords don't match." >&2; exit 1; }
(( ${#PASSWORD} >= 8 )) || { echo "Password must be at least 8 characters." >&2; exit 1; }

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes)

printf '%s' "$PASSWORD" | ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" \
  "cd '$DEPLOY_PATH/api' && ADMIN_EMAIL='$EMAIL' ADMIN_NAME='$NAME' node --input-type=module -e '
import { pathToFileURL } from \"node:url\";
const dist = (p) => pathToFileURL(process.cwd() + \"/dist/\" + p).href;
const { hashPassword } = await import(dist(\"lib/password.js\"));
const { prisma } = await import(dist(\"prisma.js\"));
let password = \"\";
for await (const chunk of process.stdin) password += chunk;
const email = process.env.ADMIN_EMAIL.toLowerCase();
const passwordHash = await hashPassword(password);
const admin = await prisma.adminUser.upsert({
  where: { email },
  update: { passwordHash, role: \"super_admin\", isActive: true, name: process.env.ADMIN_NAME },
  create: { email, passwordHash, role: \"super_admin\", name: process.env.ADMIN_NAME },
});
console.log(admin.role + \" \" + admin.email + \" (\" + admin.id + \") is ready on '$DOMAIN'\");
await prisma.\$disconnect();
'"
