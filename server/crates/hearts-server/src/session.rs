//! Anonymous sessions (docs/server-design.md §Users & sessions).
//!
//! `POST /session` issues an opaque 256-bit token; the client presents it
//! as `Authorization: Bearer <hex>` on every subsequent request. Only the
//! SHA-256 of the token is stored, so a leaked database yields no usable
//! credentials. Sessions start anonymous (`user_id IS NULL`); logging in
//! to a lite account later binds the same session to a user.
//!
//! Expiry is sliding: every authenticated request pushes `expires_at`
//! another [`SESSION_TTL_DAYS`] out and refreshes `last_seen_at`.

use axum::extract::{FromRequestParts, State};
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Json};
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::ApiError;
use crate::state::AppState;

const TOKEN_BYTES: usize = 32;
const SESSION_TTL_DAYS: i64 = 30;

/// `POST /session` — create an anonymous session. The token in the
/// response is shown exactly once; the server keeps only its hash.
pub async fn create(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let token: [u8; TOKEN_BYTES] = rand::random();
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
    sqlx::query("INSERT INTO sessions (token, expires_at) VALUES ($1, $2)")
        .bind(Sha256::digest(token).as_slice())
        .bind(expires_at)
        .execute(&state.pool)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "token": hex_encode(&token), "expires_at": expires_at })),
    ))
}

/// `GET /session` — introspect the presented token: proves the extractor
/// accepts it and reports any bound account.
pub async fn show(session: Session) -> Json<serde_json::Value> {
    Json(json!({ "user_id": session.user_id, "expires_at": session.expires_at }))
}

/// An authenticated (possibly anonymous) caller. Extracting this from a
/// request validates the bearer token against the database and slides the
/// session's expiry.
#[derive(Debug, Clone)]
pub struct Session {
    /// SHA-256 of the token: the `sessions` primary key, used to link
    /// rows (e.g. `game_players.session_token`) without holding the
    /// secret itself.
    pub token_hash: [u8; 32],
    pub user_id: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
}

impl FromRequestParts<AppState> for Session {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = bearer_token(parts).ok_or_else(|| {
            ApiError::unauthorized(
                "missing_token",
                "provide a session token as `Authorization: Bearer <token>` \
                 (create one with POST /session)",
            )
        })?;
        let token_bytes = hex_decode(&token)
            .filter(|bytes| bytes.len() == TOKEN_BYTES)
            .ok_or_else(|| {
                ApiError::unauthorized("malformed_token", "session token is not valid")
            })?;
        let token_hash: [u8; 32] = Sha256::digest(&token_bytes).into();

        let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
        let row: Option<(Option<Uuid>,)> = sqlx::query_as(
            "UPDATE sessions SET last_seen_at = now(), expires_at = $2 \
             WHERE token = $1 AND expires_at > now() RETURNING user_id",
        )
        .bind(token_hash.as_slice())
        .bind(expires_at)
        .fetch_optional(&state.pool)
        .await?;

        let (user_id,) = row.ok_or_else(|| {
            ApiError::unauthorized("invalid_token", "session not found or expired")
        })?;
        Ok(Session { token_hash, user_id, expires_at })
    }
}

fn bearer_token(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(|token| token.trim().to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let bytes: Vec<u8> = (0..=255).collect();
        assert_eq!(hex_decode(&hex_encode(&bytes)), Some(bytes));
    }

    #[test]
    fn hex_decode_rejects_junk() {
        assert_eq!(hex_decode("0g"), None); // non-hex digit
        assert_eq!(hex_decode("abc"), None); // odd length
        assert_eq!(hex_decode("aé"), None); // multi-byte char boundary
        assert_eq!(hex_decode(""), Some(vec![]));
    }
}
