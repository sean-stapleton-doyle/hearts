//! Snapshots and boot recovery (docs/server-design.md §State model).
//!
//! The full `hearts_core::Game` is serialized to `game_snapshots` at game
//! start and after every completed round — always at a round's bidding
//! phase, which is exactly the state a recovered game resumes from. The
//! final game-over state is stored under [`FINAL_SNAPSHOT_INDEX`] for
//! analysis (it embeds the complete 13-round history).
//!
//! Snapshot writes never fail the action that triggered them: the engine
//! has already advanced, so failures are logged and the game plays on
//! (at worst, a crash then loses more than one round).

use sqlx::PgPool;
use uuid::Uuid;

use hearts_core::{Game, Phase};

use crate::gameplay;
use crate::registry::{ActiveGame, SeatBinding};
use crate::state::AppState;

/// `game_snapshots.round_index` for the game-over snapshot (rounds are
/// 1..=13; their snapshots are taken at each round's start).
pub const FINAL_SNAPSHOT_INDEX: i32 = 14;

pub async fn write_snapshot(pool: &PgPool, game_id: Uuid, game: &Game) {
    let round_index = if game.phase() == Phase::GameOver {
        FINAL_SNAPSHOT_INDEX
    } else {
        game.round_index() as i32
    };
    let state = match serde_json::to_value(game) {
        Ok(state) => state,
        Err(error) => {
            tracing::error!(%game_id, %error, "failed to serialize game snapshot");
            return;
        }
    };
    let result = sqlx::query(
        "INSERT INTO game_snapshots (game_id, round_index, state) VALUES ($1, $2, $3) \
         ON CONFLICT (game_id, round_index) \
         DO UPDATE SET state = excluded.state, created_at = now()",
    )
    .bind(game_id)
    .bind(round_index)
    .bind(state)
    .execute(pool)
    .await;
    if let Err(error) = result {
        tracing::error!(%game_id, round_index, %error, "failed to write game snapshot");
    }
}

/// Rebuild every `in_progress` game from its latest snapshot into the
/// registry. Games without a usable snapshot are marked abandoned rather
/// than left as zombie rows nobody can play.
pub async fn recover_active_games(state: &AppState) -> anyhow::Result<()> {
    let games: Vec<(Uuid,)> =
        sqlx::query_as("SELECT id FROM games WHERE status = 'in_progress'")
            .fetch_all(&state.pool)
            .await?;
    let mut recovered = 0usize;
    for (game_id,) in games {
        match recover_one(state, game_id).await? {
            true => recovered += 1,
            false => {
                sqlx::query(
                    "UPDATE games SET status = 'abandoned', last_activity_at = now() \
                     WHERE id = $1",
                )
                .bind(game_id)
                .execute(&state.pool)
                .await?;
                tracing::warn!(%game_id, "abandoned unrecoverable in-progress game");
            }
        }
    }
    tracing::info!(recovered, "boot recovery complete");
    Ok(())
}

async fn recover_one(state: &AppState, game_id: Uuid) -> anyhow::Result<bool> {
    let snapshot: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT state FROM game_snapshots WHERE game_id = $1 \
         ORDER BY round_index DESC LIMIT 1",
    )
    .bind(game_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((snapshot,)) = snapshot else {
        return Ok(false);
    };
    let game: Game = match serde_json::from_value(snapshot) {
        Ok(game) => game,
        Err(error) => {
            tracing::error!(%game_id, %error, "snapshot does not deserialize");
            return Ok(false);
        }
    };
    if game.phase() == Phase::GameOver {
        // A final snapshot with an in_progress row means the finish write
        // half-failed; there is nothing left to play.
        return Ok(false);
    }

    let players: Vec<(i32, Vec<u8>, String)> = sqlx::query_as(
        "SELECT seat, session_token, display_name FROM game_players \
         WHERE game_id = $1 ORDER BY seat",
    )
    .bind(game_id)
    .fetch_all(&state.pool)
    .await?;
    if players.len() != game.num_players() {
        tracing::error!(%game_id, "snapshot and seat bindings disagree on player count");
        return Ok(false);
    }
    let bindings: Vec<SeatBinding> = players
        .into_iter()
        .map(|(_, token_hash, display_name)| SeatBinding { token_hash, display_name })
        .collect();
    // Recover the creator's seat so the round-gate `continue` authorization
    // works after a restart. Falls back to seat 0 (always correct today) if
    // the row is somehow missing the audit value.
    let creator_hash: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT created_by_session FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_optional(&state.pool)
    .await?;
    let hash: Vec<u8> = creator_hash.map(|(h,)| h).unwrap_or_default();
    let creator_seat = bindings.iter().position(|p| p.token_hash == hash).unwrap_or(0);
    let mut active = ActiveGame::new(game, bindings, creator_seat, state.turn_timeout);
    let resumed = gameplay::game_resumed_event(&active.game);
    active.push_event(resumed);
    state.registry.insert(game_id, active).await;
    tracing::info!(%game_id, "recovered in-progress game from snapshot");
    Ok(true)
}
