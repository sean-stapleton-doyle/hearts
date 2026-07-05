//! The server's game events (docs/api.md §Event types) and their
//! human-readable log lines.

use hearts_core::Card;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    GameStarted { players: Vec<String>, round_index: u8, cards_dealt: u8, dealer: usize },
    BidPlaced { seat: usize, bid: u8, auto: bool },
    CardPlayed { seat: usize, card: Card, auto: bool },
    TrickCompleted { winner: usize },
    RoundCompleted { round_index: u8, deltas: Vec<i32>, scores: Vec<i32> },
    RoundAcknowledged { round_index: u8, auto: bool },
    GameOver { scores: Vec<i32>, winners: Vec<usize> },
    GameResumed { round_index: u8 },
    GameAbandoned { reason: String },
}

impl ClientEvent {
    /// One log line, with seat numbers resolved to display names.
    pub fn describe(&self, names: &[String]) -> String {
        let name = |seat: usize| {
            names.get(seat).cloned().unwrap_or_else(|| format!("seat {seat}"))
        };
        let auto_tag = |auto: bool| if auto { " (auto)" } else { "" };
        match self {
            ClientEvent::GameStarted { players, round_index, cards_dealt, dealer } => {
                format!(
                    "game started with {} — round {round_index}, {cards_dealt} card(s), \
                     {} deals",
                    players.join(", "),
                    name(*dealer),
                )
            }
            ClientEvent::BidPlaced { seat, bid, auto } => {
                format!("{} bids {bid}{}", name(*seat), auto_tag(*auto))
            }
            ClientEvent::CardPlayed { seat, card, auto } => {
                format!("{} plays {card}{}", name(*seat), auto_tag(*auto))
            }
            ClientEvent::TrickCompleted { winner } => {
                format!("{} takes the trick", name(*winner))
            }
            ClientEvent::RoundCompleted { round_index, deltas, scores } => {
                let detail: Vec<String> = deltas
                    .iter()
                    .zip(scores)
                    .enumerate()
                    .map(|(seat, (delta, score))| format!("{} {delta:+} → {score}", name(seat)))
                    .collect();
                format!("round {round_index} scored: {}", detail.join(", "))
            }
            ClientEvent::RoundAcknowledged { round_index, auto } => {
                format!("round {round_index} acknowledged{}", auto_tag(*auto))
            }
            ClientEvent::GameOver { winners, .. } => {
                let winners: Vec<String> = winners.iter().map(|&w| name(w)).collect();
                format!("game over — {} wins", winners.join(" & "))
            }
            ClientEvent::GameResumed { round_index } => {
                format!("server restarted — round {round_index} restarts from its deal")
            }
            ClientEvent::GameAbandoned { reason } => format!("game abandoned ({reason})"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_deserialize_from_server_json() {
        let raw = r#"{"type":"card_played","seat":0,"card":{"suit":"Spades","rank":"Ten"},"auto":false,"next":{"action":"play","seat":1}}"#;
        let event: ClientEvent = serde_json::from_str(raw).unwrap();
        let names = vec!["alice".to_string(), "bob".to_string()];
        assert_eq!(event.describe(&names), "alice plays 10♠");

        let raw = r#"{"type":"bid_placed","seat":1,"bid":2,"auto":true,"next":null}"#;
        let event: ClientEvent = serde_json::from_str(raw).unwrap();
        assert_eq!(event.describe(&names), "bob bids 2 (auto)");
    }
}
