//! Lobby lifecycle (docs/server-design.md §Game lifecycle & lobby):
//! create → join (invite code, seat = join order) → start (creator only,
//! 2–7 players). `start` is the handoff point: the `games` row gains a
//! seed and the game comes alive in the [`GameRegistry`].
//!
//! Lobby state lives in Postgres, not the registry — lobbies must survive
//! a server restart, and until `start` there is no engine state at all.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use hearts_core::Game;

use crate::error::ApiError;
use crate::registry::{ActiveGame, SeatBinding};
use crate::session::Session;
use crate::state::AppState;

/// Unambiguous alphabet (no 0/O, 1/I/L): 31^6 ≈ 890M codes.
const INVITE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const INVITE_CODE_LEN: usize = 6;
const MAX_DISPLAY_NAME_LEN: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, sqlx::Type)]
#[sqlx(type_name = "game_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GameStatus {
    Lobby,
    InProgress,
    Finished,
    Abandoned,
}

#[derive(Debug, Deserialize)]
pub struct PlayerBody {
    display_name: String,
}

/// `POST /games` — create a lobby; the caller takes seat 0 and receives
/// the invite code to share.
pub async fn create(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<PlayerBody>,
) -> Result<impl IntoResponse, ApiError> {
    let display_name = clean_display_name(&body.display_name)?;

    // Retry the whole transaction on an invite-code collision: a unique
    // violation aborts the surrounding Postgres transaction.
    for _ in 0..5 {
        let invite_code = new_invite_code();
        let mut tx = state.pool.begin().await?;
        let inserted = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO games (invite_code, created_by_session, created_by_user_id) \
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(&invite_code)
        .bind(session.token_hash.as_slice())
        .bind(session.user_id)
        .fetch_one(&mut *tx)
        .await;
        let game_id = match inserted {
            Ok(id) => id,
            Err(sqlx::Error::Database(db))
                if db.kind() == sqlx::error::ErrorKind::UniqueViolation =>
            {
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        sqlx::query(
            "INSERT INTO game_players (game_id, seat, session_token, user_id, display_name) \
             VALUES ($1, 0, $2, $3, $4)",
        )
        .bind(game_id)
        .bind(session.token_hash.as_slice())
        .bind(session.user_id)
        .bind(&display_name)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        let view = game_view(&state, game_id, &session).await?;
        return Ok((StatusCode::CREATED, Json(view)));
    }
    Err(ApiError::internal("could not allocate a unique invite code"))
}

/// `POST /games/{code}/join` — take the next seat in a lobby. Joining a
/// lobby you are already in is a no-op that returns the current view, so
/// clients can retry safely.
pub async fn join(
    State(state): State<AppState>,
    session: Session,
    Path(code): Path<String>,
    Json(body): Json<PlayerBody>,
) -> Result<impl IntoResponse, ApiError> {
    let display_name = clean_display_name(&body.display_name)?;
    let invite_code = code.trim().to_uppercase();

    let mut tx = state.pool.begin().await?;
    // Lock the game row so concurrent joins serialize on seat assignment.
    let game: Option<(Uuid, GameStatus)> =
        sqlx::query_as("SELECT id, status FROM games WHERE invite_code = $1 FOR UPDATE")
            .bind(&invite_code)
            .fetch_optional(&mut *tx)
            .await?;
    let (game_id, status) = game
        .ok_or_else(|| ApiError::not_found("game_not_found", "no game with that invite code"))?;

    let already_seated: Option<(i32,)> = sqlx::query_as(
        "SELECT seat FROM game_players WHERE game_id = $1 AND session_token = $2",
    )
    .bind(game_id)
    .bind(session.token_hash.as_slice())
    .fetch_optional(&mut *tx)
    .await?;
    if already_seated.is_some() {
        tx.rollback().await?;
        let view = game_view(&state, game_id, &session).await?;
        return Ok((StatusCode::OK, Json(view)));
    }

    if status != GameStatus::Lobby {
        return Err(ApiError::conflict("not_joinable", "this game has already started"));
    }
    let seated: i64 =
        sqlx::query_scalar("SELECT count(*) FROM game_players WHERE game_id = $1")
            .bind(game_id)
            .fetch_one(&mut *tx)
            .await?;
    if seated >= hearts_core::MAX_PLAYERS as i64 {
        return Err(ApiError::conflict("game_full", "this game already has 7 players"));
    }

    sqlx::query(
        "INSERT INTO game_players (game_id, seat, session_token, user_id, display_name) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(game_id)
    .bind(seated as i32)
    .bind(session.token_hash.as_slice())
    .bind(session.user_id)
    .bind(&display_name)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE games SET last_activity_at = now() WHERE id = $1")
        .bind(game_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let view = game_view(&state, game_id, &session).await?;
    Ok((StatusCode::OK, Json(view)))
}

/// `POST /games/{id}/start` — creator only, 2–7 players. Picks the seed,
/// flips the row to `in_progress`, and brings the game to life in the
/// registry. The creator is seat 0 and deals round 1.
pub async fn start(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let mut tx = state.pool.begin().await?;
    let game: Option<(GameStatus, Vec<u8>)> = sqlx::query_as(
        "SELECT status, created_by_session FROM games WHERE id = $1 FOR UPDATE",
    )
    .bind(game_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (status, created_by) =
        game.ok_or_else(|| ApiError::not_found("game_not_found", "no such game"))?;
    if created_by != session.token_hash.as_slice() {
        return Err(ApiError::forbidden(
            "not_creator",
            "only the player who created the game can start it",
        ));
    }
    if status != GameStatus::Lobby {
        return Err(ApiError::conflict("already_started", "this game has already started"));
    }

    let players: Vec<(i32, Vec<u8>, String)> = sqlx::query_as(
        "SELECT seat, session_token, display_name FROM game_players \
         WHERE game_id = $1 ORDER BY seat",
    )
    .bind(game_id)
    .fetch_all(&mut *tx)
    .await?;
    if players.len() < hearts_core::MIN_PLAYERS {
        return Err(ApiError::conflict(
            "not_enough_players",
            "at least 2 players are needed to start",
        ));
    }

    let seed: u64 = rand::random();
    sqlx::query(
        "UPDATE games SET status = 'in_progress', seed = $2, started_at = now(), \
         last_activity_at = now() WHERE id = $1",
    )
    .bind(game_id)
    .bind(seed as i64)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let game = Game::new(players.len(), seed).expect("player count validated as 2..=7");
    let bindings = players
        .into_iter()
        .map(|(_, token_hash, display_name)| SeatBinding { token_hash, display_name })
        .collect();
    let mut active = ActiveGame::new(game, bindings, state.turn_timeout);
    let started = crate::gameplay::game_started_event(&active.game, &active.players);
    active.push_event(started);
    crate::persist::write_snapshot(&state.pool, game_id, &active.game).await;
    state.registry.insert(game_id, active).await;
    tracing::info!(%game_id, "game started");

    let view = game_view(&state, game_id, &session).await?;
    Ok((StatusCode::OK, Json(view)))
}

/// `GET /games/{id}` — the members-only view of a lobby or running game.
pub async fn show(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let view = game_view(&state, game_id, &session).await?;
    Ok(Json(view))
}

/// Build the game view for `session`, or 404 — non-members get the same
/// response as a missing game so game ids don't leak membership.
async fn game_view(
    state: &AppState,
    game_id: Uuid,
    session: &Session,
) -> Result<serde_json::Value, ApiError> {
    #[derive(sqlx::FromRow)]
    struct GameRow {
        invite_code: String,
        status: GameStatus,
        created_by_session: Vec<u8>,
        created_at: DateTime<Utc>,
        started_at: Option<DateTime<Utc>>,
    }
    let game: Option<GameRow> = sqlx::query_as(
        "SELECT invite_code, status, created_by_session, created_at, started_at \
         FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_optional(&state.pool)
    .await?;
    let not_found = || ApiError::not_found("game_not_found", "no such game");
    let GameRow { invite_code, status, created_by_session: created_by, created_at, started_at } =
        game.ok_or_else(not_found)?;

    let players: Vec<(i32, Vec<u8>, String)> = sqlx::query_as(
        "SELECT seat, session_token, display_name FROM game_players \
         WHERE game_id = $1 ORDER BY seat",
    )
    .bind(game_id)
    .fetch_all(&state.pool)
    .await?;
    if !players.iter().any(|(_, token, _)| token == session.token_hash.as_slice()) {
        return Err(not_found());
    }

    // Live engine state for a running game, straight from the registry:
    // public info for everyone, plus hand and legal moves for the viewer.
    let mut engine = None;
    if let Some(entry) = state.registry.get(game_id).await {
        let active = entry.lock().await;
        let viewer = active.seat_of(session.token_hash.as_slice());
        engine = Some(crate::gameplay::engine_view(&active, viewer));
    }

    let players: Vec<_> = players
        .into_iter()
        .map(|(seat, token, display_name)| {
            json!({
                "seat": seat,
                "display_name": display_name,
                "is_you": token == session.token_hash.as_slice(),
                "is_creator": token == created_by,
            })
        })
        .collect();
    Ok(json!({
        "id": game_id,
        "invite_code": invite_code,
        "status": status,
        "players": players,
        "game": engine,
        "created_at": created_at,
        "started_at": started_at,
    }))
}

fn new_invite_code() -> String {
    (0..INVITE_CODE_LEN)
        .map(|_| INVITE_ALPHABET[rand::random_range(0..INVITE_ALPHABET.len())] as char)
        .collect()
}

fn clean_display_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_DISPLAY_NAME_LEN {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            format!("display_name must be 1..={MAX_DISPLAY_NAME_LEN} characters"),
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            "display_name may not contain control characters",
        ));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_codes_use_the_unambiguous_alphabet() {
        for _ in 0..100 {
            let code = new_invite_code();
            assert_eq!(code.len(), INVITE_CODE_LEN);
            assert!(code.bytes().all(|b| INVITE_ALPHABET.contains(&b)), "{code}");
        }
    }

    #[test]
    fn display_names_are_validated() {
        assert_eq!(clean_display_name("  sean  ").unwrap(), "sean");
        assert!(clean_display_name("").is_err());
        assert!(clean_display_name("   ").is_err());
        assert!(clean_display_name(&"x".repeat(33)).is_err());
        assert!(clean_display_name("a\nb").is_err());
        assert_eq!(clean_display_name(&"é".repeat(32)).unwrap(), "é".repeat(32));
    }
}
