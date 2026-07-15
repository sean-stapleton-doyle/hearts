//! In-game chat. Messages ride the game's existing per-game broadcast + event
//! log (so live delivery and reconnect replay come for free — see
//! [`crate::registry`]) but change no game state. Unlike the event log they are
//! also persisted to `chat_messages`, so the scrollback survives reloads and
//! restarts. Each row's `id` (globally monotonic `bigserial`) is the canonical
//! id every client dedups on: a reconnect replays the message over SSE while
//! the history GET returns the same row, and dedup-by-id makes that idempotent.
//!
//! Chat is scoped to a *running* game: `send` needs the game live in the
//! registry (to authorize the seat and fan out), while `history` reads straight
//! from Postgres, so it keeps working after the game finishes.

use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::ApiError;
use crate::gameplay::{ChatKind, GameEvent, active_entry, seat_of_member};
use crate::ratelimit::ClientIp;
use crate::session::Session;
use crate::state::AppState;

/// A spoken message can be a sentence; a reaction is a single emoji (16 is
/// generous — some emoji are several code points).
const MAX_TEXT_LEN: usize = 280;
const MAX_REACT_LEN: usize = 16;
/// Most recent messages returned by the history endpoint / replay cap.
const HISTORY_LIMIT: i64 = 200;

#[derive(Debug, Deserialize)]
pub struct SendBody {
    kind: ChatKind,
    body: String,
}

/// `POST /games/{id}/chat` — send a chat message or reaction. Members of a
/// running game only. Modeled on [`crate::gameplay::bid`], minus the
/// round-gate check: chat is allowed even while the table waits on the host to
/// acknowledge a completed round. Rate-limited because, unlike bid/play, chat
/// isn't naturally throttled by turn order.
pub async fn send(
    State(state): State<AppState>,
    session: Session,
    ClientIp(ip): ClientIp,
    Path(game_id): Path<Uuid>,
    Json(payload): Json<SendBody>,
) -> Result<impl IntoResponse, ApiError> {
    state.rate_limiter.check("chat_send", ip, 20, Duration::from_secs(60))?;
    let body = clean_chat_body(&payload.body, payload.kind)?;

    let entry = active_entry(&state, game_id).await?;
    let mut active = entry.lock().await;
    let seat = seat_of_member(&active, &session)?;
    let name = active.players[seat].display_name.clone();

    // Persist first so the row `id` — the id every client dedups on — exists
    // before the event that carries it goes out. Holding the game mutex across
    // the insert mirrors `apply_play` holding it across `write_snapshot`.
    let (id, created_at): (i64, DateTime<Utc>) = sqlx::query_as(
        "INSERT INTO chat_messages (game_id, seat, kind, display_name, body) \
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at",
    )
    .bind(game_id)
    .bind(seat as i32)
    .bind(payload.kind.as_str())
    .bind(&name)
    .bind(&body)
    .fetch_one(&state.pool)
    .await?;

    let seq = active.push_event(GameEvent::ChatMessage {
        id,
        seat,
        kind: payload.kind,
        name,
        body,
        sent_at: created_at.to_rfc3339(),
    });
    drop(active);
    Ok((StatusCode::CREATED, Json(json!({ "id": id, "seq": seq }))))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    /// Return only messages with `id` greater than this (a cursor). Omitted =
    /// from the beginning.
    after: Option<i64>,
}

/// `GET /games/{id}/chat?after=<id>` — chat history for a member. Reads from
/// Postgres (not the registry), so it works for finished games too, and
/// authorizes against the persistent roster rather than a live seat.
pub async fn history(
    State(state): State<AppState>,
    session: Session,
    Path(game_id): Path<Uuid>,
    Query(query): Query<HistoryQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let member: Option<(i32,)> = sqlx::query_as(
        "SELECT seat FROM game_players WHERE game_id = $1 AND session_token = $2",
    )
    .bind(game_id)
    .bind(session.token_hash.as_slice())
    .fetch_optional(&state.pool)
    .await?;
    // Non-members get the same answer as a missing game (no membership leak).
    if member.is_none() {
        return Err(ApiError::not_found("game_not_found", "no such game"));
    }

    let rows: Vec<(i64, i32, String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, seat, kind, display_name, body, created_at FROM chat_messages \
         WHERE game_id = $1 AND id > $2 ORDER BY id LIMIT $3",
    )
    .bind(game_id)
    .bind(query.after.unwrap_or(0))
    .bind(HISTORY_LIMIT)
    .fetch_all(&state.pool)
    .await?;

    let messages: Vec<_> = rows
        .into_iter()
        .map(|(id, seat, kind, name, body, created_at)| {
            json!({
                "id": id,
                "seat": seat,
                "kind": kind,
                "name": name,
                "body": body,
                "sent_at": created_at.to_rfc3339(),
            })
        })
        .collect();
    Ok(Json(json!({ "messages": messages })))
}

/// Trim, reject empty/control-char messages, and cap length by kind. Mirrors
/// `lobby::clean_display_name`.
fn clean_chat_body(body: &str, kind: ChatKind) -> Result<String, ApiError> {
    let body = body.trim();
    let max = match kind {
        ChatKind::Text => MAX_TEXT_LEN,
        ChatKind::React => MAX_REACT_LEN,
    };
    if body.is_empty() || body.chars().count() > max {
        return Err(ApiError::bad_request(
            "invalid_chat_body",
            format!("message must be 1..={max} characters"),
        ));
    }
    if body.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "invalid_chat_body",
            "message may not contain control characters",
        ));
    }
    Ok(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_accepts_a_normal_message() {
        assert_eq!(clean_chat_body("  hi there  ", ChatKind::Text).unwrap(), "hi there");
        assert_eq!(clean_chat_body("👍", ChatKind::React).unwrap(), "👍");
    }

    #[test]
    fn rejects_empty_or_whitespace_only() {
        assert!(clean_chat_body("   ", ChatKind::Text).is_err());
        assert!(clean_chat_body("", ChatKind::React).is_err());
    }

    #[test]
    fn caps_length_by_kind() {
        assert!(clean_chat_body(&"x".repeat(MAX_TEXT_LEN), ChatKind::Text).is_ok());
        assert!(clean_chat_body(&"x".repeat(MAX_TEXT_LEN + 1), ChatKind::Text).is_err());
        // A reaction has a much tighter cap, so a long sentence is rejected.
        assert!(clean_chat_body(&"x".repeat(MAX_REACT_LEN + 1), ChatKind::React).is_err());
    }

    #[test]
    fn rejects_control_characters() {
        assert!(clean_chat_body("hi\u{0}there", ChatKind::Text).is_err());
        assert!(clean_chat_body("line\nbreak", ChatKind::Text).is_err());
    }
}
