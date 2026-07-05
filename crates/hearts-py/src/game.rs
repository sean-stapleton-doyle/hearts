//! Game / Phase / PlayOutcome / RoundResult wrappers — the main entry point.
//!
//! `Game` is the driver: `place_bid` and `play_card` are the only mutating
//! inputs; everything else reads state. `PlayOutcome` is exposed as a PyO3
//! complex enum, so `play_card` returns e.g. `PlayOutcome.RoundComplete` with
//! `trick_winner` / `deltas` attributes. JSON snapshotting rides on the core
//! `serde` feature.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use hearts_core as hc;

use crate::card::Card;
use crate::error::to_pyerr;
use crate::mirror_enum;
use crate::round::{Deck, Round, Seat};

#[pyclass(eq, eq_int, frozen, skip_from_py_object, module = "pyhearts")]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Phase {
    Bidding,
    Playing,
    GameOver,
}

mirror_enum!(Phase, hc::Phase { Bidding, Playing, GameOver });

/// What a successful `play_card` set in motion.
#[pyclass(skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub enum PlayOutcome {
    /// The trick is still open; the next seat is due to play.
    TrickContinues {},
    /// The trick closed; its winner leads the next one.
    TrickComplete { winner: Seat },
    /// The round's last trick closed: scores applied, next round dealt.
    RoundComplete { trick_winner: Seat, deltas: Vec<i32> },
    /// Round 13 finished; the game is over.
    GameOver { trick_winner: Seat, deltas: Vec<i32> },
}

impl From<hc::PlayOutcome> for PlayOutcome {
    fn from(o: hc::PlayOutcome) -> Self {
        match o {
            hc::PlayOutcome::TrickContinues => PlayOutcome::TrickContinues {},
            hc::PlayOutcome::TrickComplete { winner } => {
                PlayOutcome::TrickComplete { winner: winner.into() }
            }
            hc::PlayOutcome::RoundComplete { trick_winner, deltas } => {
                PlayOutcome::RoundComplete { trick_winner: trick_winner.into(), deltas }
            }
            hc::PlayOutcome::GameOver { trick_winner, deltas } => {
                PlayOutcome::GameOver { trick_winner: trick_winner.into(), deltas }
            }
        }
    }
}

/// The record of a finished round, kept for history and analysis.
#[pyclass(skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub struct RoundResult {
    pub(crate) inner: hc::RoundResult,
}

impl From<hc::RoundResult> for RoundResult {
    fn from(inner: hc::RoundResult) -> Self {
        RoundResult { inner }
    }
}

#[pymethods]
impl RoundResult {
    #[getter]
    fn index(&self) -> u8 {
        self.inner.index
    }

    #[getter]
    fn dealer(&self) -> Seat {
        self.inner.dealer.into()
    }

    #[getter]
    fn bids(&self) -> Vec<u8> {
        self.inner.bids.clone()
    }

    #[getter]
    fn tricks_won(&self) -> Vec<u8> {
        self.inner.tricks_won.clone()
    }

    #[getter]
    fn deltas(&self) -> Vec<i32> {
        self.inner.deltas.clone()
    }

    fn __repr__(&self) -> String {
        format!(
            "RoundResult(index={}, bids={:?}, tricks_won={:?}, deltas={:?})",
            self.inner.index, self.inner.bids, self.inner.tricks_won, self.inner.deltas,
        )
    }
}

/// Whole-game orchestration over 13 rounds — the driver a Python caller uses.
#[pyclass(skip_from_py_object, module = "pyhearts")]
#[derive(Clone)]
pub struct Game {
    inner: hc::Game,
}

#[pymethods]
impl Game {
    /// Start a game: shuffle the deck once from `seed` and deal round 1.
    /// The first dealer is seat 0 (see `with_first_dealer`).
    #[new]
    fn new(num_players: usize, seed: u64) -> PyResult<Self> {
        hc::Game::new(num_players, seed).map(|inner| Game { inner }).map_err(to_pyerr)
    }

    #[staticmethod]
    fn with_first_dealer(num_players: usize, seed: u64, first_dealer: &Seat) -> PyResult<Self> {
        hc::Game::with_first_dealer(num_players, seed, first_dealer.inner)
            .map(|inner| Game { inner })
            .map_err(to_pyerr)
    }

    #[getter]
    fn num_players(&self) -> usize {
        self.inner.num_players()
    }

    #[getter]
    fn seed(&self) -> u64 {
        self.inner.seed()
    }

    /// The current round number, 1..=13 (13 after the game ends).
    #[getter]
    fn round_index(&self) -> u8 {
        self.inner.round_index()
    }

    #[getter]
    fn dealer(&self) -> Seat {
        self.inner.dealer().into()
    }

    /// The deck as it stands (hidden information; useful for analysis).
    fn deck(&self) -> Deck {
        self.inner.deck().clone().into()
    }

    /// Cumulative scores by seat; may go negative.
    fn scores(&self) -> Vec<i32> {
        self.inner.scores().to_vec()
    }

    /// The round in progress, or `None` once the game is over.
    fn round(&self) -> Option<Round> {
        self.inner.round().cloned().map(Into::into)
    }

    /// Results of every finished round, in order.
    fn history(&self) -> Vec<RoundResult> {
        self.inner.history().iter().cloned().map(Into::into).collect()
    }

    fn phase(&self) -> Phase {
        self.inner.phase().into()
    }

    /// The winner(s) once the game is over: every seat tied for the top score.
    fn winners(&self) -> Option<Vec<Seat>> {
        self.inner.winners().map(|seats| seats.into_iter().map(Into::into).collect())
    }

    fn place_bid(&mut self, seat: &Seat, bid: u8) -> PyResult<()> {
        self.inner.place_bid(seat.inner, bid).map_err(to_pyerr)
    }

    fn play_card(&mut self, seat: &Seat, card: &Card) -> PyResult<PlayOutcome> {
        self.inner.play_card(seat.inner, card.inner).map(Into::into).map_err(to_pyerr)
    }

    /// Serialize the full game state to a JSON string.
    fn to_json(&self) -> PyResult<String> {
        serde_json::to_string(&self.inner).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// Rebuild a game from a JSON string produced by `to_json`.
    #[staticmethod]
    fn from_json(data: &str) -> PyResult<Self> {
        serde_json::from_str(data)
            .map(|inner| Game { inner })
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn __repr__(&self) -> String {
        format!(
            "Game(num_players={}, seed={}, round_index={}, phase={:?})",
            self.inner.num_players(),
            self.inner.seed(),
            self.inner.round_index(),
            self.inner.phase(),
        )
    }
}
