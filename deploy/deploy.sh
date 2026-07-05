#!/usr/bin/env bash
# Ships this repo to a VPS: builds the web app locally, rsyncs it plus
# deploy/{compose.yaml,Caddyfile} over ssh, and runs `docker compose pull
# && up -d` there. hearts-server itself is never built here — it's pulled
# from GHCR (see .github/workflows/build-and-push.yml); this script only
# ships the config and the static web build.
#
# Usage:
#   deploy/deploy.sh --host HOST --domain DOMAIN [--user USER] [--port PORT] [--bootstrap-docker]
#
# Requires deploy/.env to exist locally the first time you deploy to a
# given VPS (cp deploy/.env.example deploy/.env, fill it in). It's copied
# to the VPS once and never overwritten by later runs, so secrets survive
# redeploys — edit it on the VPS directly if it ever needs to change.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: deploy/deploy.sh --host HOST --domain DOMAIN [options]

  --host HOST           VPS hostname or IP (required)
  --domain DOMAIN        Public domain/subdomain this deploy serves,
                          e.g. hearts.example.com (required — used only
                          for the final printed URL, not sent anywhere;
                          the real source of truth is DOMAIN in .env)
  --user USER            SSH user (default: root)
  --port PORT            SSH port (default: 22)
  --bootstrap-docker     Install Docker + the Compose plugin on the VPS
                          first, via get.docker.com. Safe to pass on every
                          deploy — a no-op once Docker is already there —
                          but meant for a fresh box's first deploy.
  -h, --help             Show this help
EOF
}

HOST=""
DOMAIN=""
SSH_USER="root"
SSH_PORT="22"
BOOTSTRAP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --user) SSH_USER="$2"; shift 2 ;;
    --port) SSH_PORT="$2"; shift 2 ;;
    --bootstrap-docker) BOOTSTRAP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$HOST" || -z "$DOMAIN" ]]; then
  echo "error: --host and --domain are required" >&2
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SSH_TARGET="${SSH_USER}@${HOST}"
REMOTE_ROOT="/opt/hearts"
REMOTE_DEPLOY="$REMOTE_ROOT/deploy"
REMOTE_WEB_DIST="$REMOTE_ROOT/web/dist"

ssh_cmd() { ssh -p "$SSH_PORT" "$SSH_TARGET" "$@"; }
rsync_to() { rsync -az -e "ssh -p $SSH_PORT" "$@"; }

if [[ "$BOOTSTRAP" -eq 1 ]]; then
  echo "==> installing Docker on $HOST (get.docker.com)"
  ssh_cmd 'curl -fsSL https://get.docker.com | sh'
fi

echo "==> building web app"
(cd "$REPO_ROOT/web" && pnpm install --frozen-lockfile && pnpm build)

echo "==> creating remote directories"
ssh_cmd "mkdir -p '$REMOTE_DEPLOY' '$REMOTE_WEB_DIST'"

echo "==> syncing deploy config to $HOST"
rsync_to "$SCRIPT_DIR/compose.yaml" "$SCRIPT_DIR/Caddyfile" "$SSH_TARGET:$REMOTE_DEPLOY/"

echo "==> syncing web build to $HOST"
# --delete: a removed/renamed asset shouldn't linger and get served stale.
rsync -az --delete -e "ssh -p $SSH_PORT" "$REPO_ROOT/web/dist/" "$SSH_TARGET:$REMOTE_WEB_DIST/"

if ssh_cmd "test -f '$REMOTE_DEPLOY/.env'"; then
  echo "==> $HOST already has a .env — leaving it alone"
else
  if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    echo "error: no .env on $HOST yet, and deploy/.env doesn't exist locally either." >&2
    echo "       cp deploy/.env.example deploy/.env, fill it in, then re-run." >&2
    exit 1
  fi
  echo "==> no .env on $HOST yet — copying yours (one-time; never overwritten after)"
  rsync_to "$SCRIPT_DIR/.env" "$SSH_TARGET:$REMOTE_DEPLOY/.env"
fi

echo "==> pulling image and (re)starting the stack on $HOST"
ssh_cmd "cd '$REMOTE_DEPLOY' && docker compose pull && docker compose up -d"

echo "==> done — https://$DOMAIN should be live shortly"
echo "    logs:   ssh -p $SSH_PORT $SSH_TARGET 'cd $REMOTE_DEPLOY && docker compose logs -f'"
echo "    status: ssh -p $SSH_PORT $SSH_TARGET 'cd $REMOTE_DEPLOY && docker compose ps'"
