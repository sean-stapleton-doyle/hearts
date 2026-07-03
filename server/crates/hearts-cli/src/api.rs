//! Typed client for the server API (docs/api.md). Cards and other engine
//! values deserialize directly into `hearts_core` types.

use std::fmt;

use hearts_core::Card;
use reqwest::{Client, Method};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::config::Config;

#[derive(Debug)]
pub enum ApiError {
    /// The server rejected the request; `code` is machine-readable
    /// (docs/api.md §Errors).
    Server { status: u16, code: String, message: String },
    Transport(reqwest::Error),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Server { code, message, .. } => write!(f, "{message} ({code})"),
            ApiError::Transport(error) => write!(f, "cannot reach server: {error}"),
        }
    }
}

impl std::error::Error for ApiError {}

impl From<reqwest::Error> for ApiError {
    fn from(error: reqwest::Error) -> Self {
        ApiError::Transport(error)
    }
}

// ── View DTOs (docs/api.md §The game view) ──────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct GameView {
    pub id: String,
    pub invite_code: String,
    pub status: String,
    pub players: Vec<PlayerInfo>,
    pub game: Option<EngineView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlayerInfo {
    pub seat: usize,
    pub display_name: String,
    pub is_you: bool,
    pub is_creator: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineView {
    pub phase: String,
    pub round_index: u8,
    pub scores: Vec<i32>,
    pub next: Option<TurnRef>,
    pub away: Vec<bool>,
    pub turn_deadline_in_secs: u64,
    pub round: Option<RoundView>,
    pub you: Option<YouView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TurnRef {
    pub action: String,
    pub seat: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoundView {
    pub cards_dealt: u8,
    pub dealer: usize,
    pub bids: Vec<Option<u8>>,
    pub tricks_won: Vec<u8>,
    pub current_trick: Option<TrickView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrickView {
    pub leader: usize,
    pub plays: Vec<PlayView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlayView {
    pub seat: usize,
    pub card: Card,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YouView {
    pub hand: Vec<Card>,
    pub legal_bids: Option<Vec<u8>>,
    pub legal_plays: Option<Vec<Card>>,
}

// ── Client ──────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Api {
    http: Client,
    pub base: String,
    pub token: String,
}

impl Api {
    /// Build a client with a working session: reuse the stored token if
    /// the server still accepts it, otherwise create a fresh session and
    /// persist it.
    pub async fn connect(config: &mut Config) -> anyhow::Result<Api> {
        let mut api = Api {
            http: Client::new(),
            base: config.server.trim_end_matches('/').to_string(),
            token: config.token.clone().unwrap_or_default(),
        };
        let valid = !api.token.is_empty()
            && match api.send::<Value>(Method::GET, "/session", None).await {
                Ok(_) => true,
                Err(ApiError::Server { status: 401, .. }) => false,
                Err(error) => return Err(error.into()),
            };
        if !valid {
            #[derive(Deserialize)]
            struct NewSession {
                token: String,
            }
            let session: NewSession = api.send(Method::POST, "/session", None).await?;
            api.token = session.token;
            config.token = Some(api.token.clone());
            config.save()?;
        }
        Ok(api)
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, ApiError> {
        let mut request = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response.json().await?);
        }
        #[derive(Deserialize)]
        struct ErrorBody {
            error: ErrorDetail,
        }
        #[derive(Deserialize)]
        struct ErrorDetail {
            code: String,
            message: String,
        }
        let detail = response.json::<ErrorBody>().await.map(|body| body.error).unwrap_or(
            ErrorDetail { code: "unknown".to_string(), message: format!("HTTP {status}") },
        );
        Err(ApiError::Server {
            status: status.as_u16(),
            code: detail.code,
            message: detail.message,
        })
    }

    pub async fn create_game(&self, name: &str) -> Result<GameView, ApiError> {
        self.send(Method::POST, "/games", Some(json!({ "display_name": name }))).await
    }

    pub async fn join_game(&self, code: &str, name: &str) -> Result<GameView, ApiError> {
        self.send(
            Method::POST,
            &format!("/games/{code}/join"),
            Some(json!({ "display_name": name })),
        )
        .await
    }

    pub async fn start_game(&self, id: &str) -> Result<GameView, ApiError> {
        self.send(Method::POST, &format!("/games/{id}/start"), None).await
    }

    pub async fn get_game(&self, id: &str) -> Result<GameView, ApiError> {
        self.send(Method::GET, &format!("/games/{id}"), None).await
    }

    pub async fn bid(&self, id: &str, bid: u8) -> Result<Value, ApiError> {
        self.send(Method::POST, &format!("/games/{id}/bid"), Some(json!({ "bid": bid }))).await
    }

    pub async fn play(&self, id: &str, card: Card) -> Result<Value, ApiError> {
        self.send(Method::POST, &format!("/games/{id}/play"), Some(json!({ "card": card })))
            .await
    }

    /// The raw SSE response; parsing lives in [`crate::sse`].
    pub async fn events_response(
        &self,
        id: &str,
        last_event_id: Option<u64>,
    ) -> Result<reqwest::Response, ApiError> {
        let mut request = self
            .http
            .get(format!("{}/games/{id}/events", self.base))
            .bearer_auth(&self.token);
        if let Some(last) = last_event_id {
            request = request.header("Last-Event-ID", last.to_string());
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            return Err(ApiError::Server {
                status,
                code: if status == 404 { "game_not_found" } else { "game_over" }.to_string(),
                message: "event stream unavailable".to_string(),
            });
        }
        Ok(response)
    }

    pub async fn register(&self, username: &str, password: &str) -> Result<Value, ApiError> {
        self.send(
            Method::POST,
            "/account/register",
            Some(json!({ "username": username, "password": password })),
        )
        .await
    }

    pub async fn login(&self, username: &str, password: &str) -> Result<Value, ApiError> {
        self.send(
            Method::POST,
            "/account/login",
            Some(json!({ "username": username, "password": password })),
        )
        .await
    }

    pub async fn logout(&self) -> Result<Value, ApiError> {
        self.send(Method::POST, "/account/logout", None).await
    }

    pub async fn my_games(&self) -> Result<Value, ApiError> {
        self.send(Method::GET, "/me/games", None).await
    }
}
