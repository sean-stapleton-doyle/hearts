# Backend API Reference

Everything a client (CLI, web, analysis script) needs to talk to
`hearts-server`. Game rules live in [card-game-spec.md](card-game-spec.md);
architecture decisions in [server-design.md](server-design.md).

- Base URL: `http://127.0.0.1:8080` in dev (`BIND_ADDR` to change).
- All request/response bodies are JSON.
- The API is unversioned and may change until the first release.
- CORS is enabled: configure allowed origins with `CORS_ALLOWED_ORIGINS`
  (comma-separated; defaults to `http://localhost:3000` for the web dev
  server). See [CORS](#cors).

## Conventions

### Authentication

Every endpoint except `GET /health` requires a session token:

```
Authorization: Bearer <64-hex-char token>
```

Get one from `POST /session`. The token is shown **once**; the server
stores only its hash. Missing/bad tokens yield `401` with code
`missing_token`, `malformed_token`, or `invalid_token`.

One endpoint — `GET /games/{id}/events` (SSE) — also accepts the token as a
`?token=<hex>` query parameter, because browsers cannot set headers on
`EventSource`. Everywhere else the bearer header is required.

### CORS

Browser frontends run on a different origin than the API (the web dev
server is `http://localhost:3000`, the API `http://127.0.0.1:8080`), so the
server applies a CORS layer:

- **Allowed origins**: from `CORS_ALLOWED_ORIGINS` (comma-separated); when
  unset or empty it defaults to `http://localhost:3000`.
- **Allowed methods**: `GET`, `POST`, `OPTIONS`.
- **Allowed request headers**: `Authorization`, `Content-Type`,
  `Last-Event-ID` (sent automatically by `EventSource` on reconnect).

No credentials/cookies are used — the bearer token rides a request header
(or the `?token=` query param on `/events`), so `allow-credentials` is off.

### Errors

All errors share one shape:

```json
{ "error": { "code": "forbidden_bid", "message": "bid 1 is forbidden: total bids may not equal the trick count" } }
```

`code` is stable and machine-readable — branch on it, not on `message`.

### Common encodings

| Value | Encoding |
|---|---|
| Card | `{"suit": "Clubs"\|"Diamonds"\|"Spades"\|"Hearts", "rank": "Two"…"Ten"\|"Jack"\|"Queen"\|"King"\|"Ace"}` |
| Seat | integer `0..num_players-1` (also the array index in per-seat arrays) |
| Game status | `"lobby"` \| `"in_progress"` \| `"finished"` \| `"abandoned"` |
| Phase | `"Bidding"` \| `"Playing"` \| `"GameOver"` |
| Timestamps | RFC 3339 UTC (`"2026-07-02T13:31:02.666336Z"`) |
| `next` (who acts) | `{"action": "bid"\|"play", "seat": n}` or `null` |

Hearts are permanent trump; rounds deal 1→7→1 cards over 13 rounds. Clients
**never need to compute legality**: the server provides `legal_bids` /
`legal_plays` and rejects anything else.

---

## Sessions

### `POST /session` → 201

No auth. Creates an anonymous session.

```json
{ "token": "8e97cb02…e90e", "expires_at": "2026-08-01T13:16:53Z" }
```

Store the token; it is the player's identity, including across reconnects
and (if they later register) account binding. Expiry slides: every
authenticated request pushes it 30 days out.

### `GET /session` → 200

Introspection: `{ "user_id": null | "<uuid>", "expires_at": … }`.
`user_id` is set once the session logs into an account.

---

## Lobby

### `POST /games` → 201

Body: `{ "display_name": "alice" }` (1–32 chars, no control characters —
else `400 invalid_display_name`). Creates a lobby; the caller becomes
**seat 0 and the creator**. Returns a [game view](#the-game-view) — share
`invite_code` with the other players.

### `POST /games/{invite_code}/join` → 200

Body: `{ "display_name": "bob" }`. Invite codes are 6 chars,
case-insensitive, alphabet `2-9 A-Z` minus `0/O/1/I/L`. Seats are assigned
in join order. Returns the game view.

- Already seated? Returns your current view (safe to retry).
- `404 game_not_found` — unknown code.
- `409 not_joinable` — game already started.
- `409 game_full` — 7 players seated.
- `409 name_taken` — another player in this game already uses that
  display name (compared case-insensitively). Pick a different name.

### `POST /games/{game_id}/start` → 200

Creator only, from the lobby, with ≥2 players. The engine deals round 1;
seat 0 (the creator) is the first dealer and bids first. Returns the game
view, now with `game` populated.

- `403 not_creator`, `409 already_started`, `409 not_enough_players`.

### `GET /games/{game_id}` → 200

The game view (below). **Members only** — everyone else gets the same
`404 game_not_found` as a nonexistent id, so ids don't leak membership.

---

## The game view

Returned by every lobby endpoint and `GET /games/{id}`. The single source
of truth for rendering; refetch it whenever you're unsure.

```json
{
  "id": "e99d5c7c-…",
  "invite_code": "MJTZ6C",
  "status": "in_progress",
  "players": [
    { "seat": 0, "display_name": "alice", "is_you": true,  "is_creator": true  },
    { "seat": 1, "display_name": "bob",   "is_you": false, "is_creator": false }
  ],
  "created_at": "…", "started_at": "…",
  "game": {                      // null unless status == "in_progress"
    "phase": "Playing",          // "Bidding" | "Playing"
    "round_index": 3,            // 1..13
    "scores": [4, -1],           // cumulative, by seat; can be negative
    "next": { "action": "play", "seat": 1 },
    "away": [false, true],       // seats currently on server auto-play
    "turn_deadline_in_secs": 287,
    "pending_ack": null,         // completed round index held on the recap gate, or null
    "round": {
      "cards_dealt": 3,
      "dealer": 1,
      "bids": [1, null],         // null = hasn't bid yet
      "tricks_won": [1, 0],
      "current_trick": {         // null during bidding; plays [] before the lead
        "leader": 0,
        "plays": [ { "seat": 0, "card": { "suit": "Spades", "rank": "Ten" } } ]
      }
    },
    "you": {                     // PRIVATE — only in your own view
      "seat": 1,
      "hand": [ { "suit": "Hearts", "rank": "Three" }, … ],
      "legal_bids": null,        // non-null array only when it's your bid
      "legal_plays": [ … ]       // non-null array only when it's your play
    }
  }
}
```

Notes:
- `game` is `null` for `lobby`, `finished`, and `abandoned` games.
- `you.legal_bids` / `you.legal_plays` double as "is it my turn": non-null
  exactly when you may act, already filtered for the hook and follow-suit.
  Both are `null` while `pending_ack` is set — the gate holds even the
  player whose turn it nominally is.
- `pending_ack` is non-null between a non-final `round_completed` and the
  following `round_acknowledged`. Render the recap; the host's
  `POST .../continue` clears it.
- Every player sees the same view except `you`.

---

## Playing

### `POST /games/{game_id}/bid` → 200

Body: `{ "bid": 2 }`. Response: `{ "seq": 12 }` — the log position of the
resulting event.

### `POST /games/{game_id}/play` → 200

Body: `{ "card": { "suit": "Spades", "rank": "Ten" } }`. Response:
`{ "seq": 47 }` (the last event the play produced — a single play can also
complete a trick, a round, or the game).

### `POST /games/{game_id}/continue` → 200

Acknowledge the round-end recap that's holding the table, unblocking the
next round for everyone. **Creator only.** No body. Response: `{ "seq": … }`.

After every non-final round the engine advances internally but the server
holds a gate: `bid`/`play` return `409 round_pending_ack` and every client
renders the recap (see `pending_ack` on the game view) until this endpoint
fires, which broadcasts `round_acknowledged`. The turn timeout doubles as
the auto-continue deadline — if the host doesn't act in time, the sweeper
acknowledges on their behalf (`auto: true`). The final round (13) skips the
gate; `game_over` takes precedence.

- `403 not_creator` — only the host (the player who created the game) can continue.
- `409 not_pending_ack` — no round is currently held (someone already continued).

### Rejections (all `409` unless noted)

| Code | Meaning |
|---|---|
| `not_started` | game is still in the lobby |
| `game_over` | game finished or was abandoned |
| `not_your_turn` | another seat acts next |
| `bid_out_of_range` | bid > cards dealt this round |
| `forbidden_bid` | the hook: last bidder can't make bids sum to tricks |
| `card_not_held` | card isn't in your hand |
| `must_follow_suit` | you hold a card of the led suit |
| `wrong_phase` | bid during play / play during bidding |
| `round_pending_ack` | a non-final round is held on the recap gate; the host must `POST .../continue` first |
| `not_creator` (403) | only the creator may start / continue |
| `game_not_found` (404) | unknown id, or you're not a member |

On any 409, refetch the view and re-render — the usual cause is acting on
a stale state (e.g. the turn timer already auto-acted for someone).

---

## Events (SSE)

### `GET /games/{game_id}/events`

`text/event-stream` of the game's event log, members only, available while
the game is `in_progress` (409 `not_started` / `game_over` otherwise).
Browsers can't set headers on `EventSource`, so this endpoint authenticates
either via the bearer header **or** a `?token=<hex>` query parameter, e.g.
`GET /games/{id}/events?token=8e97cb02…`. Each SSE message carries
`id: <seq>` and a JSON `data:` payload:

```
id: 3
data: {"seq":3,"type":"card_played","seat":0,"card":{"suit":"Spades","rank":"Ten"},"auto":false,"next":{"action":"play","seat":1}}
```

- Sequence numbers are gapless from 0 (`game_started` or `game_resumed`).
- **Reconnect with `Last-Event-ID: <last seq you saw>`** to replay exactly
  what you missed, then continue live.
- Ignore comment lines (`: …`) — they're 15s keep-alives.
- Events carry only public information; hands come from your view.

### Event types

`next` in any event = who acts now (same shape as the view's `next`).

| `type` | Payload (beyond `seq`, `type`) |
|---|---|
| `game_started` | `players` (names by seat), `round_index`, `cards_dealt`, `dealer`, `next` |
| `bid_placed` | `seat`, `bid`, `auto`, `next` |
| `card_played` | `seat`, `card`, `auto`, `next` |
| `trick_completed` | `winner`, `next` |
| `round_completed` | `round_index`, `bids`, `tricks_won`, `deltas`, `scores`, `next_round_index`, `next_dealer`, `next` (`next_*` null after round 13) |
| `round_acknowledged` | `round_index`, `auto`, `next` — host (or sweeper, `auto: true`) cleared the recap gate |
| `game_over` | `scores`, `winners` (seats; >1 on a tie) |
| `game_resumed` | `round_index`, `cards_dealt`, `dealer`, `scores`, `next` |
| `game_abandoned` | `reason` (e.g. `"all_players_away"`) |

`auto: true` marks a timeout auto-action the server played for an absent
player.

**`game_resumed` means the server restarted** and rebuilt the game from
its last round snapshot: sequence numbers restart at 0, and any bids/plays
from the round in flight are gone (the round restarts at its bidding
phase). Discard local state and refetch the view.

---

## Timeouts

- **Turn timer** (default 5 min, `TURN_TIMEOUT_SECS`): when it lapses the
  server acts for the player — lowest legal bid or first legal card — with
  `auto: true`, and flags the seat in the view's `away` array. The flag
  clears the next time that player acts. If **every** seat is away the game
  emits `game_abandoned` and the status flips to `abandoned`. The same
  timer doubles as the round-gate auto-continue deadline: if the host
  doesn't `POST .../continue` within the window, the sweeper acknowledges
  on their behalf (`round_acknowledged` with `auto: true`).
- **Lobby expiry** (default 20 min, `LOBBY_EXPIRY_SECS`): lobbies with no
  join/start activity are abandoned.
- `turn_deadline_in_secs` in the view supports a countdown UI. Sweepers
  tick coarsely (2s / 10s), so allow a few seconds of slack.

---

## Accounts (optional — play is fully anonymous without one)

Lite accounts: username + password, no email. Logging in binds the
**current session** to the account and retroactively claims games this
session created/played anonymously.

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /account/register` | `{username, password}` | 201 `{user_id, username}` | 400 `invalid_username` (3–32 chars `a-z 0-9 - _`; lowercased), 400 `invalid_password` (8–128 chars), 409 `username_taken`, 409 `already_logged_in` |
| `POST /account/login` | `{username, password}` | 200 `{user_id, username}` | 401 `invalid_credentials` (same for unknown user and wrong password) |
| `POST /account/logout` | — | 200 `{logged_out: true}` | — |
| `GET /me` | — | 200 `{user_id, username, created_at}` | 401 `login_required` |

### `GET /me/games` → 200

Games the account created or played, newest first (limit 100):

```json
{ "games": [ {
  "id": "…", "status": "finished",
  "created_at": "…", "started_at": "…", "finished_at": "…",
  "created_by_you": true, "your_seat": 0,
  "players": ["alice", "bob"],
  "result": { "scores": [-18, -23], "winner_seats": [0] }   // null unless finished
} ] }
```

### `GET /me/stats` → 200

Aggregate record over every seat the account has held (401
`login_required` without an account). Averages/bests cover finished games
only; hearts scores low, so `best_score` is the minimum:

```json
{ "games_played": 12, "games_finished": 10, "wins": 4,
  "average_score": -7.5, "best_score": -31 }
```

`average_score`/`best_score` are `null` with no finished games.

### `GET /games/{game_id}/snapshots` → 200

Full engine states for analysis: one per round (`round_index` 1–13, taken
at each round's bidding phase) plus the final state as `round_index: 14`,
which embeds the complete per-round `history`. Because snapshots contain
the deck order and every hand, they are **participants-only** and return
`409 snapshots_unavailable` until the game is `finished` or `abandoned`.

```json
{ "game_id": "…", "snapshots": [ { "round_index": 1, "created_at": "…", "state": { …full engine Game… } } ] }
```

---

## Recommended client loop

```
1. POST /session                     (once; persist the token)
2. Create or join via invite code
3. While status == "lobby": poll GET /games/{id} (~2s) to show arrivals
   (creator: POST .../start when ready)
4. Open GET /games/{id}/events; fetch GET /games/{id} once for full state
5. Render from the view; apply events as they arrive
   - your turn ⇔ view.game.you.legal_bids or legal_plays is non-null
     (equivalently: event.next.seat == your seat)
   - act with POST .../bid or .../play; on 409, refetch the view
   - on round_completed: show the recap; view.game.pending_ack is now set
   - while pending_ack is non-null: bid/play 409 with round_pending_ack;
     the host's POST .../continue (or the sweeper) emits round_acknowledged,
     clearing the gate and revealing the next round
6. On SSE disconnect: reconnect with Last-Event-ID
   - on game_resumed: drop state, refetch the view
7. game_over / game_abandoned: final scores are in the event;
   logged-in users find the game in GET /me/games
```

## Dev quickstart

```sh
docker compose up -d                      # Postgres 18 on :5432
cargo run -p hearts-server                # migrates on boot, serves :8080
python3 scripts/e2e_gameplay.py           # full-game smoke test
```

Configuration (env or `.env`): `DATABASE_URL` (required), `BIND_ADDR`,
`CORS_ALLOWED_ORIGINS`, `TURN_TIMEOUT_SECS`, `LOBBY_EXPIRY_SECS`. There is
no rate limiting yet — don't expose this to the open internet as-is.
