# Game Server — Design

Decisions agreed so far for `hearts-server`. Complements `card-game-spec.md`
(the rules engine, implemented in `hearts-core`).

## Stack

- **tokio + Axum**, async-native throughout.
- **Postgres** via **sqlx** (compile-time checked queries, `sqlx migrate` for
  schema). Dev database comes from `compose.yaml`.
- `hearts-core` stays pure; it gains an optional `serde` feature so `Game`
  can be serialized for snapshots without adding a default dependency.

## State model: memory first, snapshot per round

Active games live **in memory**; Postgres is for durability and history, not
for driving turns.

- Each active game is an entry in a shared map (`GameId → GameSession`); a
  `GameSession` holds the `hearts_core::Game`, the seat↔session bindings,
  and the event channel for connected clients. One lock per game — actions
  in a turn-based game are tiny and serialized anyway.
- **Snapshot cadence:** on game start and after every completed round —
  i.e. whenever `play_card` returns `RoundComplete` (state is then at the
  next round's bidding phase) or `GameOver`. The full `Game` is serialized
  to JSONB, keyed `(game_id, round_index)`.
- Keeping every round's snapshot (not just the latest) costs almost nothing
  (≤13 small rows per game) and gives round-by-round history for analysis.
- **Crash recovery:** on boot, load the latest snapshot of every
  `in_progress` game. Bids/plays of the round in flight are lost; the round
  restarts from its deal. Accepted trade-off for the simplicity.

## Users & sessions

- **Anonymous by default:** first contact issues an opaque random session
  token (stored server-side in `sessions`). Joining and playing games never
  requires an account. The token is the player's identity for reconnection.
- **Lite accounts:** username + password (argon2id hash) only. Logging in
  binds the current session to the user. No email is stored on the account;
  if email verification is implemented, the address is used transiently for
  the verification round-trip and then discarded. *(Open: does v1 need
  email verification at all, or is username+password enough to start?)*
- **History:** games record `created_by_user_id` (nullable — set when the
  creator is logged in). `GET /me/games` lists a user's created games with
  results and links to per-round snapshots for analysis.

## Game lifecycle & lobby

Lobby state lives outside the engine (the engine starts at round 1 bidding).

```
lobby ──start (creator, 2..=7 players)──▶ in_progress ──round 13──▶ finished
  │                                            │
  └── creator cancels / expires ─▶ abandoned ◀─┘ (e.g. all players gone)
```

1. `POST /games` — creates a lobby; the response carries a short, unique
   **invite code** (also usable as a link). The creator is player 1.
2. `POST /games/{code}/join` — join with a display name; seat order is join
   order.
3. `POST /games/{id}/start` — creator only, requires 2–7 players. The server
   picks the RNG seed (stored on the game row) and instantiates
   `Game::new`; first dealer is seat 0 (the creator).

## Transport

- **REST for actions, SSE for events** (proposal — see alternatives).
  `POST .../bid` and `.../play` map directly onto `place_bid`/`play_card`;
  each `GameError` variant maps to a 4xx with a machine-readable code. A
  per-game SSE stream (`GET /games/{id}/events`) pushes lobby changes,
  turn notifications, plays, and round results to all connected clients.
- Private state (a player's hand) is delivered only to that player's
  session; the deck order is never sent to anyone.
- Alternative considered: a single WebSocket for both directions. Chosen
  against for now — REST+SSE is curl-testable, needs no request protocol
  design, and the CLI can consume it with plain reqwest.

## Schema sketch

```sql
users          (id uuid PK, username text UNIQUE, password_hash text,
                created_at timestamptz)
sessions       (token bytea PK, user_id uuid NULL REFERENCES users,
                created_at, last_seen_at, expires_at)
games          (id uuid PK, invite_code text UNIQUE, status game_status,
                created_by_session bytea, created_by_user_id uuid NULL,
                seed bigint NULL,           -- set at start
                created_at, started_at NULL, finished_at NULL)
game_players   (game_id uuid, seat int, session_token bytea,
                user_id uuid NULL, display_name text, joined_at,
                PRIMARY KEY (game_id, seat))
game_snapshots (game_id uuid, round_index int, state jsonb, created_at,
                PRIMARY KEY (game_id, round_index))
game_results   (game_id uuid PK, scores int[], winner_seats int[])
```

`game_results` is derivable from the final snapshot but denormalized so
history/analysis queries never parse JSONB.

## Timeouts & liveness (settled)

- **Lobby expiry:** a lobby with no activity (join/start) for **20 minutes**
  becomes `abandoned`.
- **Turn timeout:** **5 minutes** per action (bid or play). When it fires,
  the server acts for the player — **lowest legal bid / first legal card**
  — and marks the seat *away*. The flag clears the next time the player
  acts for themselves. If every seat is away, the game is `abandoned`.
- Timeouts run on server-side timers per game, independent of client
  connections; the SSE stream announces auto-actions like any other play.
- **No spectator links** in v1; the invite code is join-only and dead once
  the game starts.

## Open questions

1. Email verification in v1, or defer entirely?
