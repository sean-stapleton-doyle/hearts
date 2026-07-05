//! The gameplay loop (docs/server-design.md §Transport): REST actions,
//! SSE events.
//!
//! `POST .../bid` and `.../play` map one-to-one onto the engine's
//! `place_bid`/`play_card`; every engine rejection surfaces as a 409 with
//! a machine-readable code. Successful actions append events to the
//! game's log, which `GET .../events` streams to all players — public
//! information only (plays, bids, results). A player's hand and legal
//! moves appear solely in their own `GET /games/{id}` view.

use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};
use uuid::Uuid;

use hearts_core::{Card, Game, PlayOutcome, Seat};

use crate::error::ApiError;
use crate::lobby::GameStatus;
use crate::registry::{ActiveGame, SeatBinding};
use crate::session::{Session, SseSession};
use crate::state::AppState;

// ── Events ──────────────────────────────────────────────────────────────

/// An event plus its position in the game's log; the SSE `id` field
/// carries `seq` so reconnecting clients resume via `Last-Event-ID`.
#[derive(Debug, Clone, Serialize)]
pub struct Envelope {
    pub seq: u64,
    #[serde(flatten)]
    pub event: GameEvent,
}

impl Envelope {
    fn to_sse(&self) -> SseEvent {
        SseEvent::default()
            .id(self.seq.to_string())
            .json_data(self)
            .expect("game events serialize to JSON")
    }
}

/// Public game events: everything every player may see. Hands never
/// appear here.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    GameStarted {
        players: Vec<String>,
        round_index: u8,
        cards_dealt: u8,
        dealer: usize,
        next: Option<Turn>,
    },
    /// `auto: true` marks a timeout auto-action played by the server on
    /// the player's behalf (docs/server-design.md §Timeouts).
    BidPlaced {
        seat: usize,
        bid: u8,
        auto: bool,
        next: Option<Turn>,
    },
    CardPlayed {
        seat: usize,
        card: Card,
        auto: bool,
        next: Option<Turn>,
    },
    TrickCompleted {
        winner: usize,
        next: Option<Turn>,
    },
    RoundCompleted {
        round_index: u8,
        bids: Vec<u8>,
        tricks_won: Vec<u8>,
        deltas: Vec<i32>,
        scores: Vec<i32>,
        next_round_index: Option<u8>,
        next_dealer: Option<usize>,
        next: Option<Turn>,
    },
    /// The host (creator) acknowledged a completed round, or the timeout
    /// sweeper did so on their behalf (`auto: true`). Clears the round-end
    /// gate for every connected client. `round_index` is the completed
    /// round that was held open; `next` is the next round's first actor.
    RoundAcknowledged {
        round_index: u8,
        auto: bool,
        next: Option<Turn>,
    },
    GameOver {
        scores: Vec<i32>,
        winners: Vec<usize>,
    },
    /// Opens the log of a game rebuilt from its latest snapshot after a
    /// server restart. Sequence numbers restart at 0 and any actions of
    /// the round in flight are gone — clients should discard local state
    /// and refetch `GET /games/{id}`.
    GameResumed {
        round_index: u8,
        cards_dealt: u8,
        dealer: usize,
        scores: Vec<i32>,
        next: Option<Turn>,
    },
    /// Terminal: the server gave up on the game (e.g. every seat away).
    GameAbandoned {
        reason: String,
    },
}

/// Who acts next, and how.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Turn {
    pub action: TurnAction,
    pub seat: usize,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnAction {
    Bid,
    Play,
}

/// The next actor, derived from engine state after an action.
pub fn turn(game: &Game) -> Option<Turn> {
    let round = game.round()?;
    if let Some(seat) = round.next_bidder() {
        return Some(Turn { action: TurnAction::Bid, seat: seat.0 });
    }
    round.next_player().map(|seat| Turn { action: TurnAction::Play, seat: seat.0 })
}

/// The log's opening event, seeded by the lobby when it starts the game.
pub fn game_started_event(game: &Game, players: &[SeatBinding]) -> GameEvent {
    GameEvent::GameStarted {
        players: players.iter().map(|player| player.display_name.clone()).collect(),
        round_index: game.round_index(),
        cards_dealt: game.round().map(|round| round.cards_dealt()).unwrap_or(0),
        dealer: game.dealer().0,
        next: turn(game),
    }
}

pub fn game_resumed_event(game: &Game) -> GameEvent {
    GameEvent::GameResumed {
        round_index: game.round_index(),
        cards_dealt: game.round().map(|round| round.cards_dealt()).unwrap_or(0),
        dealer: game.dealer().0,
        scores: game.scores().to_vec(),
        next: turn(game),
    }
}

fn round_completed_event(game: &Game) -> GameEvent {
    let record = game.history().last().expect("a round just completed");
    GameEvent::RoundCompleted {
        round_index: record.index,
        bids: record.bids.clone(),
        tricks_won: record.tricks_won.clone(),
        deltas: record.deltas.clone(),
        scores: game.scores().to_vec(),
        next_round_index: game.round().map(|_| game.round_index()),
        next_dealer: game.round().map(|_| game.dealer().0),
        next: turn(game),
    }
}

// ── Actions ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BidBody {
    bid: u8,
}

#[derive(Debug, Deserialize)]
pub struct PlayBody {
    card: Card,
}

/// `POST /games/{id}/bid`
pub async fn bid(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
    Json(body): Json<BidBody>,
) -> Result<impl IntoResponse, ApiError> {
    let t0 = std::time::Instant::now();
    let entry = active_entry(&state, game_id).await?;
    let looked_up = t0.elapsed();
    let mut active = entry.lock().await;
    let locked = t0.elapsed();
    let seat = seat_of_member(&active, &session)?;
    require_gate_open(&active)?;
    let seq = apply_bid(&state, &mut active, seat, body.bid, false).map_err(engine_reject)?;
    log_slow_action("bid", game_id, looked_up, locked, t0.elapsed());
    Ok(Json(json!({ "seq": seq })))
}

/// `POST /games/{id}/play`
pub async fn play(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
    Json(body): Json<PlayBody>,
) -> Result<impl IntoResponse, ApiError> {
    let t0 = std::time::Instant::now();
    let entry = active_entry(&state, game_id).await?;
    let looked_up = t0.elapsed();
    let mut active = entry.lock().await;
    let locked = t0.elapsed();
    let seat = seat_of_member(&active, &session)?;
    require_gate_open(&active)?;
    let applied = apply_play(&state, game_id, &mut active, seat, body.card, false)
        .await
        .map_err(engine_reject)?;
    let seq = match applied {
        AppliedPlay::InProgress(seq) => seq,
        AppliedPlay::Finished(seq) => {
            drop(active);
            state.registry.remove(game_id).await;
            seq
        }
    };
    log_slow_action("play", game_id, looked_up, locked, t0.elapsed());
    Ok(Json(json!({ "seq": seq })))
}

/// Logs a breakdown of where a request spent its time once it crosses
/// 200ms, so a slow bid/play can be attributed to registry lookup, mutex
/// wait, or the engine-apply-plus-persist tail (e.g. `write_snapshot` on a
/// round boundary) instead of guessing from the client's TTFB alone.
fn log_slow_action(
    action: &'static str,
    game_id: Uuid,
    looked_up: std::time::Duration,
    locked: std::time::Duration,
    total: std::time::Duration,
) {
    if total.as_millis() < 200 {
        tracing::debug!(action, %game_id, ?looked_up, ?locked, ?total, "action handled");
        return;
    }
    tracing::warn!(
        action,
        %game_id,
        registry_lookup = ?looked_up,
        mutex_wait = ?(locked - looked_up),
        engine_apply = ?(total - locked),
        total = ?total,
        "slow action"
    );
}

/// Reject mutations while the round-end gate is held. The view's
/// `pending_ack` field tells clients the same story so they don't bother
/// the server, but this is the actual enforcement.
fn require_gate_open(active: &ActiveGame) -> Result<(), ApiError> {
    if active.pending_ack.is_some() {
        return Err(ApiError::conflict(
            "round_pending_ack",
            "round is pending host acknowledgement; waiting for the host to continue",
        ));
    }
    Ok(())
}

/// `POST /games/{id}/continue` — acknowledge the pending round-end recap,
/// unblocking the next round for everyone. Creator only.
pub async fn continue_game(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let entry = active_entry(&state, game_id).await?;
    let mut active = entry.lock().await;
    let seat = seat_of_member(&active, &session)?;
    if seat != active.creator_seat {
        return Err(ApiError::forbidden(
            "not_creator",
            "only the host (the player who created the game) can continue past a round",
        ));
    }
    let Some(round) = active.pending_ack.take() else {
        return Err(ApiError::conflict(
            "not_pending_ack",
            "no round is currently pending acknowledgement",
        ));
    };
    // The next round's turn clock starts now: reset the deadline so the
    // first bidder/plays has their full window.
    active.turn_deadline = tokio::time::Instant::now() + state.turn_timeout;
    let next = turn(&active.game);
    let seq = active.push_event(GameEvent::RoundAcknowledged { round_index: round, auto: false, next });
    Ok(Json(json!({ "seq": seq })))
}

/// `POST /games/{id}/end` — creator ends the game early. Terminal: pushes
/// `GameAbandoned`, marks the game abandoned in Postgres, and drops it from
/// the registry, same as the timeout sweeper's all-away path.
pub async fn end_game(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let entry = active_entry(&state, game_id).await?;
    let mut active = entry.lock().await;
    let seat = seat_of_member(&active, &session)?;
    if seat != active.creator_seat {
        return Err(ApiError::forbidden(
            "not_creator",
            "only the host (the player who created the game) can end it",
        ));
    }
    let seq = active.push_event(GameEvent::GameAbandoned { reason: "ended_by_host".to_string() });
    sqlx::query("UPDATE games SET status = 'abandoned', last_activity_at = now() WHERE id = $1")
        .bind(game_id)
        .execute(&state.pool)
        .await?;
    drop(active);
    state.registry.remove(game_id).await;
    tracing::info!(%game_id, "game ended by host");
    Ok(Json(json!({ "seq": seq })))
}

/// Place a bid and record the event. Shared by the HTTP handler
/// (`auto: false`) and the timeout sweeper (`auto: true`).
pub fn apply_bid(
    state: &AppState,
    active: &mut ActiveGame,
    seat: usize,
    bid: u8,
    auto: bool,
) -> Result<u64, hearts_core::GameError> {
    active.game.place_bid(Seat(seat), bid)?;
    active.note_action(seat, auto, state.turn_timeout);
    let next = turn(&active.game);
    Ok(active.push_event(GameEvent::BidPlaced { seat, bid, auto, next }))
}

/// Whether the play left the game running. On `Finished`, the caller must
/// drop its lock and remove the game from the registry.
#[must_use]
pub enum AppliedPlay {
    InProgress(u64),
    Finished(u64),
}

/// Play a card, record the event cascade, and persist snapshots/results
/// at round and game boundaries. Shared by the HTTP handler and the
/// timeout sweeper.
pub async fn apply_play(
    state: &AppState,
    game_id: Uuid,
    active: &mut ActiveGame,
    seat: usize,
    card: Card,
    auto: bool,
) -> Result<AppliedPlay, hearts_core::GameError> {
    let outcome = active.game.play_card(Seat(seat), card)?;
    active.note_action(seat, auto, state.turn_timeout);
    let next = turn(&active.game);
    let mut seq = active.push_event(GameEvent::CardPlayed { seat, card, auto, next });

    match outcome {
        PlayOutcome::TrickContinues => {}
        PlayOutcome::TrickComplete { winner } => {
            seq = active.push_event(GameEvent::TrickCompleted { winner: winner.0, next });
        }
        PlayOutcome::RoundComplete { trick_winner, .. } => {
            active.push_event(GameEvent::TrickCompleted { winner: trick_winner.0, next });
            let event = round_completed_event(&active.game);
            seq = active.push_event(event);
            // Hold the table on the recap until the host acknowledges it.
            // The engine has already advanced to the next round; the gate
            // is a server-side refusal to surface it. `pending_ack` stores
            // the completed round's index so clients know which summary to
            // pin. Cleared by the `continue` endpoint or the sweeper. The
            // final round is exempt — `GameOver` carries its own terminal
            // state and the finished view supersedes any recap.
            let completed = active
                .game
                .history()
                .last()
                .map(|record| record.index)
                .expect("a round just completed");
            active.pending_ack = Some(completed);
            active.turn_deadline = tokio::time::Instant::now() + state.turn_timeout;
            crate::persist::write_snapshot(&state.pool, game_id, &active.game).await;
        }
        PlayOutcome::GameOver { trick_winner, .. } => {
            active.push_event(GameEvent::TrickCompleted { winner: trick_winner.0, next });
            let event = round_completed_event(&active.game);
            active.push_event(event);

            let scores = active.game.scores().to_vec();
            let winners: Vec<usize> = active
                .game
                .winners()
                .expect("game is over")
                .into_iter()
                .map(|seat| seat.0)
                .collect();
            seq = active
                .push_event(GameEvent::GameOver { scores: scores.clone(), winners: winners.clone() });

            crate::persist::write_snapshot(&state.pool, game_id, &active.game).await;
            finish_game_row(state, game_id, &scores, &winners).await;
            tracing::info!(%game_id, ?winners, "game finished");
            return Ok(AppliedPlay::Finished(seq));
        }
    }
    Ok(AppliedPlay::InProgress(seq))
}

/// Mark the game finished and denormalize the result. The engine already
/// advanced, so a database failure here must not fail the action; it is
/// logged and recoverable by hand.
async fn finish_game_row(state: &AppState, game_id: Uuid, scores: &[i32], winners: &[usize]) {
    let winner_seats: Vec<i32> = winners.iter().map(|&seat| seat as i32).collect();
    let result: Result<_, sqlx::Error> = async {
        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "UPDATE games SET status = 'finished', finished_at = now(), \
             last_activity_at = now() WHERE id = $1",
        )
        .bind(game_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO game_results (game_id, scores, winner_seats) VALUES ($1, $2, $3)",
        )
        .bind(game_id)
        .bind(scores)
        .bind(&winner_seats)
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = result {
        tracing::error!(%game_id, %error, "failed to persist finished game");
    }
}

// ── Event stream ────────────────────────────────────────────────────────

/// `GET /games/{id}/events` — the game's event log as SSE, from
/// `Last-Event-ID` (or the beginning) onward. Members only. Browsers can't
/// set headers on `EventSource`, so this route authenticates via a
/// `?token=` query param as well as the usual bearer header (see
/// `SseSession`).
pub async fn events(
    State(state): State<AppState>,
    SseSession(session): SseSession,
    Path(game_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>, ApiError> {
    let entry = active_entry(&state, game_id).await?;
    let active = entry.lock().await;
    seat_of_member(&active, &session)?;

    let last_seen: Option<u64> = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok());
    // Backlog copy and subscription under the same lock that events are
    // published under: no gap, no overlap.
    let backlog = active.events_after(last_seen);
    let live = active.subscribe();
    drop(active);

    let stream = tokio_stream::iter(backlog.into_iter().map(|envelope| envelope.to_sse()))
        .chain(BroadcastStream::new(live).filter_map(|received| {
            // A lagged receiver missed events; it will reconnect with
            // Last-Event-ID and replay from the log.
            received.ok().map(|envelope| envelope.to_sse())
        }))
        .map(Ok);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ── Views & mapping ─────────────────────────────────────────────────────

/// The engine-state section of `GET /games/{id}`: public state for
/// everyone plus, for `viewer`, their hand and currently legal actions.
pub fn engine_view(active: &ActiveGame, viewer: Option<usize>) -> serde_json::Value {
    let game = &active.game;
    let round = game.round();
    let round_json = round.map(|round| {
        json!({
            "cards_dealt": round.cards_dealt(),
            "dealer": round.dealer().0,
            "bids": round.bids(),
            "tricks_won": (0..game.num_players())
                .map(|seat| round.tricks_won(Seat(seat)))
                .collect::<Vec<_>>(),
            "current_trick": round.current_trick().map(|trick| json!({
                "leader": trick.leader().0,
                "plays": trick.plays().iter()
                    .map(|&(seat, card)| json!({ "seat": seat.0, "card": card }))
                    .collect::<Vec<_>>(),
            })),
        })
    });
    let you = viewer.zip(round).map(|(seat, round)| {
        json!({
            "seat": seat,
            "hand": round.hand(Seat(seat)),
            "legal_bids": (round.next_bidder() == Some(Seat(seat)))
                .then(|| round.legal_bids()),
            "legal_plays": (round.next_player() == Some(Seat(seat)))
                .then(|| round.legal_plays(Seat(seat))),
        })
    });
    json!({
        "phase": game.phase(),
        "round_index": game.round_index(),
        "scores": game.scores(),
        "next": turn(game),
        "away": active.away,
        "turn_deadline_in_secs": active
            .turn_deadline
            .saturating_duration_since(tokio::time::Instant::now())
            .as_secs(),
        "pending_ack": active.pending_ack,
        "pending_recap": pending_recap_json(active),
        "round": round_json,
        "you": you,
    })
}

/// The recap payload for a held-open round, so a fresh `GET /games/{id}`
/// (or a mutation's refetch) carries everything the client needs to render
/// the summary without waiting for the `round_completed` SSE event to
/// arrive. `null` when no round is pending.
fn pending_recap_json(active: &ActiveGame) -> serde_json::Value {
    let Some(_) = active.pending_ack else {
        return serde_json::Value::Null;
    };
    let game = &active.game;
    let record = match game.history().last() {
        Some(record) => record,
        None => return serde_json::Value::Null,
    };
    json!({
        "round_index": record.index,
        "bids": record.bids,
        "tricks_won": record.tricks_won,
        "deltas": record.deltas,
        "scores": game.scores(),
        "next_round_index": game.round().map(|_| game.round_index()),
        "next_dealer": game.round().map(|_| game.dealer().0),
    })
}

/// Look up a running game, with a precise error when it is not running.
async fn active_entry(
    state: &AppState,
    game_id: Uuid,
) -> Result<std::sync::Arc<tokio::sync::Mutex<ActiveGame>>, ApiError> {
    if let Some(entry) = state.registry.get(game_id).await {
        return Ok(entry);
    }
    let status: Option<(GameStatus,)> =
        sqlx::query_as("SELECT status FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_optional(&state.pool)
            .await?;
    Err(match status {
        None => ApiError::not_found("game_not_found", "no such game"),
        Some((GameStatus::Lobby,)) => {
            ApiError::conflict("not_started", "this game has not started yet")
        }
        Some(_) => ApiError::conflict("game_over", "this game is finished"),
    })
}

fn seat_of_member(active: &ActiveGame, session: &Session) -> Result<usize, ApiError> {
    active
        .seat_of(session.token_hash.as_slice())
        .ok_or_else(|| ApiError::not_found("game_not_found", "no such game"))
}

/// Engine rejections are state conflicts: 409 with a code the client can
/// branch on and the engine's own message.
fn engine_reject(error: hearts_core::GameError) -> ApiError {
    use hearts_core::GameError as E;
    let code = match error {
        E::NotYourTurn(_) => "not_your_turn",
        E::BidOutOfRange { .. } => "bid_out_of_range",
        E::ForbiddenBid(_) => "forbidden_bid",
        E::CardNotHeld(_) => "card_not_held",
        E::MustFollowSuit(_) => "must_follow_suit",
        E::BiddingComplete | E::BiddingNotComplete | E::RoundComplete | E::GameOver => {
            "wrong_phase"
        }
        _ => "invalid_action",
    };
    ApiError::conflict(code, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::SeatBinding;
    use std::time::Duration;

    /// Two-seat bindings with distinct token hashes, for constructing an
    /// `ActiveGame` without touching the database.
    fn fake_bindings(n: usize) -> Vec<SeatBinding> {
        (0..n)
            .map(|i| SeatBinding {
                token_hash: vec![i as u8 + 1],
                display_name: format!("p{i}"),
            })
            .collect()
    }

    fn fake_active(creator_seat: usize) -> ActiveGame {
        let game = Game::new(2, 0).unwrap();
        ActiveGame::new(game, fake_bindings(2), creator_seat, Duration::from_secs(60))
    }

    #[test]
    fn gate_open_when_no_pending_ack() {
        let active = fake_active(0);
        assert!(require_gate_open(&active).is_ok());
    }

    #[test]
    fn gate_closed_when_pending_ack_set() {
        let mut active = fake_active(0);
        active.pending_ack = Some(3);
        let err = require_gate_open(&active).expect_err("gate should block");
        assert_eq!(err.status, axum::http::StatusCode::CONFLICT);
        assert_eq!(err.code, "round_pending_ack");
    }

    #[test]
    fn pending_ack_survives_in_engine_view() {
        let active = fake_active(0);
        let view = engine_view(&active, Some(0));
        assert_eq!(view["pending_ack"], serde_json::Value::Null);
        // Same view shape as a normal round, just with the gate field present.
        let keys: Vec<&str> =
            view.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert!(keys.contains(&"pending_ack"));
    }

    #[test]
    fn round_acknowledged_event_serializes_with_snake_case_tag() {
        let event = GameEvent::RoundAcknowledged {
            round_index: 7,
            auto: true,
            next: Some(Turn { action: TurnAction::Bid, seat: 1 }),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "round_acknowledged");
        assert_eq!(json["round_index"], 7);
        assert_eq!(json["auto"], true);
        assert_eq!(json["next"]["action"], "bid");
        assert_eq!(json["next"]["seat"], 1);

        // Null next serializes cleanly (final round won't ack, but the
        // shape must round-trip).
        let event = GameEvent::RoundAcknowledged {
            round_index: 0,
            auto: false,
            next: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["next"], serde_json::Value::Null);
    }
}
