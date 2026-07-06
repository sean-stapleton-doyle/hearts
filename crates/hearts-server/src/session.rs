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

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

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

// ── SSE stream tickets ──────────────────────────────────────────────────
// `EventSource` exposes no header API, so the stream must authenticate via
// the URL — but URLs land in server/proxy access logs and browser history,
// so the long-lived session token must never ride there. Instead the
// client POSTs /games/{id}/events-ticket (normal bearer auth) for a
// short-lived single-use ticket and opens the stream with `?ticket=`.
// Leaking a spent or expired ticket is worthless.

/// How long an issued ticket may sit unredeemed. Long enough for the
/// client to turn around and open the stream; short enough that a logged
/// ticket is stale by the time anyone reads the log.
pub const SSE_TICKET_TTL: std::time::Duration = std::time::Duration::from_secs(30);

struct TicketEntry {
    game_id: Uuid,
    /// Snapshot of the issuing session. Redemption skips the database
    /// revalidation (and expiry slide) a bearer request would do — at a
    /// 30-second TTL the snapshot cannot be meaningfully stale.
    session: Session,
    expires_at: Instant,
}

/// In-memory single-use tickets, keyed by SHA-256 of the ticket (the
/// secret itself is never stored, mirroring session tokens). Deliberately
/// not persisted: a server restart invalidates outstanding tickets and the
/// web client's reconnect loop simply fetches a fresh one.
#[derive(Clone, Default)]
pub struct SseTickets(Arc<Mutex<HashMap<[u8; 32], TicketEntry>>>);

impl SseTickets {
    /// Mint a ticket for `session` to open `game_id`'s stream. Expired
    /// entries are purged lazily here — the map only ever holds tickets
    /// issued in the last [`SSE_TICKET_TTL`], so there is no sweeper task.
    pub fn issue(&self, game_id: Uuid, session: Session) -> String {
        let ticket: [u8; TOKEN_BYTES] = rand::random();
        let now = Instant::now();
        let mut tickets = self.0.lock().expect("sse ticket lock");
        tickets.retain(|_, entry| entry.expires_at > now);
        tickets.insert(
            Sha256::digest(ticket).into(),
            TicketEntry { game_id, session, expires_at: now + SSE_TICKET_TTL },
        );
        hex_encode(&ticket)
    }

    /// Redeem a presented ticket exactly once: returns the issuing session
    /// and the game the ticket was bound to, or `None` for anything
    /// unknown, expired, malformed, or already spent.
    pub fn redeem(&self, ticket_hex: &str) -> Option<(Uuid, Session)> {
        let bytes = hex_decode(ticket_hex).filter(|bytes| bytes.len() == TOKEN_BYTES)?;
        let hash: [u8; 32] = Sha256::digest(&bytes).into();
        let entry = self.0.lock().expect("sse ticket lock").remove(&hash)?;
        (entry.expires_at > Instant::now()).then_some((entry.game_id, entry.session))
    }
}

/// Auth for the SSE route: the usual bearer header (curl, native clients),
/// or a `?ticket=` one-time ticket (browsers — see [`SseTickets`]).
/// `ticket_game` is set when a ticket authenticated the request; the
/// handler must check it matches the requested game.
#[derive(Debug, Clone)]
pub struct SseSession {
    pub session: Session,
    pub ticket_game: Option<Uuid>,
}

impl FromRequestParts<AppState> for SseSession {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        if let Some(token) = bearer_token(parts) {
            let session = resolve_token(state, token).await?;
            return Ok(SseSession { session, ticket_game: None });
        }
        let ticket = query_param(parts, "ticket").ok_or_else(|| {
            ApiError::unauthorized(
                "missing_token",
                "provide a session token as `Authorization: Bearer <token>`, or fetch a \
                 one-time stream ticket from POST /games/{id}/events-ticket and pass it \
                 as `?ticket=<hex>`",
            )
        })?;
        let (game_id, session) = state.sse_tickets.redeem(&ticket).ok_or_else(|| {
            ApiError::unauthorized(
                "invalid_ticket",
                "stream ticket is unknown, expired, or already used — fetch a fresh one \
                 from POST /games/{id}/events-ticket",
            )
        })?;
        Ok(SseSession { session, ticket_game: Some(game_id) })
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

/// Scan the query string for one key. Tickets are plain hex, so no
/// URL-decoding is needed.
fn query_param(parts: &Parts, wanted: &str) -> Option<String> {
    let query = parts.uri.query()?;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == wanted).then(|| value.to_string())
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
    fn query_param_scans_pairs() {
        assert_eq!(
            query_param(&parts_with_query("?ticket=deadbeef"), "ticket"),
            Some("deadbeef".to_string())
        );
        // Among several params.
        assert_eq!(
            query_param(&parts_with_query("?foo=1&ticket=cafe&bar=2"), "ticket"),
            Some("cafe".to_string())
        );
        // No such param at all.
        assert_eq!(query_param(&parts_with_query("?foo=1"), "ticket"), None);
        // No query string.
        assert_eq!(query_param(&parts_with_query(""), "ticket"), None);
    }

    fn test_session() -> Session {
        Session { token_hash: [7; 32], user_id: None, expires_at: Utc::now() }
    }

    #[test]
    fn ticket_redeems_exactly_once_for_its_game() {
        let tickets = SseTickets::default();
        let game = Uuid::new_v4();
        let ticket = tickets.issue(game, test_session());

        let (redeemed_game, session) = tickets.redeem(&ticket).expect("first redeem");
        assert_eq!(redeemed_game, game);
        assert_eq!(session.token_hash, [7; 32]);
        // Spent: the second presentation of the same ticket fails.
        assert!(tickets.redeem(&ticket).is_none());
    }

    #[test]
    fn ticket_rejects_junk() {
        let tickets = SseTickets::default();
        tickets.issue(Uuid::new_v4(), test_session());
        assert!(tickets.redeem("not-hex").is_none());
        assert!(tickets.redeem("deadbeef").is_none()); // wrong length
        assert!(tickets.redeem(&hex_encode(&[0u8; TOKEN_BYTES])).is_none()); // never issued
    }

    #[test]
    fn expired_ticket_is_rejected() {
        let tickets = SseTickets::default();
        let ticket: [u8; TOKEN_BYTES] = rand::random();
        // Plant an already-expired entry directly (Instant can't be mocked).
        let expired = Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        tickets.0.lock().unwrap().insert(
            Sha256::digest(ticket).into(),
            TicketEntry { game_id: Uuid::new_v4(), session: test_session(), expires_at: expired },
        );
        assert!(tickets.redeem(&hex_encode(&ticket)).is_none());
    }

    #[test]
    fn distinct_tickets_are_independent() {
        let tickets = SseTickets::default();
        let (game_a, game_b) = (Uuid::new_v4(), Uuid::new_v4());
        let ticket_a = tickets.issue(game_a, test_session());
        let ticket_b = tickets.issue(game_b, test_session());
        // Each ticket carries its own game binding; redeeming one doesn't
        // disturb the other.
        assert_eq!(tickets.redeem(&ticket_b).map(|(game, _)| game), Some(game_b));
        assert_eq!(tickets.redeem(&ticket_a).map(|(game, _)| game), Some(game_a));
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
