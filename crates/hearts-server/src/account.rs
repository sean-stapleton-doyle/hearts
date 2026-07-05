//! Lite accounts and history (docs/server-design.md §Users & sessions):
//! username + password only — no email stored; verification remains an
//! open question and is not implemented in v1.
//!
//! Accounts *bind* sessions rather than replace them: play stays
//! session-based, and logging in stamps `user_id` onto the session plus —
//! retroactively — onto games this session created or played while
//! anonymous, so history survives the upgrade.

use std::sync::OnceLock;

use argon2::password_hash::{PasswordHash, SaltString};
use argon2::{Algorithm, Argon2, Params, PasswordHasher, PasswordVerifier, Version};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgTransaction;
use uuid::Uuid;

use crate::error::ApiError;
use crate::lobby::GameStatus;
use crate::ratelimit::ClientIp;
use crate::session::{self, Session};
use crate::state::AppState;

const MIN_PASSWORD_LEN: usize = 8;
const MAX_PASSWORD_LEN: usize = 128;
const MIN_USERNAME_LEN: usize = 3;
const MAX_USERNAME_LEN: usize = 32;

#[derive(Debug, Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}

/// `POST /account/register` — create a lite account and bind it to the
/// calling session.
pub async fn register(
    State(state): State<AppState>,
    session: Session,
    ClientIp(ip): ClientIp,
    Json(body): Json<Credentials>,
) -> Result<impl IntoResponse, ApiError> {
    state.rate_limiter.check("register", ip, 10, std::time::Duration::from_secs(300))?;
    if session.user_id.is_some() {
        return Err(ApiError::conflict("already_logged_in", "this session is already logged in"));
    }
    let username = clean_username(&body.username)?;
    validate_password(&body.password)?;
    let password_hash = hash_password(body.password).await?;

    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
    )
    .bind(&username)
    .bind(&password_hash)
    .fetch_one(&mut *tx)
    .await;
    let user_id = match inserted {
        Ok(id) => id,
        Err(sqlx::Error::Database(db))
            if db.kind() == sqlx::error::ErrorKind::UniqueViolation =>
        {
            return Err(ApiError::conflict("username_taken", "that username is taken"));
        }
        Err(error) => return Err(error.into()),
    };
    let new_token = rotate_and_bind_session(&mut tx, user_id, &session.token_hash).await?;
    tx.commit().await?;

    tracing::info!(%user_id, username, "account registered");
    Ok((
        StatusCode::CREATED,
        Json(json!({ "user_id": user_id, "username": username, "token": new_token })),
    ))
}

/// `POST /account/login` — bind this session to an existing account
/// (re-binding a logged-in session switches accounts).
pub async fn login(
    State(state): State<AppState>,
    session: Session,
    ClientIp(ip): ClientIp,
    Json(body): Json<Credentials>,
) -> Result<impl IntoResponse, ApiError> {
    state.rate_limiter.check("login", ip, 10, std::time::Duration::from_secs(300))?;
    let username = clean_username(&body.username)?;
    let user: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = $1")
            .bind(&username)
            .fetch_optional(&state.pool)
            .await?;

    // Verify against a dummy hash when the user doesn't exist, so response
    // timing doesn't reveal which usernames are registered.
    let (user_id, stored_hash) = match user {
        Some((id, hash)) => (Some(id), hash),
        None => (None, dummy_hash().to_string()),
    };
    let verified = verify_password(body.password, stored_hash).await?;
    let Some(user_id) = user_id.filter(|_| verified) else {
        return Err(ApiError::unauthorized("invalid_credentials", "wrong username or password"));
    };

    let mut tx = state.pool.begin().await?;
    let new_token = rotate_and_bind_session(&mut tx, user_id, &session.token_hash).await?;
    tx.commit().await?;
    Ok(Json(json!({ "user_id": user_id, "username": username, "token": new_token })))
}

/// `POST /account/logout` — detach the account; the session itself stays
/// valid (and stays seated in any games it joined).
pub async fn logout(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, ApiError> {
    sqlx::query("UPDATE sessions SET user_id = NULL WHERE token = $1")
        .bind(session.token_hash.as_slice())
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "logged_out": true })))
}

/// `GET /me`
pub async fn me(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = require_user(&session)?;
    let (username, created_at): (String, DateTime<Utc>) =
        sqlx::query_as("SELECT username, created_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;
    Ok(Json(json!({ "user_id": user_id, "username": username, "created_at": created_at })))
}

/// `GET /me/games` — games this account created or played, newest first,
/// with results where finished.
pub async fn my_games(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = require_user(&session)?;

    #[derive(sqlx::FromRow)]
    struct HistoryRow {
        id: Uuid,
        status: GameStatus,
        created_at: DateTime<Utc>,
        started_at: Option<DateTime<Utc>>,
        finished_at: Option<DateTime<Utc>>,
        created_by_you: bool,
        your_seat: Option<i32>,
        players: Option<Vec<String>>,
        scores: Option<Vec<i32>>,
        winner_seats: Option<Vec<i32>>,
    }
    let rows: Vec<HistoryRow> = sqlx::query_as(
        "SELECT g.id, g.status, g.created_at, g.started_at, g.finished_at, \
                COALESCE(g.created_by_user_id = $1, false) AS created_by_you, \
                p.seat AS your_seat, \
                (SELECT array_agg(gp.display_name ORDER BY gp.seat) \
                 FROM game_players gp WHERE gp.game_id = g.id) AS players, \
                r.scores, r.winner_seats \
         FROM games g \
         LEFT JOIN game_players p ON p.game_id = g.id AND p.user_id = $1 \
         LEFT JOIN game_results r ON r.game_id = g.id \
         WHERE g.created_by_user_id = $1 OR p.user_id = $1 \
         ORDER BY g.created_at DESC \
         LIMIT 100",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    let games: Vec<_> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.id,
                "status": row.status,
                "created_at": row.created_at,
                "started_at": row.started_at,
                "finished_at": row.finished_at,
                "created_by_you": row.created_by_you,
                "your_seat": row.your_seat,
                "players": row.players.unwrap_or_default(),
                "result": row.scores.map(|scores| json!({
                    "scores": scores,
                    "winner_seats": row.winner_seats,
                })),
            })
        })
        .collect();
    Ok(Json(json!({ "games": games })))
}

/// `GET /me/stats` — aggregate record over every seat this account has
/// held. Averages and bests only cover finished games (lower is better
/// in hearts, so "best" is the minimum final score).
pub async fn my_stats(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = require_user(&session)?;

    #[derive(sqlx::FromRow)]
    struct StatsRow {
        games_played: i64,
        games_finished: i64,
        wins: i64,
        average_score: Option<f64>,
        best_score: Option<i32>,
    }
    // Postgres arrays are 1-indexed; seats are 0-indexed.
    let stats: StatsRow = sqlx::query_as(
        "SELECT count(*) AS games_played, \
                count(r.game_id) AS games_finished, \
                count(*) FILTER (WHERE p.seat = ANY(r.winner_seats)) AS wins, \
                avg(r.scores[p.seat + 1])::float8 AS average_score, \
                min(r.scores[p.seat + 1]) AS best_score \
         FROM game_players p \
         LEFT JOIN game_results r ON r.game_id = p.game_id \
         WHERE p.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({
        "games_played": stats.games_played,
        "games_finished": stats.games_finished,
        "wins": stats.wins,
        "average_score": stats.average_score,
        "best_score": stats.best_score,
    })))
}

/// `GET /games/{id}/snapshots` — the per-round engine snapshots, for
/// analysis. Participants only, and only once the game can no longer be
/// played: snapshots contain the full deck order and every hand.
pub async fn game_snapshots(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let not_found = || ApiError::not_found("game_not_found", "no such game");
    let game: Option<(GameStatus, Vec<u8>, Option<Uuid>)> = sqlx::query_as(
        "SELECT status, created_by_session, created_by_user_id FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_optional(&state.pool)
    .await?;
    let (status, created_by_session, created_by_user) = game.ok_or_else(not_found)?;

    let seated: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM game_players \
         WHERE game_id = $1 AND (session_token = $2 OR user_id = $3))",
    )
    .bind(game_id)
    .bind(session.token_hash.as_slice())
    .bind(session.user_id)
    .fetch_one(&state.pool)
    .await?;
    let creator = created_by_session == session.token_hash.as_slice()
        || (created_by_user.is_some() && created_by_user == session.user_id);
    if !seated && !creator {
        return Err(not_found());
    }
    if matches!(status, GameStatus::Lobby | GameStatus::InProgress) {
        return Err(ApiError::conflict(
            "snapshots_unavailable",
            "snapshots reveal hidden information and are only available once the game is over",
        ));
    }

    let rows: Vec<(i32, serde_json::Value, DateTime<Utc>)> = sqlx::query_as(
        "SELECT round_index, state, created_at FROM game_snapshots \
         WHERE game_id = $1 ORDER BY round_index",
    )
    .bind(game_id)
    .fetch_all(&state.pool)
    .await?;
    let snapshots: Vec<_> = rows
        .into_iter()
        .map(|(round_index, state, created_at)| {
            json!({ "round_index": round_index, "state": state, "created_at": created_at })
        })
        .collect();
    Ok(Json(json!({ "game_id": game_id, "snapshots": snapshots })))
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn require_user(session: &Session) -> Result<Uuid, ApiError> {
    session
        .user_id
        .ok_or_else(|| ApiError::unauthorized("login_required", "this endpoint needs an account"))
}

/// Mint a fresh session token, retarget it wherever the old one was the
/// live identity (`sessions.token` itself, plus `games.created_by_session`
/// / `game_players.session_token` — both unconditional, since those columns
/// are "whichever token currently holds this seat/game", not an ownership
/// claim), then run the normal [`bind_session`] against the new hash.
/// Returns the new raw hex token for the client to store in place of the
/// old one (old one stops working the moment this commits — a login/join
/// is a deliberate action, not a mid-hand one, so that's an acceptable
/// transition window).
async fn rotate_and_bind_session(
    tx: &mut PgTransaction<'_>,
    user_id: Uuid,
    old_token_hash: &[u8; 32],
) -> Result<String, sqlx::Error> {
    let new_token: [u8; 32] = rand::random();
    let new_hash: [u8; 32] = Sha256::digest(new_token).into();

    sqlx::query("UPDATE sessions SET token = $1 WHERE token = $2")
        .bind(new_hash.as_slice())
        .bind(old_token_hash.as_slice())
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE games SET created_by_session = $1 WHERE created_by_session = $2")
        .bind(new_hash.as_slice())
        .bind(old_token_hash.as_slice())
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE game_players SET session_token = $1 WHERE session_token = $2")
        .bind(new_hash.as_slice())
        .bind(old_token_hash.as_slice())
        .execute(&mut **tx)
        .await?;

    bind_session(tx, user_id, &new_hash).await?;
    Ok(session::hex_encode(&new_token))
}

/// Stamp the account onto the session, and claim anything this session
/// did anonymously (created games, seats) for the account's history.
async fn bind_session(
    tx: &mut PgTransaction<'_>,
    user_id: Uuid,
    token_hash: &[u8; 32],
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sessions SET user_id = $1 WHERE token = $2")
        .bind(user_id)
        .bind(token_hash.as_slice())
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "UPDATE games SET created_by_user_id = $1 \
         WHERE created_by_session = $2 AND created_by_user_id IS NULL",
    )
    .bind(user_id)
    .bind(token_hash.as_slice())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE game_players SET user_id = $1 WHERE session_token = $2 AND user_id IS NULL",
    )
    .bind(user_id)
    .bind(token_hash.as_slice())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn clean_username(username: &str) -> Result<String, ApiError> {
    let username = username.trim().to_lowercase();
    let len_ok = (MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&username.chars().count());
    let chars_ok = username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !len_ok || !chars_ok {
        return Err(ApiError::bad_request(
            "invalid_username",
            format!(
                "username must be {MIN_USERNAME_LEN}..={MAX_USERNAME_LEN} characters of \
                 a-z, 0-9, '-' or '_'"
            ),
        ));
    }
    Ok(username)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if !(MIN_PASSWORD_LEN..=MAX_PASSWORD_LEN).contains(&password.chars().count()) {
        return Err(ApiError::bad_request(
            "invalid_password",
            format!("password must be {MIN_PASSWORD_LEN}..={MAX_PASSWORD_LEN} characters"),
        ));
    }
    Ok(())
}

/// OWASP's top-recommended Argon2id config (46 MiB, 1 iteration, 1 lane) —
/// stronger memory-hardness than the crate's default (19 MiB, t=2, p=1;
/// itself an OWASP-endorsed config, not a weak one) at similar CPU cost.
fn argon2() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(47104, 1, 1, None).expect("static Argon2 params are valid"),
    )
}

/// Argon2id is deliberately slow (~100ms of CPU); keep it off the async
/// workers.
async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || {
        let salt = new_salt();
        argon2()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    })
    .await
    .map_err(|_| ApiError::internal("hashing task failed"))?
    .map_err(|_| ApiError::internal("password hashing failed"))
}

async fn verify_password(password: String, stored_hash: String) -> Result<bool, ApiError> {
    tokio::task::spawn_blocking(move || {
        let Ok(parsed) = PasswordHash::new(&stored_hash) else {
            return false;
        };
        argon2().verify_password(password.as_bytes(), &parsed).is_ok()
    })
    .await
    .map_err(|_| ApiError::internal("verification task failed"))
}

fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        argon2()
            .hash_password(b"timing-equalizer-dummy", &new_salt())
            .expect("argon2 hashes a constant")
            .to_string()
    })
}

fn new_salt() -> SaltString {
    SaltString::encode_b64(&rand::random::<[u8; 16]>()).expect("16 bytes fit in a salt")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_are_normalized_and_validated() {
        assert_eq!(clean_username("  Sean_01 ").unwrap(), "sean_01");
        assert_eq!(clean_username("A-b").unwrap(), "a-b");
        assert!(clean_username("ab").is_err()); // too short
        assert!(clean_username("has space").is_err());
        assert!(clean_username("émile").is_err()); // non-ascii
        assert!(clean_username(&"x".repeat(33)).is_err());
    }

    #[test]
    fn passwords_are_length_checked() {
        assert!(validate_password("1234567").is_err());
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password(&"x".repeat(129)).is_err());
    }
}
