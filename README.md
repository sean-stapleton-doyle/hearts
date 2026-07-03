# hearts

A trick-taking, relative-bidding card game (Oh Hell family) with two
twists: **hearts are permanent trump**, and **the deck is never
reshuffled** — played cards return to the bottom in a fixed order, so the
whole game is deterministic from one seed.

## Monorepo layout

| Path | What it is |
|---|---|
| `server/` | Rust workspace: the game engine, the game server, and the terminal client. |
| `web/` | React + Vite + Tailwind + TanStack Router frontend. |

### `server/` workspace

| Crate | What it is |
|---|---|
| `server/crates/hearts-core` | The rules engine: pure domain logic, zero deps, optional `serde` feature. Reused by the server, the CLI, and (planned) Python bindings. |
| `server/crates/hearts-server` | Axum game server: anonymous sessions, lobbies with invite codes, REST actions + SSE events, per-round snapshots with boot recovery, turn timeouts, lite accounts. |
| `server/crates/hearts-cli` | ratatui terminal client: lobby, live play over SSE, accounts and history. |

## Docs

- [server/docs/card-game-spec.md](server/docs/card-game-spec.md) — the rules; source of truth for the engine.
- [server/docs/server-design.md](server/docs/server-design.md) — architecture decisions for the backend.
- [server/docs/api.md](server/docs/api.md) — **the API reference for building clients.**

## Development

### Backend

```sh
cd server
docker compose up -d              # dev Postgres (hearts/hearts on :5432)
cp .env.example .env
cargo run -p hearts-server        # runs migrations, serves on :8080
cargo test                        # engine + server unit/integration tests
cargo test -p hearts-core --features serde
```

Play from two terminals:

```sh
cargo run -p hearts-cli -- create --name alice   # prints an invite code
cargo run -p hearts-cli -- join CODE --name bob  # second terminal (or machine)
```

End-to-end checks against a running server:

```sh
python3 scripts/e2e_gameplay.py     # full game over REST + SSE
python3 scripts/e2e_accounts.py     # accounts, history, snapshots
python3 scripts/e2e_resilience.py timeouts      # needs TURN_TIMEOUT_SECS=2
python3 scripts/e2e_resilience.py lobby-expiry  # needs LOBBY_EXPIRY_SECS<=5
python3 scripts/e2e_resilience.py setup         # then restart the server…
python3 scripts/e2e_resilience.py resume        # …and verify recovery
```

### Frontend

```sh
cd web
pnpm install
pnpm dev       # dev server on :3000
pnpm build     # production build
pnpm test      # vitest
```
