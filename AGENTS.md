# hearts

A trick-taking, relative-bidding card game (Oh Hell family) with two twists:
**hearts are permanent trump**, and **the deck is never reshuffled** — played
cards return to the bottom in a fixed order, so the whole game is
deterministic from one seed.

## Monorepo layout

| Path | What it is |
|---|---|
| `crates/` | Rust workspace: the game engine, the game server, the terminal client, and Python bindings. See [crates/AGENTS.md](crates/AGENTS.md). |
| `web/` | React + Vite + Tailwind + TanStack Router frontend. See [web/AGENTS.md](web/AGENTS.md). |

## Getting something running

```sh
docker compose up -d && cp .env.example .env && cargo run -p hearts-server   # :8080
cd web && pnpm install && pnpm dev                                           # :3000
```

See the subproject `AGENTS.md` files above for the full command set (tests,
e2e scripts, the terminal client, the Python bindings) and architecture notes.

## Docs

- [docs/card-game-spec.md](docs/card-game-spec.md) — the rules; source of truth for the engine.
- [docs/server-design.md](docs/server-design.md) — architecture decisions for the backend.
- [docs/api.md](docs/api.md) — the API reference for building clients.
- [docs/python-bindings.md](docs/python-bindings.md) — design for `crates/hearts-py`, the PyO3 bindings exposing the engine to Python as `pyhearts`.
- [web/docs/frontend-design.md](web/docs/frontend-design.md) — routes, session model, and API client plan for the web client.
