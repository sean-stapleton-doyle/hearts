//! Server configuration, read from the environment (and `.env` in dev).

use std::net::SocketAddr;
use std::time::Duration;

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    /// A player who hasn't acted for this long is auto-acted for
    /// (docs/server-design.md §Timeouts; default 5 minutes).
    pub turn_timeout: Duration,
    /// Lobbies with no join/start activity for this long are abandoned
    /// (default 20 minutes).
    pub lobby_expiry: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").context(
            "DATABASE_URL is not set — for the compose.yaml dev database use \
             postgres://hearts:hearts@localhost:5432/hearts (see .env.example)",
        )?;
        let bind_addr = std::env::var("BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
            .parse()
            .context("BIND_ADDR must be a host:port socket address")?;
        Ok(Config {
            database_url,
            bind_addr,
            turn_timeout: env_secs("TURN_TIMEOUT_SECS", 300)?,
            lobby_expiry: env_secs("LOBBY_EXPIRY_SECS", 1200)?,
        })
    }
}

fn env_secs(name: &str, default_secs: u64) -> anyhow::Result<Duration> {
    match std::env::var(name) {
        Ok(value) => {
            let secs: u64 =
                value.parse().with_context(|| format!("{name} must be a number of seconds"))?;
            Ok(Duration::from_secs(secs))
        }
        Err(_) => Ok(Duration::from_secs(default_secs)),
    }
}
