//! The in-memory registry of live games (docs/server-design.md §State
//! model): Postgres stores durability and history; *this* is what actually
//! plays. A game enters the registry when the lobby starts it and leaves
//! when it finishes or is abandoned.
//!
//! Locking: the registry itself is behind an `RwLock` taken only to look
//! up or insert entries; each game has its own `Mutex`, so one slow game
//! never blocks another. Turn-based actions are tiny, so a single lock per
//! game is plenty.
//!
//! Every game carries an append-only event log (`seq` = index) plus a
//! broadcast channel: SSE subscribers replay the log from `Last-Event-ID`,
//! then follow the channel. Both are written under the game's mutex, so a
//! subscriber that copies the backlog and subscribes under the same lock
//! can never miss or duplicate an event.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, RwLock, broadcast};
use tokio::time::Instant;
use uuid::Uuid;

use hearts_core::Game;

use crate::gameplay::{Envelope, GameEvent};

/// Sized for slow consumers: SSE clients that lag this far behind get cut
/// off and reconnect with `Last-Event-ID` to replay from the log.
const EVENT_CHANNEL_CAPACITY: usize = 256;

/// A live game plus the seat↔session bindings the engine knows nothing
/// about. Index into `players` with the engine's `Seat.0`.
pub struct ActiveGame {
    pub game: Game,
    pub players: Vec<SeatBinding>,
    /// When the seat due to act is auto-acted for; reset by every action.
    /// Also serves as the round-gate auto-continue deadline while
    /// [`pending_ack`](Self::pending_ack) is set.
    pub turn_deadline: Instant,
    /// Seats whose last action was a timeout auto-action; cleared when the
    /// player acts for themselves. All seats away ⇒ the game is abandoned.
    pub away: Vec<bool>,
    /// The seat of the game's creator (the host). Authorizes the round-gate
    /// `continue` action. Set once at start, never changes.
    pub creator_seat: usize,
    /// The completed round index awaiting host acknowledgement, or `None`.
    /// While set, `bid`/`play` are rejected with `round_pending_ack` and
    /// the turn deadline is the auto-continue deadline. Cleared by the
    /// `continue` endpoint or the timeout sweeper. Not persisted in
    /// snapshots — a server restart clears it (consistent with the existing
    /// "in-flight round state is lost" tradeoff).
    pub pending_ack: Option<u8>,
    /// The completed tricks of the round held on the gate, as view JSON
    /// (`[{leader, winner, plays}, …]`). Captured at round completion —
    /// the engine drops the round's tricks when it advances — and carried
    /// by `pending_recap` so the recap can show what was played. Lives and
    /// dies with [`pending_ack`](Self::pending_ack).
    pub pending_tricks: Option<serde_json::Value>,
    events: Vec<Envelope>,
    sender: broadcast::Sender<Envelope>,
}

pub struct SeatBinding {
    /// SHA-256 session-token hash (`sessions.token`) occupying this seat.
    pub token_hash: Vec<u8>,
    pub display_name: String,
}

impl ActiveGame {
    pub fn new(
        game: Game,
        players: Vec<SeatBinding>,
        creator_seat: usize,
        turn_timeout: Duration,
    ) -> Self {
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let away = vec![false; players.len()];
        ActiveGame {
            game,
            players,
            turn_deadline: Instant::now() + turn_timeout,
            away,
            creator_seat,
            pending_ack: None,
            pending_tricks: None,
            events: Vec::new(),
            sender,
        }
    }

    /// Bookkeeping for a successful action: restart the turn clock and
    /// update the actor's away flag (auto-actions set it, real ones clear
    /// it).
    pub fn note_action(&mut self, seat: usize, auto: bool, turn_timeout: Duration) {
        self.away[seat] = auto;
        self.turn_deadline = Instant::now() + turn_timeout;
    }

    /// The seat bound to this session token hash, if it is at the table.
    pub fn seat_of(&self, token_hash: &[u8]) -> Option<usize> {
        self.players.iter().position(|player| player.token_hash == token_hash)
    }

    /// Append an event to the log and fan it out to subscribers. Returns
    /// the event's sequence number.
    pub fn push_event(&mut self, event: GameEvent) -> u64 {
        let seq = self.events.len() as u64;
        let envelope = Envelope { seq, event };
        self.events.push(envelope.clone());
        // Err just means no subscriber is currently listening.
        let _ = self.sender.send(envelope);
        seq
    }

    /// Events with `seq` greater than `after` (all events when `None`).
    pub fn events_after(&self, after: Option<u64>) -> Vec<Envelope> {
        let start = after.map_or(0, |seq| (seq + 1) as usize);
        self.events.get(start..).unwrap_or_default().to_vec()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Envelope> {
        self.sender.subscribe()
    }
}

#[derive(Clone, Default)]
pub struct GameRegistry {
    inner: Arc<RwLock<HashMap<Uuid, Arc<Mutex<ActiveGame>>>>>,
}

impl GameRegistry {
    pub async fn insert(&self, id: Uuid, game: ActiveGame) {
        self.inner.write().await.insert(id, Arc::new(Mutex::new(game)));
    }

    pub async fn get(&self, id: Uuid) -> Option<Arc<Mutex<ActiveGame>>> {
        self.inner.read().await.get(&id).cloned()
    }

    /// Snapshot of all live games, for the timeout sweeper.
    pub async fn entries(&self) -> Vec<(Uuid, Arc<Mutex<ActiveGame>>)> {
        self.inner.read().await.iter().map(|(id, entry)| (*id, entry.clone())).collect()
    }

    pub async fn remove(&self, id: Uuid) {
        self.inner.write().await.remove(&id);
    }
}
