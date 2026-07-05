# Round-end gating: summary as a table state, not a popover

## Status: implemented (Option B-rules)

The fork below is resolved. We picked **Option B — true shared gate**,
with the gate reaching all the way to bidding enforcement (not just the
view). Decisions:

- **Host = creator.** The `continue` endpoint is creator-only; the
  creator's seat is pinned at `start` and recovered on boot.
- **Auto-continue reuses the turn timeout.** A host who stalls is
  auto-acknowledged by the timeout sweeper (`auto: true`), keeping the
  game moving — no new config knob.
- **Final round skips the gate.** `game_over` takes precedence; the
  finished screen shows the last round's deltas via its own UI.

`hearts-core` is untouched — the engine still advances internally at the
round boundary; the gate is a `hearts-server`-level hold (`pending_ack`
on `ActiveGame`) layered over an engine that has already dealt the next
round. See `docs/api.md` (`POST .../continue`, `round_acknowledged`,
`pending_ack`, `round_pending_ack`) for the contract.

## The issue (original writeup, kept for context)

At the end of a round the web client shows a recap (bid vs. tricks, score
delta, new totals, who deals next). Today it's a centered modal
(`RoundSummary`) that auto-dismisses after 8 seconds or on a `Continue`
click, and it's purely a client-side reveal gate — **the server has
already moved on to the next round by the time it appears**; dismissing it
doesn't drive anything, it just stops covering the table.

The request: reading the board between rounds is part of the game, so the
recap should:
1. Live embedded on the table (replace the felt's center content, like the
   deal gate does today) instead of a blocking modal with a backdrop.
2. Not auto-dismiss on a timer.
3. Only advance when the **game owner** (the creator/host) says so — and
   this should hold for every player's screen, not just the host's own.

Point 3 is the one with teeth. Points 1–2 are a pure frontend restyle.
Point 3, if it's meant to actually hold everyone back until the host acts,
is a different kind of change — see "The fork" below.

## Current UI mechanism (frontend-only, per-player, unsynced)

- `web/src/lib/sse.ts` (`useGameEvents`): on a `round_completed` SSE event,
  stashes the event's payload into the TanStack Query cache under
  `gameKeys.roundSummary(gameId)` — but **only if** the cached view's
  `round_index` still matches the event's `round_index` (`sse.ts:54-59`).
  This guards against a fresh page load replaying the whole event log and
  resurfacing summaries for rounds the cached view has already passed.
- `web/src/components/GameTable.tsx`: reads that cache entry via
  `useQuery(gameKeys.roundSummary(id))`. If non-null, renders `RoundSummary`
  as a modal (`.sheet-backdrop` + `.modal`) over the table, which by then is
  already showing the *new* round underneath (bidding UI, new dealer chip,
  etc. — the invalidate-and-refetch already happened).
- `web/src/components/RoundSummary.tsx`: renders the recap table and a
  `Continue` button; also runs an 8s `setTimeout` (`AUTO_DISMISS_MS`) that
  calls the same `onDismiss` the button does.
- `onDismiss` → `GameTable`'s `dismissSummary`, which just does
  `queryClient.setQueryData(gameKeys.roundSummary(id), null)` — clears the
  local cache entry. **Nothing is sent to the server.**

Because this is all local Query-cache state, **every player's browser
independently decides when to stop showing its own copy** of the same
`round_completed` payload. There is no cross-client concept of "the table
has moved on" — Alice dismissing hers has no effect on Bob's screen, and
vice versa. Today that's fine because dismissal is cosmetic. It stops being
fine the moment "only the host can dismiss" is meant to actually gate what
*other* players see.

## Current SSE mechanism (backend)

- `crates/hearts-server/src/gameplay.rs`: when `apply_play` resolves a
  `PlayOutcome::RoundComplete`, the engine (`hearts-core`) has **already**
  advanced `game.round_index()` / `game.dealer()` / dealt the next round's
  hands internally, all before any event is pushed. The server then emits,
  in order: `TrickCompleted` (last trick of the round), `RoundCompleted`
  (`round_completed_event`, `gameplay.rs:156-166` — carries `round_index`,
  `bids`, `tricks_won`, `deltas`, `scores`, `next_round_index`,
  `next_dealer`, and `next: Option<Turn>` for who bids first next round).
  Documented in `docs/api.md:246`.
- These events go on the game's append-only event log and are broadcast to
  every connected client via SSE (`GET /games/{id}/events`); a fresh
  connection replays the whole log so a reloading client catches up.
- There is **no existing concept of a round being "held open" for
  acknowledgement** — the moment the round-ending card is played, the next
  round's bidding is already live server-side. `next` in the
  `RoundCompleted` event already points at the next round's first bidder.
  A client that ignored the summary entirely could act on the new round
  immediately; the modal is the only thing currently in the way.
- No endpoint exists for "acknowledge this round" / "advance for everyone."
  The only mutating endpoints touching a game are `bid`, `play`, `start`
  (`crates/hearts-server/src/routes.rs`).

## The fork

**Option A — cosmetic only (frontend, no backend change).** Each player
still dismisses their own copy whenever they're ready (no host
restriction); we just drop the modal/backdrop in favor of an embedded table
state and remove the timer. `RoundSummary`'s `Continue` stays available to
everyone. Touches only `RoundSummary.tsx`, `GameTable.tsx` (render it
inside the felt instead of as an overlay), and `styles.css`.

**Option B — true shared gate (frontend + backend).** All players' clients
stay parked on the recap until the host acts, then everyone advances
together. This needs:
- A new mutating endpoint (e.g. `POST /games/{id}/continue` or similar),
  authorized to the creator seat only, in
  `crates/hearts-server/src/routes.rs` + `gameplay.rs`.
- A new broadcast event (e.g. `RoundAcknowledged`) so every connected
  client's SSE stream — not just the host's HTTP response — learns the
  table has moved on; `useGameEvents` would clear
  `gameKeys.roundSummary(id)` on that event instead of on a local timer.
- Deciding what non-host players can do while parked: today's server has
  no notion of "the next round hasn't started for you yet" — bidding is
  already live. If the gate is purely presentational (blocks the *view*
  but the round is still biddable underneath), that's a smaller, session
  + snapshot-safe change. If it's meant to actually block bidding until the
  host continues, that's a `hearts-core`/`hearts-server` game-rules change,
  a meaningfully bigger lift.
- Reconnect/replay correctness: a reloading client (or the host's own
  refresh) needs to know whether the current round has already been
  acknowledged, so the recap doesn't reappear after the table has moved on
  — likely a field on the game/round state (not just a transient event) so
  a page load can ask "is this round pending acknowledgement?" directly.

We stopped here to pick between A and B (and, if B, how far the gate
should reach) before touching code.
