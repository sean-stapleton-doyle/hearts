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
    /// Origins allowed by the CORS layer (comma-separated
    /// `CORS_ALLOWED_ORIGINS`). The web dev server runs on
    /// `http://localhost:3000`, which is the default when unset.
    pub cors_allowed_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").context(
            "DATABASE_URL is not set — for the compose.yaml dev database, \
             copy .env.example to .env",
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
            cors_allowed_origins: env_origins(),
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

/// `CORS_ALLOWED_ORIGINS`: a comma-separated list of origins. Defaults to
/// the web dev server (`http://localhost:3000`) when unset or empty, since a
/// browser frontend on another origin cannot reach the API otherwise.
fn env_origins() -> Vec<String> {
    let parsed = std::env::var("CORS_ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(|origin| origin.trim().to_string())
        .filter(|origin| !origin.is_empty())
        .collect::<Vec<_>>();
    if parsed.is_empty() {
        vec!["http://localhost:3000".to_string()]
    } else {
        parsed
    }
}
