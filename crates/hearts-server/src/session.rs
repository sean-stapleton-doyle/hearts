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
use crate::ratelimit::ClientIp;
use crate::state::AppState;

const TOKEN_BYTES: usize = 32;
const SESSION_TTL_DAYS: i64 = 30;

/// `POST /session` — create an anonymous session. The token in the
/// response is shown exactly once; the server keeps only its hash.
/// Unauthenticated and cheap, but still worth a loose per-IP cap against
/// spamming the `sessions` table.
pub async fn create(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
) -> Result<impl IntoResponse, ApiError> {
    state.rate_limiter.check("session_create", ip, 30, std::time::Duration::from_secs(300))?;
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
        resolve_token(state, token).await
    }
}

/// Auth for the one endpoint a browser cannot set headers on — `EventSource`
/// exposes no header API. Accepts the bearer header, and falls back to a
/// `?token=<hex>` query parameter. Otherwise identical to [`Session`], so the
/// SSE handler destructures it and uses the inner [`Session`] directly.
#[derive(Debug, Clone)]
pub struct SseSession(pub Session);

impl FromRequestParts<AppState> for SseSession {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = bearer_token(parts)
            .or_else(|| query_token(parts))
            .ok_or_else(|| {
                ApiError::unauthorized(
                    "missing_token",
                    "provide a session token as `Authorization: Bearer <token>` or a \
                     `?token=<hex>` query parameter (create one with POST /session)",
                )
            })?;
        Ok(SseSession(resolve_token(state, token).await?))
    }
}

/// Validate a presented token string (from the header or the query string)
/// against the database and return the resolved session, sliding its expiry.
/// Shared by [`Session`] and [`SseSession`].
async fn resolve_token(state: &AppState, token: String) -> Result<Session, ApiError> {
    let token_bytes = hex_decode(&token)
        .filter(|bytes| bytes.len() == TOKEN_BYTES)
        .ok_or_else(|| {
            ApiError::unauthorized("malformed_token", "session token is not valid")
        })?;
    let token_hash: [u8; 32] = Sha256::digest(&token_bytes).into();

    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
    let query_started = std::time::Instant::now();
    let row: Option<(Option<Uuid>,)> = sqlx::query_as(
        "UPDATE sessions SET last_seen_at = now(), expires_at = $2 \
         WHERE token = $1 AND expires_at > now() RETURNING user_id",
    )
    .bind(token_hash.as_slice())
    .bind(expires_at)
    .fetch_optional(&state.pool)
    .await?;
    let elapsed = query_started.elapsed();
    if elapsed.as_millis() > 50 {
        tracing::warn!(?elapsed, "session token UPDATE was slow");
    } else {
        tracing::debug!(?elapsed, "session token resolved");
    }

    let (user_id,) = row.ok_or_else(|| {
        ApiError::unauthorized("invalid_token", "session not found or expired")
    })?;
    Ok(Session { token_hash, user_id, expires_at })
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

/// `?token=<hex>` fallback for the SSE stream, since browsers cannot set
/// request headers on `EventSource`. Tokens are plain hex, so no
/// URL-decoding is needed — we just scan the query pairs for a `token` key.
fn query_token(parts: &Parts) -> Option<String> {
    let query = parts.uri.query()?;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token").then(|| value.to_string())
    })
}

/// Exposed to `account.rs`, which mints a fresh token on login/register
/// (session rotation) the same way [`create`] does.
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
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
    use axum::http::Request;

    fn parts_with_query(query: &str) -> Parts {
        let uri = format!("/{query}").parse::<axum::http::Uri>().unwrap();
        Request::builder().uri(uri).body(()).unwrap().into_parts().0
    }

    #[test]
    fn query_token_picks_up_token_param() {
        assert_eq!(
            query_token(&parts_with_query("?token=deadbeef")),
            Some("deadbeef".to_string())
        );
        // Among several params.
        assert_eq!(
            query_token(&parts_with_query("?foo=1&token=cafe&bar=2")),
            Some("cafe".to_string())
        );
        // No `token` param at all.
        assert_eq!(query_token(&parts_with_query("?foo=1")), None);
        // No query string.
        assert_eq!(query_token(&parts_with_query("")), None);
    }

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
