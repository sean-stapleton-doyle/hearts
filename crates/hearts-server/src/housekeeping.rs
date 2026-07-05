//! Background sweepers (docs/server-design.md §Timeouts & liveness):
//! turn timeouts on live games, and expiry of idle lobbies. Both run on
//! coarse ticks — the timeouts are minutes, so ±seconds of slack is fine.

use std::time::Duration;

use crate::gameplay::{self, AppliedPlay, TurnAction};
use crate::state::AppState;

use hearts_core::Seat;

const TURN_SWEEP_INTERVAL: Duration = Duration::from_secs(2);
const LOBBY_SWEEP_INTERVAL: Duration = Duration::from_secs(10);

/// Auto-act for any player whose turn clock ran out: lowest legal bid or
/// first legal card, seat marked away. A game where every seat is away is
/// abandoned. Also auto-continues past a round-end gate whose host
/// acknowledgement deadline lapsed.
pub async fn turn_timeouts(state: AppState) {
    let mut tick = tokio::time::interval(TURN_SWEEP_INTERVAL);
    loop {
        tick.tick().await;
        for (game_id, entry) in state.registry.entries().await {
            let mut active = entry.lock().await;
            if tokio::time::Instant::now() < active.turn_deadline {
                continue;
            }

            // Round-end gate: the host didn't continue in time. Auto-ack on
            // their behalf so the table isn't stuck; clients learn via the
            // event and the view's `pending_ack` clearing on refetch.
            if let Some(round) = active.pending_ack.take() {
                let next = gameplay::turn(&active.game);
                tracing::info!(%game_id, round, "round-gate timed out; auto-acknowledging");
                active.turn_deadline = tokio::time::Instant::now() + state.turn_timeout;
                active.push_event(gameplay::GameEvent::RoundAcknowledged {
                    round_index: round,
                    auto: true,
                    next,
                });
                continue;
            }

            let Some(turn) = gameplay::turn(&active.game) else {
                continue;
            };

            let seat = turn.seat;
            tracing::info!(%game_id, seat, action = ?turn.action, "turn timed out; auto-acting");
            let finished = match turn.action {
                TurnAction::Bid => {
                    let round = active.game.round().expect("game in progress");
                    let bid = round.legal_bids()[0];
                    if let Err(error) = gameplay::apply_bid(&state, &mut active, seat, bid, true)
                    {
                        tracing::error!(%game_id, %error, "auto-bid rejected by engine");
                    }
                    false
                }
                TurnAction::Play => {
                    let round = active.game.round().expect("game in progress");
                    let card = round.legal_plays(Seat(seat))[0];
                    match gameplay::apply_play(&state, game_id, &mut active, seat, card, true)
                        .await
                    {
                        Ok(AppliedPlay::Finished(_)) => true,
                        Ok(AppliedPlay::InProgress(_)) => false,
                        Err(error) => {
                            tracing::error!(%game_id, %error, "auto-play rejected by engine");
                            false
                        }
                    }
                }
            };

            if finished || active.away.iter().all(|&away| away) {
                if !finished {
                    abandon(&state, game_id, &mut active).await;
                }
                drop(active);
                state.registry.remove(game_id).await;
            }
        }
    }
}

async fn abandon(state: &AppState, game_id: uuid::Uuid, active: &mut crate::registry::ActiveGame) {
    tracing::info!(%game_id, "all players away; abandoning game");
    active.push_event(gameplay::GameEvent::GameAbandoned {
        reason: "all_players_away".to_string(),
    });
    let result = sqlx::query(
        "UPDATE games SET status = 'abandoned', last_activity_at = now() WHERE id = $1",
    )
    .bind(game_id)
    .execute(&state.pool)
    .await;
    if let Err(error) = result {
        tracing::error!(%game_id, %error, "failed to mark game abandoned");
    }
}

/// Abandon lobbies with no join/start activity within the expiry window.
pub async fn lobby_expiry(state: AppState) {
    let mut tick = tokio::time::interval(LOBBY_SWEEP_INTERVAL);
    loop {
        tick.tick().await;
        let expired: Result<Vec<(uuid::Uuid,)>, sqlx::Error> = sqlx::query_as(
            "UPDATE games SET status = 'abandoned', last_activity_at = now() \
             WHERE status = 'lobby' \
             AND last_activity_at < now() - $1::double precision * interval '1 second' \
             RETURNING id",
        )
        .bind(state.lobby_expiry.as_secs_f64())
        .fetch_all(&state.pool)
        .await;
        match expired {
            Ok(expired) => {
                for (game_id,) in expired {
                    tracing::info!(%game_id, "expired idle lobby");
                }
            }
            Err(error) => tracing::error!(%error, "lobby expiry sweep failed"),
        }
    }
}
