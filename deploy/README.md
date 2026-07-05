# Deploying hearts

Single VPS, Docker Compose, Caddy for automatic HTTPS on your own domain
(a subdomain like `hearts.example.com` works fine — Caddy just needs DNS
pointed at it). Everything under `deploy/` is the production stack — the
repo root's `compose.yaml` is unrelated (throwaway dev Postgres only).

## Layout

- `postgres` — internal only, no port published to the host or internet.
- `hearts-server` — pulled from GHCR, not built on the VPS (see
  `.github/workflows/build-and-push.yml`); internal only, Caddy is the
  only thing that reaches it.
- `caddy` — the only container with published ports (80/443). Serves the
  built web SPA as static files and reverse-proxies `/api/*` (prefix
  stripped) to `hearts-server`. One origin, one TLS cert, no CORS needed
  for the browser path.

`deploy/deploy.sh` drives all of this from your machine over ssh — see
below. It never builds `hearts-server` itself (that's CI's job); it
builds the web app, ships config + the web build to the VPS, and runs
`docker compose pull && up -d` there.

## One-time setup

1. **Push this repo to GitHub** if it isn't already — the build/push
   workflow needs it. First push to `main` (or a manual run from the
   Actions tab) publishes `ghcr.io/<you>/hearts-server:latest`.
2. If that GHCR package ends up private (GitHub's default for a private
   repo), either flip its visibility to public in the package settings
   (simplest — this image has no secrets baked in), or run
   `docker login ghcr.io` once on the VPS with a PAT that has
   `read:packages`.
3. DNS: point an A (and AAAA, if using IPv6) record for your domain (or
   subdomain) at the VPS's IP. Caddy can't issue a cert until this
   resolves.
4. Locally: `cd deploy && cp .env.example .env`, fill in `DOMAIN`,
   `HEARTS_IMAGE` (from step 1), `POSTGRES_PASSWORD`, and
   `CORS_ALLOWED_ORIGINS`.

## Deploying

```sh
deploy/deploy.sh --host <vps-ip-or-host> --domain hearts.example.com
```

Add `--bootstrap-docker` on a brand-new VPS that doesn't have Docker yet
(installs it via get.docker.com first — safe to leave off on every later
deploy, it's a no-op once Docker's there). `--user`/`--port` override the
ssh target if it isn't `root@host:22`.

This builds `web/dist` locally, rsyncs it plus `deploy/{compose.yaml,
Caddyfile}` to the VPS, copies your local `.env` over on the very first
run only (never overwrites it after — edit it on the VPS directly if it
needs to change later), then runs `docker compose pull && up -d`.
Postgres migrates itself on `hearts-server`'s first boot
(`sqlx::migrate!()` in `main.rs`) — no separate migration step.

Visit `https://your-domain` — Caddy should already have a valid Let's
Encrypt cert (check `docker compose logs caddy` on the VPS if not).

## Redeploying

- **Web-only change**: just re-run `deploy/deploy.sh ...` — it always
  rebuilds and re-syncs `web/dist`; nothing needs restarting for static
  content.
- **Server change**: push to `main` (or trigger the workflow manually),
  wait for it to publish the new image, then re-run
  `deploy/deploy.sh ...` — `pull_policy: always` on `hearts-server` in
  `compose.yaml` means `docker compose pull` always fetches the latest
  `:latest` tag before restarting it.

## Backups

Postgres data lives in the `postgres-data` named volume. At minimum,
cron a periodic dump before real game history accumulates:

```sh
docker compose exec -T postgres pg_dump -U hearts hearts | gzip > backup-$(date +%F).sql.gz
```

Copy that off the VPS somewhere (not just onto the same disk).

## Security notes

- Postgres and `hearts-server` are never reachable except through Caddy —
  don't add `ports:` to either in `compose.yaml` without a reason.
- `hearts-server` rate-limits `/session`, `/account/login`,
  `/account/register`, and `/games/{code}/join` per-IP, trusting
  `X-Forwarded-For` for the client address — this is only sound because
  Caddy is the sole entry point and sets that header itself. If
  `hearts-server` is ever exposed some other way (a second reverse proxy,
  a direct port publish), that trust assumption needs revisiting.
