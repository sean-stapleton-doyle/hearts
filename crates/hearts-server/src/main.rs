mod account;
mod config;
mod error;
mod gameplay;
mod housekeeping;
mod lobby;
mod persist;
mod ratelimit;
mod registry;
mod routes;
mod session;
mod state;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

use crate::config::Config;
use crate::state::AppState;

const DEFAULT_LOG_FILTER: &str = "hearts_server=debug,tower_http=debug,info";

fn log_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present (dev convenience); real env always wins.
    dotenvy::dotenv().ok();

    // Every request's logs (session resolution, gameplay timing, the
    // request span) go to both stdout, for a live tail, and a rolling file
    // under `logs/`, so a slow request caught after the fact still has its
    // trail on disk. The two outputs get independent filter instances since
    // `EnvFilter` isn't reusable across layers.
    std::fs::create_dir_all("logs").context("failed to create logs directory")?;
    let file_appender = tracing_appender::rolling::daily("logs", "hearts-server.log");
    let (file_writer, file_guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(log_filter()))
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(file_writer)
                .with_ansi(false)
                .with_filter(log_filter()),
        )
        .init();
    // Dropping this stops the file writer's background flush thread — held
    // for the whole process lifetime, never read.
    let _file_guard = file_guard;

    let config = Config::from_env()?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("failed to connect to Postgres")?;
    sqlx::migrate!().run(&pool).await.context("failed to run database migrations")?;
    tracing::info!("database connected, migrations up to date");

    let state = AppState {
        pool,
        registry: Default::default(),
        turn_timeout: config.turn_timeout,
        lobby_expiry: config.lobby_expiry,
        rate_limiter: ratelimit::RateLimiter::new(),
    };
    persist::recover_active_games(&state).await?;
    tokio::spawn(housekeeping::turn_timeouts(state.clone()));
    tokio::spawn(housekeeping::lobby_expiry(state.clone()));

    let app = routes::router(state, &config.cors_allowed_origins);
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.bind_addr))?;
    tracing::info!("listening on http://{}", listener.local_addr()?);

    // `with_connect_info` populates `ConnectInfo<SocketAddr>` on every
    // request — ratelimit::ClientIp's fallback (no `X-Forwarded-For`, i.e.
    // local/direct connections) reads it.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    tracing::info!("shut down cleanly");
    Ok(())
}

/// Resolve on ctrl-c or SIGTERM so in-flight requests drain before exit.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("install ctrl-c handler");
    };
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
