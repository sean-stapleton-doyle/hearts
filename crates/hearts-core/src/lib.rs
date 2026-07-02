//! Core domain model for a trick-taking, relative-bidding card game
//! (Oh Hell family) with two twists:
//!
//! - **Hearts are permanent trump** — any heart beats any non-heart.
//! - **The deck is never reshuffled** — it is shuffled exactly once at game
//!   start; played cards return to the bottom in a fixed order, so card
//!   distribution is deterministic across rounds.
//!
//! This crate is pure domain logic: no I/O, no async, no dependencies. It is
//! designed to be wrapped by a game server (e.g. Axum) or language bindings
//! (e.g. PyO3) without modification, and to be fully testable in isolation.
//!
//! # Spec decisions ([DECISION] points in `docs/card-game-spec.md`)
//!
//! The engine implements the spec's proposed defaults:
//!
//! - **§4.1 Dealing:** one card at a time, starting at the dealer's left,
//!   repeating around the table; cards come off the top of the deck.
//! - **§4.2 Returning cards:** appended to the bottom trick by trick in
//!   completion order, and within each trick in play order.
//! - **§4.3 First dealer:** seat 0 by default; configurable via
//!   [`Game::with_first_dealer`].
//! - **§5.3 Leading hearts:** permitted at any time (no "breaking" rule).
//! - **§5.5 Next-dealer tie-break:** first tied seat in rotation starting
//!   from the current dealer's left ([`round::next_dealer`]).
//! - **§6 Overall winner tie-break:** unresolved by the engine;
//!   [`Game::winners`] reports every tied seat.

pub mod card;
pub mod deck;
pub mod error;
pub mod game;
pub mod round;
pub mod seat;
pub mod trick;

pub use card::{Card, Rank, Suit};
pub use deck::Deck;
pub use error::GameError;
pub use game::{Game, Phase, PlayOutcome, RoundResult};
pub use round::{MAX_PLAYERS, MIN_PLAYERS, NUM_ROUNDS, Round, cards_for_round, score_delta};
pub use seat::Seat;
pub use trick::Trick;
