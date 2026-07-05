# crates/ — Rust workspace

Rules engine + game server + terminal client + Python bindings for `hearts`.
Workspace root `Cargo.toml` (repo root, one level up): `resolver = "3"`,
`edition = "2024"` pinned in `[workspace.package]`, members below.

## What this is

- **`hearts-core`** — the rules engine. Pure domain logic, zero
  dependencies by default (optional `serde` feature for serialization only).
  No I/O, nothing async — deliberately kept this way so it stays embeddable
  (doc comments mention it's designed for language bindings, e.g. PyO3).
  Reused by `hearts-server`, `hearts-cli`, and `hearts-py`.
- **`hearts-server`** — the Axum async game server, backed by
  Postgres via sqlx. Anonymous sessions, lobbies with invite codes, REST
  actions + SSE events, per-round snapshots with boot recovery, turn
  timeouts, optional lite accounts.
- **`hearts-cli`** — a ratatui terminal client. Treat this as the
  **reference client implementation** — `web/docs/frontend-design.md`
  explicitly mirrors its request/event-loop patterns.
- **`hearts-py`** — PyO3 bindings exposing `hearts-core` to Python as
  `pyhearts`, for statistical analysis / bot training without reimplementing
  rules. Pure delegation, cloning translation layer only — no game logic
  lives here. See `../docs/python-bindings.md` for the full design and its
  layout section below.

## Layout

```
hearts-core/src/
  lib.rs      card.rs      deck.rs      error.rs
  game.rs     round.rs     seat.rs      trick.rs
```
- `card.rs` — `Suit`/`Rank`, `Card::beats` (needs led-suit context; hearts are trump).
- `deck.rs` — never-reshuffled deck; in-crate SplitMix64 + Fisher-Yates shuffle for cross-platform determinism from a seed.
- `error.rs` — `GameError`, one typed variant per rule rejection.
- `game.rs` — `Game`/`Phase`/`PlayOutcome`/`RoundResult`: the 13-round deal→bid→play→score state machine. Cheap to `Clone`.
- `round.rs` — `Round`, `MIN/MAX_PLAYERS` (2/7), `NUM_ROUNDS` (13), `cards_for_round` (1→7→1 shape), dealer rotation/tie-break.
- `seat.rs` — `Seat(usize)`, cyclic rotation.
- `trick.rs` — `Trick`: records plays, derives the winner via `Card::beats`. Doesn't enforce rules itself — that's `Round::play_card`'s job.

Doc comments across these files cite `../docs/card-game-spec.md` by section
(e.g. "spec §5.3") — **read the spec before changing rule logic**, don't
infer rules from the code alone.

```
hearts-server/src/
  main.rs         config.rs       session.rs    account.rs
  lobby.rs        gameplay.rs     registry.rs   persist.rs
  housekeeping.rs routes.rs       error.rs      state.rs
```
- `main.rs` — wires modules, runs migrations on boot.
- `config.rs` — env-based `Config` (`DATABASE_URL`, `BIND_ADDR`, turn timeout default 5min, lobby expiry default 20min, CORS origins).
- `session.rs` — anonymous 256-bit bearer tokens; only the SHA-256 hash is stored; sliding 30-day expiry.
- `account.rs` — lite accounts (username + argon2id password, no email); login binds/upgrades the current session and backfills history.
- `lobby.rs` — create/join/start lifecycle, invite codes; lobby state lives in Postgres, not memory.
- `gameplay.rs` — REST bid/play mapped onto `hearts_core::Round`/`Game`; `GameError` → 409 with a stable machine-readable code; the SSE event-stream endpoint.
- `registry.rs` — in-memory `GameRegistry`: one mutex per active game, append-only event log + broadcast channel for SSE with `Last-Event-ID` replay.
- `persist.rs` — snapshots the full `Game` to `game_snapshots` JSONB at start and after every completed round; boot recovery replays the latest snapshot per in-progress game.
- `housekeeping.rs` — background sweepers: turn-timeout auto-play (marks a seat "away"), lobby-expiry abandonment.
- `routes.rs` — route table + CORS layer. `error.rs` — `ApiError` → uniform `{"error":{"code","message"}}`. `state.rs` — `AppState` (`PgPool` + `GameRegistry` + timeouts), cloned into every handler.

```
hearts-cli/src/
  main.rs   api.rs    app.rs    config.rs   events.rs   sse.rs   ui.rs   account.rs
```
- `main.rs` — clap CLI (`create`, `join`, account subcommands).
- `api.rs` — typed reqwest client, deserializes straight into `hearts_core` types.
- `app.rs` — interactive TUI state machine: lobby-poll loop, then SSE+keyboard game loop.
- `sse.rs` — background SSE consumer, reconnects with `Last-Event-ID` on drop.
- `events.rs` — `ClientEvent` mirroring the server's SSE event types.
- `ui.rs` — pure ratatui drawing functions, no I/O/mutation.
- `config.rs` — persisted client config (`~/.config/hearts/config.json`): server URL, session token, last game id.
- `account.rs` — plain non-TUI register/login/logout/history commands.

```
hearts-py/src/
  lib.rs      card.rs     error.rs    game.rs     round.rs
```
- `lib.rs` — `#[pymodule]` registration; also defines the `mirror_enum!`
  macro shared by the mirrored enums below.
- `card.rs` — `Suit`/`Rank` (mirrored PyO3 enums — orphan rule blocks
  `#[pyclass]` on the foreign `hearts_core` enums directly) and `Card`.
- `round.rs` — `Seat`/`Deck`/`Trick`/`Round` newtype wrappers.
- `game.rs` — `Game`/`Phase`/`PlayOutcome`/`RoundResult`, the main driver;
  `Game::to_json`/`from_json` ride the `hearts-core` `serde` feature.
- `error.rs` — maps `hearts_core::GameError` to a Python `pyhearts.GameError`.
- `pyhearts.pyi` + `py.typed` at the crate root — hand-maintained type
  stubs. **Keep the stub named `pyhearts.pyi`** (matching `module-name`):
  maturin auto-detects it and installs it as `__init__.pyi` inside the
  package; a differently-named stub would land at the wheel root instead of
  next to the compiled extension, breaking type-checking.
- `build.rs` — on macOS, passes `-Wl,-undefined,dynamic_lookup` so the
  `pyo3` `extension-module` feature (which otherwise expects a Python
  interpreter's dynamic loader to supply libpython symbols) still lets a
  plain `cargo build`/`cargo test` link at the workspace root.

## Commands

Run from the repo root (workspace `Cargo.toml`, `compose.yaml`, `.env*` all live there):

```sh
docker compose up -d              # dev Postgres (hearts/hearts on :5432)
cp .env.example .env
cargo run -p hearts-server        # runs migrations, serves on :8080
cargo test                        # engine + server unit/integration tests
cargo test -p hearts-core --features serde
```

Python bindings (`crates/hearts-py`, package `pyhearts`):

```sh
cd crates/hearts-py
python3 -m venv .venv && .venv/bin/pip install maturin pytest
.venv/bin/maturin develop --release   # builds + installs the extension into .venv
.venv/bin/python -m pytest tests/ -q
```

Manual two-terminal play:

```sh
cargo run -p hearts-cli -- create --name alice   # prints an invite code
cargo run -p hearts-cli -- join CODE --name bob  # second terminal (or machine)
```

End-to-end checks (run against a live server, e.g. `cargo run -p hearts-server &`):

```sh
python3 scripts/e2e_gameplay.py                 # full game over REST + SSE
python3 scripts/e2e_accounts.py                  # accounts, history, snapshots
python3 scripts/e2e_resilience.py timeouts       # needs TURN_TIMEOUT_SECS=2
python3 scripts/e2e_resilience.py lobby-expiry   # needs LOBBY_EXPIRY_SECS<=5
python3 scripts/e2e_resilience.py setup          # then restart the server…
python3 scripts/e2e_resilience.py resume         # …and verify recovery
python3 scripts/e2e_tui.py                       # drives the real TUI in a pty (cargo build -p hearts-cli first)
```

(`scripts/` and the e2e commands above are also repo-root-relative.)

## Architecture notes (the "why")

- **Games run in memory.** Active games live in `GameRegistry` (one mutex
  per game); Postgres is for durability/history, not for driving turns.
- **Snapshot cadence.** Full `Game` serialized to `game_snapshots` JSONB at
  game start and after every completed round — all 13 rounds are kept, not
  just the latest, so per-round history is cheap. On boot, the server
  replays the latest snapshot of every in-progress game; **in-flight
  bids/plays for the current round are lost and it restarts from the
  deal** (accepted trade-off). Clients see this via a `game_resumed` SSE
  event (sequence numbers restart at 0).
- **Auth.** Opaque 256-bit bearer token, shown once at `POST /session`; the
  server stores only its SHA-256 hash. The SSE endpoint alone also accepts
  a `?token=` query param, because browsers can't set headers on
  `EventSource`.
- **REST for actions, SSE for events** — chosen over a single WebSocket for
  curl-testability. Every `GameError` variant maps to a 409 with a stable
  machine-readable `code`; clients should branch on `code`, never on
  `message`. Private state (a hand, legal moves) only ever appears in that
  player's own `GET /games/{id}` response, never on the shared event
  stream — and the deck order is never sent to anyone.
- **Liveness.** Turn timeout (default 5min) triggers server-side auto-play
  (lowest legal bid / first legal card) and marks the seat "away"; lobby
  expiry (default 20min) abandons idle lobbies. Both are server-side timers
  independent of client connections (`housekeeping.rs`).
- **Migration conventions** (`hearts-server/migrations/`,
  `NNNN_description.sql` naming): `sessions.token` is a `bytea` primary key
  (the hash bytes, not a uuid); `games.created_by_session` deliberately has
  no FK — it's an audit value that must survive session expiry/cleanup;
  `game_results` is a denormalized 1:1 table derived from the final
  snapshot so history queries can skip JSONB; partial indexes are used for
  nullable FK lookups (e.g. `games_created_by_user_idx ... WHERE
  created_by_user_id IS NOT NULL`).

## Conventions / gotchas

- No `rustfmt.toml`, `clippy.toml`, `[lints]` table, or CI config exists —
  defaults only. Don't assume a lint step is enforced anywhere.
- `hearts-core` has zero dependencies by design and stays sync/no-I/O —
  don't casually add a dependency to it.
- `../docs/card-game-spec.md` is the source of truth for game rules;
  `hearts-core`'s doc comments cite it by section.
