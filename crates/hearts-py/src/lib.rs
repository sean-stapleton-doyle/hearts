//! `pyhearts` — Python bindings for the `hearts-core` game engine.
//!
//! A thin, cloning translation layer over the pure Rust domain model: no game
//! logic lives here. Every type mirrors a `hearts-core` type, and the two
//! mutating inputs (`Game.place_bid`, `Game.play_card`) drive the same engine
//! the Rust server uses — so Python analysis and Rust play cannot diverge.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

mod card;
mod error;
mod game;
mod round;

/// Bidirectional `From` impls between a mirrored PyO3 enum and its
/// `hearts_core` counterpart, for enums whose variants line up 1:1 by name.
macro_rules! mirror_enum {
    ($py:ty, $core:path { $($variant:ident),+ $(,)? }) => {
        impl From<$core> for $py {
            fn from(v: $core) -> Self {
                use $core as Core;
                match v { $(Core::$variant => <$py>::$variant),+ }
            }
        }
        impl From<$py> for $core {
            fn from(v: $py) -> Self {
                use $core as Core;
                match v { $(<$py>::$variant => Core::$variant),+ }
            }
        }
    };
}
pub(crate) use mirror_enum;

use card::{Card, Rank, Suit};
use game::{Game, Phase, PlayOutcome, RoundResult};
use round::{Deck, Round, Seat, Trick};

/// Round score for one player: an exact bid earns the tricks plus a 1-point
/// bonus; a miss loses the gap in either direction.
#[pyfunction]
fn score_delta(bid: u8, tricks: u8) -> i32 {
    hearts_core::score_delta(bid, tricks)
}

/// Cards dealt per player in round `round_index` (1..=13): climbs 1..7, then
/// descends back to 1. Raises `ValueError` outside `1..=13` (the core function
/// panics, so the wrapper guards the boundary before the call).
#[pyfunction]
fn cards_for_round(round_index: u8) -> PyResult<u8> {
    if !(1..=hearts_core::NUM_ROUNDS).contains(&round_index) {
        return Err(PyValueError::new_err(format!(
            "round index {round_index} outside 1..=13"
        )));
    }
    Ok(hearts_core::cards_for_round(round_index))
}

#[pymodule]
fn pyhearts(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Suit>()?;
    m.add_class::<Rank>()?;
    m.add_class::<Card>()?;
    m.add_class::<Seat>()?;
    m.add_class::<Deck>()?;
    m.add_class::<Trick>()?;
    m.add_class::<Round>()?;
    m.add_class::<Phase>()?;
    m.add_class::<PlayOutcome>()?;
    m.add_class::<RoundResult>()?;
    m.add_class::<Game>()?;

    m.add("GameError", m.py().get_type::<error::GameError>())?;

    m.add("MIN_PLAYERS", hearts_core::MIN_PLAYERS)?;
    m.add("MAX_PLAYERS", hearts_core::MAX_PLAYERS)?;
    m.add("NUM_ROUNDS", hearts_core::NUM_ROUNDS)?;

    m.add_function(wrap_pyfunction!(score_delta, m)?)?;
    m.add_function(wrap_pyfunction!(cards_for_round, m)?)?;

    Ok(())
}
