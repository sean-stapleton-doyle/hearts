//! SSE consumption (docs/api.md §Events): a background task parses the
//! event stream into a channel and reconnects with `Last-Event-ID` on
//! drops, so the app never misses an event.

use futures_util::StreamExt;
use tokio::sync::mpsc;

use crate::api::{Api, ApiError};
use crate::events::ClientEvent;

#[derive(Debug)]
pub enum SseMessage {
    Event(ClientEvent),
    /// Transient drop; the task is already reconnecting.
    Reconnecting,
    /// The server refused the stream (game over/abandoned) — final.
    Closed,
}

pub fn spawn(api: Api, game_id: String, tx: mpsc::Sender<SseMessage>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut last_seen: Option<u64> = None;
        loop {
            let response = match api.events_response(&game_id, last_seen).await {
                Ok(response) => response,
                Err(ApiError::Server { .. }) => {
                    let _ = tx.send(SseMessage::Closed).await;
                    return;
                }
                Err(ApiError::Transport(_)) => {
                    if tx.send(SseMessage::Reconnecting).await.is_err() {
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
            };

            let mut bytes = response.bytes_stream();
            let mut buffer = String::new();
            'stream: while let Some(chunk) = bytes.next().await {
                let Ok(chunk) = chunk else { break 'stream };
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                // Process complete lines; SSE frames are line-oriented.
                while let Some(newline) = buffer.find('\n') {
                    let line = buffer[..newline].trim_end_matches('\r').to_string();
                    buffer.drain(..=newline);
                    if let Some(id) = line.strip_prefix("id:") {
                        if let Ok(id) = id.trim().parse() {
                            last_seen = Some(id);
                        }
                    } else if let Some(data) = line.strip_prefix("data:")
                        && let Some(message) = parse_event(data.trim())
                        && tx.send(message).await.is_err()
                    {
                        return; // app is gone
                    }
                    // Empty lines end a frame; comment lines (":") are
                    // keep-alives. Neither needs handling.
                }
            }
            // Stream ended: either the game finished (server dropped the
            // sender) or the connection blipped. Reconnect and let the
            // server's 409 tell us which.
            if tx.send(SseMessage::Reconnecting).await.is_err() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    })
}

fn parse_event(data: &str) -> Option<SseMessage> {
    // The envelope's `seq` is tracked via the SSE `id:` line; the payload's
    // extra fields are ignored by serde.
    match serde_json::from_str::<ClientEvent>(data) {
        Ok(event) => Some(SseMessage::Event(event)),
        Err(_) => None, // unknown event type from a newer server: skip
    }
}
