//! The interactive TUI session: a lobby loop (poll until started), then
//! the game loop (SSE events + keyboard, exactly the client loop from
//! docs/api.md).

use std::time::{Duration, Instant};

use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use futures_util::StreamExt;
use tokio::sync::mpsc;

use hearts_core::{Card, Suit};

use crate::api::{Api, ApiError, GameView};
use crate::events::ClientEvent;
use crate::sse::{self, SseMessage};
use crate::ui;

/// What the player can currently submit.
#[derive(Debug, Clone, Copy)]
pub enum Choice {
    Bid(u8),
    Card(Card),
}

pub struct App {
    pub api: Api,
    pub game_id: String,
    pub view: GameView,
    pub log: Vec<String>,
    pub selected: usize,
    pub error: Option<String>,
    /// Local clock for the turn countdown, reset on every view refresh.
    pub deadline: Option<Instant>,
    /// Terminal state reached (game_over / game_abandoned).
    pub finished: bool,
    pub final_result: Option<(Vec<i32>, Vec<usize>)>,
}

enum Flow {
    Continue,
    Quit,
}

/// Run the TUI for a game (lobby or in progress). Returns a summary line
/// to print after the terminal is restored.
pub async fn run(api: Api, view: GameView) -> anyhow::Result<Option<String>> {
    let mut terminal = ratatui::init();
    let result = run_inner(&mut terminal, api, view).await;
    ratatui::restore();
    result
}

async fn run_inner(
    terminal: &mut ratatui::DefaultTerminal,
    api: Api,
    view: GameView,
) -> anyhow::Result<Option<String>> {
    let view = if view.status == "lobby" {
        match lobby_loop(terminal, &api, view).await? {
            Some(started) => started,
            None => return Ok(None), // player quit the lobby
        }
    } else {
        view
    };
    if view.status != "in_progress" {
        return Ok(Some(format!("this game is already {}", view.status)));
    }
    game_loop(terminal, api, view).await
}

async fn lobby_loop(
    terminal: &mut ratatui::DefaultTerminal,
    api: &Api,
    mut view: GameView,
) -> anyhow::Result<Option<GameView>> {
    let mut input = EventStream::new();
    let mut poll = tokio::time::interval(Duration::from_secs(2));
    let mut status: Option<String> = None;
    let am_creator = view.players.iter().any(|p| p.is_you && p.is_creator);
    loop {
        if view.status == "in_progress" {
            return Ok(Some(view));
        }
        if view.status != "lobby" {
            return Ok(Some(view)); // expired underneath us; caller reports
        }
        terminal.draw(|frame| ui::draw_lobby(frame, &view, am_creator, &status))?;
        tokio::select! {
            event = input.next() => {
                if let Some(Ok(Event::Key(key))) = event
                    && key.kind == KeyEventKind::Press
                {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => return Ok(None),
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            return Ok(None);
                        }
                        KeyCode::Char('s') if am_creator => {
                            match api.start_game(&view.id).await {
                                Ok(started) => view = started,
                                Err(ApiError::Server { message, .. }) => {
                                    status = Some(message);
                                }
                                Err(error) => status = Some(error.to_string()),
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ = poll.tick() => {
                if let Ok(fresh) = api.get_game(&view.id).await {
                    view = fresh;
                }
            }
        }
    }
}

async fn game_loop(
    terminal: &mut ratatui::DefaultTerminal,
    api: Api,
    view: GameView,
) -> anyhow::Result<Option<String>> {
    let game_id = view.id.clone();
    let (tx, mut rx) = mpsc::channel(128);
    let sse_task = sse::spawn(api.clone(), game_id.clone(), tx);

    let mut app = App {
        api,
        game_id,
        view,
        log: Vec::new(),
        selected: 0,
        error: None,
        deadline: None,
        finished: false,
        final_result: None,
    };
    app.reset_deadline();

    let mut input = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    let summary = loop {
        terminal.draw(|frame| ui::draw_game(frame, &app))?;
        tokio::select! {
            event = input.next() => {
                if let Some(Ok(Event::Key(key))) = event
                    && key.kind == KeyEventKind::Press
                    && matches!(app.handle_key(key).await, Flow::Quit)
                {
                    break app.summary();
                }
            }
            message = rx.recv() => {
                if let Some(message) = message {
                    app.handle_sse(message).await;
                }
            }
            _ = tick.tick() => {} // redraw for the countdown
        }
    };
    sse_task.abort();
    Ok(summary)
}

impl App {
    /// Display names by seat (seats are contiguous from 0).
    pub fn names(&self) -> Vec<String> {
        let mut names = vec![String::new(); self.view.players.len()];
        for player in &self.view.players {
            names[player.seat] = player.display_name.clone();
        }
        names
    }

    pub fn my_seat(&self) -> Option<usize> {
        self.view.players.iter().find(|p| p.is_you).map(|p| p.seat)
    }

    /// Whether the viewer is this game's creator (the host), who alone can
    /// acknowledge the round-end gate.
    pub fn is_host(&self) -> bool {
        self.view.players.iter().any(|p| p.is_you && p.is_creator)
    }

    /// The completed round index currently held open on the recap gate, or
    /// `None` when the table is live.
    pub fn pending_ack(&self) -> Option<u8> {
        self.view.game.as_ref().and_then(|g| g.pending_ack)
    }

    /// The hand in display order: clubs, diamonds, spades, hearts; low to
    /// high within a suit.
    pub fn sorted_hand(&self) -> Vec<Card> {
        let mut hand = self
            .view
            .game
            .as_ref()
            .and_then(|g| g.you.as_ref())
            .map(|you| you.hand.clone())
            .unwrap_or_default();
        hand.sort_by_key(display_key);
        hand
    }

    /// What I may submit right now (empty when it isn't my turn, or while
    /// the round-end gate is held open awaiting host acknowledgement).
    pub fn choices(&self) -> Vec<Choice> {
        let Some(you) = self.view.game.as_ref().and_then(|g| g.you.as_ref()) else {
            return Vec::new();
        };
        // Round-end gate: the server rejects bids/plays with
        // `round_pending_ack` until the host continues. Hide choices so the
        // cursor doesn't offer an action that can't land.
        if self.view.game.as_ref().and_then(|g| g.pending_ack).is_some() {
            return Vec::new();
        }
        if let Some(bids) = &you.legal_bids {
            return bids.iter().map(|&bid| Choice::Bid(bid)).collect();
        }
        if let Some(plays) = &you.legal_plays {
            let mut plays = plays.clone();
            plays.sort_by_key(display_key);
            return plays.into_iter().map(Choice::Card).collect();
        }
        Vec::new()
    }

    pub fn selected_choice(&self) -> Option<Choice> {
        let choices = self.choices();
        choices.get(self.selected.min(choices.len().saturating_sub(1))).copied()
    }

    fn reset_deadline(&mut self) {
        self.deadline = self
            .view
            .game
            .as_ref()
            .map(|g| Instant::now() + Duration::from_secs(g.turn_deadline_in_secs));
    }

    async fn refresh(&mut self) {
        match self.api.get_game(&self.game_id).await {
            Ok(view) => {
                self.view = view;
                self.reset_deadline();
                let len = self.choices().len();
                if len > 0 {
                    self.selected = self.selected.min(len - 1);
                } else {
                    self.selected = 0;
                }
                if self.view.status == "finished" || self.view.status == "abandoned" {
                    self.finished = true;
                }
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }

    async fn handle_sse(&mut self, message: SseMessage) {
        match message {
            SseMessage::Event(event) => {
                self.log.push(event.describe(&self.names()));
                match &event {
                    ClientEvent::GameOver { scores, winners } => {
                        self.final_result = Some((scores.clone(), winners.clone()));
                        self.finished = true;
                    }
                    ClientEvent::GameAbandoned { .. } => self.finished = true,
                    _ => {}
                }
                self.refresh().await;
            }
            SseMessage::Reconnecting => {
                if !self.finished {
                    self.log.push("· reconnecting…".to_string());
                    self.refresh().await;
                }
            }
            SseMessage::Closed => {
                self.refresh().await;
                self.finished = true;
            }
        }
    }

    async fn handle_key(&mut self, key: KeyEvent) -> Flow {
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return Flow::Quit,
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return Flow::Quit;
            }
            KeyCode::Left | KeyCode::Char('h') => {
                self.selected = self.selected.saturating_sub(1);
            }
            KeyCode::Right | KeyCode::Char('l') => {
                let len = self.choices().len();
                if len > 0 {
                    self.selected = (self.selected + 1).min(len - 1);
                }
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                if let Some(choice) = self.selected_choice() {
                    self.submit(choice).await;
                }
            }
            KeyCode::Char('r') => self.refresh().await,
            KeyCode::Char('c') => {
                // Round-end gate: the creator advances the table for everyone.
                if self.is_host() && self.pending_ack().is_some() {
                    self.continue_game().await;
                }
            }
            KeyCode::Char(digit @ '0'..='9') => {
                // Direct bid entry.
                let bid = digit as u8 - b'0';
                let is_legal_bid = self
                    .choices()
                    .iter()
                    .any(|choice| matches!(choice, Choice::Bid(b) if *b == bid));
                if is_legal_bid {
                    self.submit(Choice::Bid(bid)).await;
                }
            }
            _ => {}
        }
        Flow::Continue
    }

    async fn submit(&mut self, choice: Choice) {
        let result = match choice {
            Choice::Bid(bid) => self.api.bid(&self.game_id, bid).await,
            Choice::Card(card) => self.api.play(&self.game_id, card).await,
        };
        match result {
            Ok(_) => self.error = None,
            Err(ApiError::Server { message, .. }) => self.error = Some(message),
            Err(error) => self.error = Some(error.to_string()),
        }
        // Either way the view moved (or we were stale): resync.
        self.refresh().await;
    }

    /// Host-only: acknowledge the held-open round recap so the table
    /// advances for everyone.
    async fn continue_game(&mut self) {
        match self.api.continue_game(&self.game_id).await {
            Ok(_) => self.error = None,
            Err(ApiError::Server { code, message, .. }) => {
                // `not_pending_ack` just means someone (the sweeper or a
                // race) already advanced — not an error worth surfacing.
                if code != "not_pending_ack" {
                    self.error = Some(message);
                }
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        self.refresh().await;
    }

    fn summary(&self) -> Option<String> {
        if !self.finished {
            return Some(format!(
                "left the game — rejoin any time with `hearts resume` (game {})",
                self.game_id
            ));
        }
        let names = self.names();
        match &self.final_result {
            Some((scores, winners)) => {
                let standings: Vec<String> = scores
                    .iter()
                    .enumerate()
                    .map(|(seat, score)| format!("{} {score}", names[seat]))
                    .collect();
                let winners: Vec<String> =
                    winners.iter().map(|&seat| names[seat].clone()).collect();
                Some(format!(
                    "final scores: {} — {} wins",
                    standings.join(", "),
                    winners.join(" & ")
                ))
            }
            None => Some(format!("game ended ({})", self.view.status)),
        }
    }
}

/// Sort key for rendering: suit groups (trump last), then rank.
pub fn display_key(card: &Card) -> (u8, u8) {
    let suit = match card.suit {
        Suit::Clubs => 0,
        Suit::Diamonds => 1,
        Suit::Spades => 2,
        Suit::Hearts => 3,
    };
    (suit, card.rank.value())
}
