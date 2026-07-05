//! Route table and handlers. Handlers move to submodules as they grow;
//! for now the skeleton only exposes liveness.

use axum::extract::{Request, State};
use axum::http::{HeaderName, Method, StatusCode};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::HeaderValue;
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde_json::json;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

use crate::account;
use crate::gameplay;
use crate::lobby;
use crate::session;
use crate::state::AppState;

pub fn router(state: AppState, cors_allowed_origins: &[String]) -> Router {
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
        .route("/games/{game}/continue", post(gameplay::continue_game))
        .route("/games/{game}/end", post(gameplay::end_game))
        .route("/games/{game}/events", get(gameplay::events))
        .route("/games/{game}/snapshots", get(account::game_snapshots))
        .route("/account/register", post(account::register))
        .route("/account/login", post(account::login))
        .route("/account/logout", post(account::logout))
        .route("/me", get(account::me))
        .route("/me/games", get(account::my_games))
        .route("/me/stats", get(account::my_stats))
        .with_state(state)
        .layer(cors_layer(cors_allowed_origins))
        .layer(
            ServiceBuilder::new()
                // A request id ties every log line for one request together
                // (session resolution, the gameplay handler's own timing,
                // and this span) even when other requests interleave it in
                // the log — e.g. the concurrent GET refetches a single
                // action's SSE event and mutation-settle both trigger.
                .layer(SetRequestIdLayer::new(REQUEST_ID_HEADER, MakeRequestUuid))
                // Full request/response duration, independent of the
                // finer-grained spans inside gameplay handlers — pinpoints
                // whether a slow bid/play is the POST itself or a
                // subsequent GET refetch.
                .layer(TraceLayer::new_for_http().make_span_with(|request: &Request| {
                    let request_id = request
                        .headers()
                        .get(&REQUEST_ID_HEADER)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("-")
                        .to_string();
                    tracing::debug_span!(
                        "request",
                        %request_id,
                        method = %request.method(),
                        // Path only, never the query string: the SSE route's
                        // `?token=<hex>` fallback (session.rs — EventSource
                        // can't set headers) would otherwise land in
                        // cleartext in both stdout and the persisted log
                        // file. No other route uses query params, so
                        // dropping it costs no debugging value.
                        uri = %request.uri().path(),
                    )
                }))
                .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER)),
        )
}

/// Browser frontends (TanStack on :3000) hit the API on :8080, so a CORS
/// layer is required. Browsers cannot set headers on `EventSource`, so the
/// SSE route authenticates via a `?token=` query param instead; the
/// `Last-Event-ID` reconnect header is also allowlisted here.
fn cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();
    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            // Set automatically by `EventSource` on reconnect.
            HeaderName::from_static("last-event-id"),
        ])
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
