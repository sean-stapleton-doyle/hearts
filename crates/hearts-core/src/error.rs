//! Typed rejections for every rule an action can violate (spec §9).
//!
//! A future server layer maps these onto protocol errors; nothing here is
//! a bug condition — each variant is a client action the engine refused.

use std::error::Error;
use std::fmt;

use crate::card::{Card, Suit};
use crate::seat::Seat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum GameError {
    /// Player count outside 2..=7 (spec §2.2).
    InvalidPlayerCount(usize),
    /// Round index outside 1..=13 (spec §3).
    InvalidRoundIndex(u8),
    /// A seat index at or beyond the player count.
    InvalidSeat(Seat),
    /// A hand did not contain exactly `cards(r)` cards.
    WrongHandSize { seat: Seat, expected: u8, actual: usize },
    /// The game has finished; no further actions are accepted.
    GameOver,
    /// A bid arrived after all bids were placed.
    BiddingComplete,
    /// A card was played before bidding finished.
    BiddingNotComplete,
    /// All tricks of the round have been played.
    RoundComplete,
    /// It is not this seat's turn to act.
    NotYourTurn(Seat),
    /// Bid outside `[0, cards_dealt]` (spec §5.2).
    BidOutOfRange { bid: u8, max: u8 },
    /// The hook: the last bidder may not make total bids equal the trick
    /// count (spec §5.2).
    ForbiddenBid(u8),
    /// The player does not hold the card they tried to play.
    CardNotHeld(Card),
    /// The player holds a card of the led suit and must follow it (spec §5.3).
    MustFollowSuit(Suit),
}

impl fmt::Display for GameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GameError::InvalidPlayerCount(n) => {
                write!(f, "invalid player count {n}: must be 2 to 7")
            }
            GameError::InvalidRoundIndex(r) => {
                write!(f, "invalid round index {r}: must be 1 to 13")
            }
            GameError::InvalidSeat(seat) => write!(f, "{seat} is not at the table"),
            GameError::WrongHandSize { seat, expected, actual } => {
                write!(f, "{seat} was given {actual} cards, expected {expected}")
            }
            GameError::GameOver => f.write_str("the game is over"),
            GameError::BiddingComplete => f.write_str("bidding is already complete"),
            GameError::BiddingNotComplete => f.write_str("bidding is not complete yet"),
            GameError::RoundComplete => f.write_str("all tricks of the round have been played"),
            GameError::NotYourTurn(seat) => write!(f, "it is not {seat}'s turn"),
            GameError::BidOutOfRange { bid, max } => {
                write!(f, "bid {bid} is out of range 0 to {max}")
            }
            GameError::ForbiddenBid(bid) => {
                write!(f, "bid {bid} is forbidden: total bids may not equal the trick count")
            }
            GameError::CardNotHeld(card) => write!(f, "player does not hold {card}"),
            GameError::MustFollowSuit(suit) => write!(f, "must follow the led suit {suit}"),
        }
    }
}

impl Error for GameError {}
