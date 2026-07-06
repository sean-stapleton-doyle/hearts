# Web Client — Design

Decisions agreed so far for `web`. Complements `docs/api.md` (the
contract this client talks to) and mirrors the shape of `hearts-cli`
(`crates/hearts-cli`), which already implements the full client loop
in Rust — reuse its structure and lessons rather than re-deriving them.

## Stack

- **React 19 + Vite + TanStack Router** (scaffolded via `tanstack create
  --router-only`), file-based routes under `src/routes`.
- **Tailwind v4** for styling.
- **TanStack Query** for server state (fetch/cache/retry around the REST
  calls); plain `EventSource` for SSE, bridged into Query's cache manually
  (see below). Not yet a dependency — add it when the API client lands.
- No global client-state library (Redux/Zustand) planned — game state is
  entirely server-derived; the only durable local state is the session
  token.

## Pages / routes

| Route | Purpose | Key calls |
|---|---|---|
| `/` | Landing: pitch + entry point into create/join. | `POST /session` (silent, on first load) |
| `/play` | Create-or-join, then the lobby (poll until started). | `POST /games`, `POST /games/{code}/join`, `POST /games/{id}/start`, `GET /games/{id}` (poll ~2s) |
| `/games/:id` | The live game: bidding, trick play, scoring, turn countdown. | `GET /games/{id}`, `GET /games/{id}/events` (SSE), `POST .../bid`, `POST .../play` |
| `/account` | Profile, login/register/logout, game history, snapshot links. | `GET /me`, `POST /account/*`, `GET /me/games`, `GET /games/{id}/snapshots` |

`/games/:id` doubles as the lobby-to-game transition: if the game is still
`status == "lobby"` when loaded, render the lobby view instead of redirecting
— this is what lets a shared invite link (`/games/:id` or a future
`/join/:code`) drop a player straight into the right place regardless of
phase, same as the CLI's `run_inner` dispatching on `view.status`.

## Session model

- **Anonymous by default**, matching the server: on first load, if no token
  is stored, silently `POST /session` and persist the result. No login wall
  before playing.
- Token lives in `localStorage` (not cookies — no CORS credential dance,
  and it matches the CLI's "token is the identity, keep it safe" model from
  `config.rs`). Read once at app boot into a small auth context/atom that
  the API client closes over.
- On `401`, drop the stored token and re-run session bootstrap once before
  surfacing an error — a token can go stale (expiry, server data reset)
  independent of user action.
- Logging in (`POST /account/login`) binds the *existing* session token to
  an account; it does not issue a new token. The client's job is just to
  refresh whatever view depends on `user_id` (e.g. `/account`) after
  login/logout/register.

## API client

A thin typed wrapper, ported from `hearts-cli/src/api.rs`'s shape:

- One `ApiError` union: `{ kind: "server", status, code, message } | {
  kind: "transport", message }`. Components branch on `code` (per
  `docs/api.md` — stable and machine-readable), never on `message`.
- DTOs mirror the Rust structs 1:1 (`GameView`, `PlayerInfo`, `EngineView`,
  `RoundView`, `TrickView`, `YouView`, …) so the API doc's examples double
  as the TypeScript reference. Generate types by hand initially; revisit
  codegen (e.g. from a shared schema) only if drift becomes a problem.
- Every mutating call returns the fresh `GameView` or an error; the caller
  always re-renders from the response rather than optimistically patching
  local state — same discipline as `App::submit` in the CLI, which calls
  `refresh()` unconditionally after bid/play.

## Live updates: SSE

- One `EventSource` per open game page, opened against `GET
  /games/{id}/events` with the bearer token as a query param (browsers
  can't set headers on `EventSource`; the server will need a query-param
  auth fallback for this endpoint — **open item, see below**).
- On each message: apply the event to the TanStack Query cache for that
  game (either patch in place for cheap events like `bid_placed`, or just
  invalidate and refetch `GET /games/{id}` — start with invalidate-and-
  refetch since it's what the CLI effectively does via `refresh()`, and
  only optimize if it's visibly laggy).
- Reconnect with `Last-Event-ID` on drop (`EventSource` does this
  automatically via the `id:` field — verify server sends it on every
  event, which `docs/api.md` confirms).
- `game_resumed` ⇒ discard everything and refetch the view, per the API
  doc's explicit warning.
- Keep-alive comment lines need no handling; `EventSource` ignores them.

## Rendering the game

- `you.legal_bids` / `you.legal_plays` being non-null is the sole source of
  truth for "is it my turn" — never infer this from `next` client-side
  (`docs/api.md` calls these equivalent, but the view field is simpler to
  key UI off of than cross-referencing seat numbers).
- Turn countdown: seed a local timer from `turn_deadline_in_secs` on every
  view refresh, same as `App::reset_deadline`/`deadline` in the CLI —
  purely cosmetic, the server is the actual enforcer.
- Card sort order for hands: suit groups (clubs, diamonds, spades, hearts
  last as permanent trump), low→high within suit — port `display_key`
  from `app.rs` verbatim.
- On any `409` from bid/play, refetch the view and re-render rather than
  showing a raw retry — per the API doc, the usual cause is acting on
  stale state.

## Open questions

1. **CORS + SSE auth** *(resolved)*: `hearts-server` now applies a CORS
   layer (`CORS_ALLOWED_ORIGINS`, default `http://localhost:3000`) and
   accepts a `?token=<hex>` query param on `GET /games/{id}/events` for
   `EventSource`. See `docs/api.md` §CORS. Future hardening: a
   short-lived SSE ticket so the bearer never appears in URLs/logs.
2. **Invite links** *(resolved)*: `/join/:code` is the canonical share target
   — it resolves to `/games/:id` after joining, dropping a recipient straight
   into the right place regardless of phase. The Lobby surfaces the full
   `${origin}/join/${code}` URL via a "Copy invite link" button plus a
   "Share…" button (`navigator.share`, where supported); the bare 6-char
   code remains on screen for verbal sharing.
3. **Reconnect UX**: the CLI logs "· reconnecting…"; decide whether the web
   client shows a toast/banner or just a subtle connection dot.
