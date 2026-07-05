//! Client configuration at `~/.config/hearts/config.json`: the server
//! URL, the session token (the player's identity — losing it means losing
//! your seats), and the last game for `hearts resume`.

use std::path::PathBuf;

use anyhow::Context;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub server: String,
    pub token: Option<String>,
    pub last_game: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config { server: "http://127.0.0.1:8080".to_string(), token: None, last_game: None }
    }
}

impl Config {
    fn path() -> anyhow::Result<PathBuf> {
        let dir = dirs::config_dir().context("no config directory on this platform")?;
        Ok(dir.join("hearts").join("config.json"))
    }

    pub fn load() -> anyhow::Result<Config> {
        let path = Self::path()?;
        match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw)
                .with_context(|| format!("corrupt config at {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, serde_json::to_string_pretty(self)?)
            .with_context(|| format!("writing {}", path.display()))
    }
}
