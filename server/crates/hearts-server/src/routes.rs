//! Route table and handlers. Handlers move to submodules as they grow;
//! for now the skeleton only exposes liveness.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde_json::json;

use crate::account;
use crate::gameplay;
use crate::lobby;
use crate::session;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/session", post(session::create).get(session::show))
        .route("/games", post(lobby::create))
        // One param name for every /games/{...} route: axum's router
        // rejects conflicting captures at the same position. Join takes an
        // invite code here, the others take a game id.
        .route("/games/{game}", get(lobby::show))
        .route("/games/{game}/join", post(lobby::join))
        .route("/games/{game}/start", post(lobby::start))
        .route("/games/{game}/bid", post(gameplay::bid))
        .route("/games/{game}/play", post(gameplay::play))
        .route("/games/{game}/events", get(gameplay::events))
        .route("/games/{game}/snapshots", get(account::game_snapshots))
        .route("/account/register", post(account::register))
        .route("/account/login", post(account::login))
        .route("/account/logout", post(account::logout))
        .route("/me", get(account::me))
        .route("/me/games", get(account::my_games))
        .with_state(state)
}

/// Liveness + database reachability. 200 when the pool can execute a
/// query, 503 otherwise — the container healthcheck and deploy probes
/// key off this.
async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.pool).await {
        Ok(_) => (StatusCode::OK, Json(json!({ "status": "ok", "database": "ok" }))),
        Err(error) => {
            tracing::error!(%error, "health check failed to reach database");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "degraded", "database": "unreachable" })),
            )
        }
    }
}
