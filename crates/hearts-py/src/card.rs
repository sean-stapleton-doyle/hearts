//! Card value types: `Suit`, `Rank`, `Card`.
//!
//! `Suit`/`Rank` are mirrored as native PyO3 enums (the orphan rule forbids
//! `#[pyclass]` on the foreign core enums), with `From` conversions in both
//! directions. `Card` is a small frozen wrapper around `hearts_core::Card`.

use pyo3::prelude::*;

use hearts_core as hc;

use crate::mirror_enum;

#[pyclass(eq, eq_int, hash, frozen, from_py_object, module = "pyhearts")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Suit {
    Clubs,
    Diamonds,
    Spades,
    Hearts,
}

mirror_enum!(Suit, hc::Suit { Clubs, Diamonds, Spades, Hearts });

#[pymethods]
impl Suit {
    /// Hearts are permanent trump.
    fn is_trump(&self) -> bool {
        hc::Suit::from(*self).is_trump()
    }

    /// All four suits, in reference order.
    #[classattr]
    #[allow(non_snake_case)]
    fn ALL() -> Vec<Suit> {
        hc::Suit::ALL.into_iter().map(Into::into).collect()
    }

    fn __str__(&self) -> String {
        hc::Suit::from(*self).to_string()
    }

    fn __repr__(&self) -> String {
        format!("Suit.{self:?}")
    }
}

#[pyclass(eq, eq_int, hash, frozen, from_py_object, module = "pyhearts")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rank {
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
    Ten = 10,
    Jack = 11,
    Queen = 12,
    King = 13,
    Ace = 14,
}

mirror_enum!(Rank, hc::Rank {
    Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace,
});

#[pymethods]
impl Rank {
    /// Numeric value, 2..=14 (ace high).
    fn value(&self) -> u8 {
        hc::Rank::from(*self).value()
    }

    /// All thirteen ranks, low to high.
    #[classattr]
    #[allow(non_snake_case)]
    fn ALL() -> Vec<Rank> {
        hc::Rank::ALL.into_iter().map(Into::into).collect()
    }

    fn __str__(&self) -> String {
        hc::Rank::from(*self).to_string()
    }

    fn __repr__(&self) -> String {
        format!("Rank.{self:?}")
    }
}

/// A single card. Immutable; hashable and comparable by value.
#[pyclass(eq, hash, frozen, from_py_object, module = "pyhearts")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Card {
    pub(crate) inner: hc::Card,
}

impl From<hc::Card> for Card {
    fn from(inner: hc::Card) -> Self {
        Card { inner }
    }
}

#[pymethods]
impl Card {
    #[new]
    fn new(suit: Suit, rank: Rank) -> Self {
        Card { inner: hc::Card::new(suit.into(), rank.into()) }
    }

    #[getter]
    fn suit(&self) -> Suit {
        self.inner.suit.into()
    }

    #[getter]
    fn rank(&self) -> Rank {
        self.inner.rank.into()
    }

    /// Whether this card beats `other` in a trick where `led_suit` was led.
    fn beats(&self, other: &Card, led_suit: Suit) -> bool {
        self.inner.beats(other.inner, led_suit.into())
    }

    fn __str__(&self) -> String {
        self.inner.to_string()
    }

    fn __repr__(&self) -> String {
        format!("Card({}, {})", self.inner.suit, self.inner.rank)
    }
}
