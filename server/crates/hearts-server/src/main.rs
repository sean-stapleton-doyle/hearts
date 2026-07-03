mod account;
mod config;
mod error;
mod gameplay;
mod housekeeping;
mod lobby;
mod persist;
mod registry;
mod routes;
mod session;
mod state;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present (dev convenience); real env always wins.
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("hearts_server=debug,info")),
        )
        .init();

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
    };
    persist::recover_active_games(&state).await?;
    tokio::spawn(housekeeping::turn_timeouts(state.clone()));
    tokio::spawn(housekeeping::lobby_expiry(state.clone()));

    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.bind_addr))?;
    tracing::info!("listening on http://{}", listener.local_addr()?);

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
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
