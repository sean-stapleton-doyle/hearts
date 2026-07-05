//! Seat / Deck / Trick / Round wrappers.
//!
//! `Seat` is a frozen, ordered, hashable wrapper around `hearts_core::Seat`.
//! `Deck` and `Trick` are read-only projections. `Round` exposes the full
//! round API, including the public `Round::new` constructor so Python callers
//! can set up arbitrary positions for analysis. Accessors that borrow slices
//! in Rust clone into owned Python lists here.

use pyo3::prelude::*;

use hearts_core as hc;

use crate::card::{Card, Suit};
use crate::error::to_pyerr;

/// A seat at the table, identified by its index `0..num_players`.
#[pyclass(eq, ord, hash, frozen, from_py_object, module = "pyhearts")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Seat {
    pub(crate) inner: hc::Seat,
}

impl From<hc::Seat> for Seat {
    fn from(inner: hc::Seat) -> Self {
        Seat { inner }
    }
}

#[pymethods]
impl Seat {
    #[new]
    fn new(index: usize) -> Self {
        Seat { inner: hc::Seat(index) }
    }

    #[getter]
    fn index(&self) -> usize {
        self.inner.0
    }

    /// The next seat in rotation (clockwise).
    fn next(&self, num_players: usize) -> Seat {
        self.inner.next(num_players).into()
    }

    /// The seat `by` places after this one in rotation.
    fn offset(&self, by: usize, num_players: usize) -> Seat {
        self.inner.offset(by, num_players).into()
    }

    fn __int__(&self) -> usize {
        self.inner.0
    }

    fn __str__(&self) -> String {
        self.inner.to_string()
    }

    fn __repr__(&self) -> String {
        format!("Seat({})", self.inner.0)
    }
}

/// The never-reshuffled deck. Read-only from Python.
#[pyclass(skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub struct Deck {
    pub(crate) inner: hc::Deck,
}

impl From<hc::Deck> for Deck {
    fn from(inner: hc::Deck) -> Self {
        Deck { inner }
    }
}

#[pymethods]
impl Deck {
    /// All 52 cards in reference order.
    #[staticmethod]
    fn standard() -> Deck {
        hc::Deck::standard().into()
    }

    /// The standard deck shuffled deterministically from `seed`.
    #[staticmethod]
    fn shuffled(seed: u64) -> Deck {
        hc::Deck::shuffled(seed).into()
    }

    fn __len__(&self) -> usize {
        self.inner.len()
    }

    fn len(&self) -> usize {
        self.inner.len()
    }

    fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Cards from top (next to be dealt) to bottom.
    fn cards(&self) -> Vec<Card> {
        self.inner.iter().copied().map(Into::into).collect()
    }

    fn __repr__(&self) -> String {
        format!("Deck(len={})", self.inner.len())
    }
}

/// A single trick. Read-only; obtained via `Round`.
#[pyclass(frozen, skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub struct Trick {
    pub(crate) inner: hc::Trick,
}

impl From<hc::Trick> for Trick {
    fn from(inner: hc::Trick) -> Self {
        Trick { inner }
    }
}

#[pymethods]
impl Trick {
    #[getter]
    fn leader(&self) -> Seat {
        self.inner.leader().into()
    }

    /// The suit of the first card played, once there is one.
    fn led_suit(&self) -> Option<Suit> {
        self.inner.led_suit().map(Into::into)
    }

    /// Plays so far as `(seat, card)` tuples, in play order.
    fn plays(&self) -> Vec<(Seat, Card)> {
        self.inner.plays().iter().map(|&(s, c)| (s.into(), c.into())).collect()
    }

    /// The seat due to play next (the leader when the trick is empty).
    fn next_seat(&self) -> Seat {
        self.inner.next_seat().into()
    }

    fn is_complete(&self) -> bool {
        self.inner.is_complete()
    }

    /// The `(seat, card)` currently winning the trick, if any card is played.
    fn winning_play(&self) -> Option<(Seat, Card)> {
        self.inner.winning_play().map(|(s, c)| (s.into(), c.into()))
    }

    /// The trick's winner, once every player has played.
    fn winner(&self) -> Option<Seat> {
        self.inner.winner().map(Into::into)
    }

    fn __repr__(&self) -> String {
        format!("Trick(plays={}, complete={})", self.inner.plays().len(), self.inner.is_complete())
    }
}

/// A single round: bidding, trick play, and scoring.
#[pyclass(skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub struct Round {
    pub(crate) inner: hc::Round,
}

impl From<hc::Round> for Round {
    fn from(inner: hc::Round) -> Self {
        Round { inner }
    }
}

#[pymethods]
impl Round {
    /// Build a round from dealt hands (`hands[seat]`, in deal order). Every
    /// hand must hold exactly `cards_for_round(index)` cards; raises
    /// `GameError` otherwise.
    #[new]
    fn new(index: u8, dealer: &Seat, hands: Vec<Vec<Card>>) -> PyResult<Self> {
        let hands: Vec<Vec<hc::Card>> =
            hands.into_iter().map(|hand| hand.into_iter().map(|c| c.inner).collect()).collect();
        hc::Round::new(index, dealer.inner, hands).map(Into::into).map_err(to_pyerr)
    }

    #[getter]
    fn index(&self) -> u8 {
        self.inner.index()
    }

    #[getter]
    fn cards_dealt(&self) -> u8 {
        self.inner.cards_dealt()
    }

    #[getter]
    fn dealer(&self) -> Seat {
        self.inner.dealer().into()
    }

    #[getter]
    fn num_players(&self) -> usize {
        self.inner.num_players()
    }

    /// A player's current hand, in deal order.
    fn hand(&self, seat: &Seat) -> Vec<Card> {
        self.inner.hand(seat.inner).iter().copied().map(Into::into).collect()
    }

    /// Bids by seat; `None` until that seat has bid.
    fn bids(&self) -> Vec<Option<u8>> {
        self.inner.bids().to_vec()
    }

    /// The seat due to bid, or `None` once bidding is complete.
    fn next_bidder(&self) -> Option<Seat> {
        self.inner.next_bidder().map(Into::into)
    }

    fn bidding_complete(&self) -> bool {
        self.inner.bidding_complete()
    }

    /// The hook's forbidden bid for the last bidder, if any.
    fn forbidden_bid(&self) -> Option<u8> {
        self.inner.forbidden_bid()
    }

    /// Every bid the next bidder may legally place.
    fn legal_bids(&self) -> Vec<u8> {
        self.inner.legal_bids()
    }

    fn place_bid(&mut self, seat: &Seat, bid: u8) -> PyResult<()> {
        self.inner.place_bid(seat.inner, bid).map_err(to_pyerr)
    }

    /// Tricks so far, in completion order; the last may be in progress.
    fn tricks(&self) -> Vec<Trick> {
        self.inner.tricks().iter().cloned().map(Into::into).collect()
    }

    fn current_trick(&self) -> Option<Trick> {
        self.inner.current_trick().cloned().map(Into::into)
    }

    /// The seat due to play a card, or `None` during bidding / once complete.
    fn next_player(&self) -> Option<Seat> {
        self.inner.next_player().map(Into::into)
    }

    /// The cards `seat` could legally play into the current trick.
    fn legal_plays(&self, seat: &Seat) -> Vec<Card> {
        self.inner.legal_plays(seat.inner).into_iter().map(Into::into).collect()
    }

    /// Play a card. Returns the trick's winner when this play completes it,
    /// else `None` while the trick is still open.
    fn play_card(&mut self, seat: &Seat, card: &Card) -> PyResult<Option<Seat>> {
        self.inner.play_card(seat.inner, card.inner).map(|w| w.map(Into::into)).map_err(to_pyerr)
    }

    fn is_complete(&self) -> bool {
        self.inner.is_complete()
    }

    /// Tricks won by `seat` so far this round.
    fn tricks_won(&self, seat: &Seat) -> u8 {
        self.inner.tricks_won(seat.inner)
    }

    /// Per-seat round scores, once every trick has been played.
    fn deltas(&self) -> Option<Vec<i32>> {
        self.inner.deltas()
    }

    fn __repr__(&self) -> String {
        format!(
            "Round(index={}, cards_dealt={}, complete={})",
            self.inner.index(),
            self.inner.cards_dealt(),
            self.inner.is_complete(),
        )
    }
}
