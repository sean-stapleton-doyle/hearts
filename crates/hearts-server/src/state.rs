//! Shared application state, cloned into every handler.
//!
//! Will grow the in-memory active-game map alongside the pool; both are
//! cheap to clone (`PgPool` is an `Arc` internally, the game map will be
//! too).

use std::time::Duration;

use sqlx::PgPool;

use crate::ratelimit::RateLimiter;
use crate::registry::GameRegistry;
use crate::session::SseTickets;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub registry: GameRegistry,
    pub turn_timeout: Duration,
    pub lobby_expiry: Duration,
    pub rate_limiter: RateLimiter,
    pub sse_tickets: SseTickets,
}
