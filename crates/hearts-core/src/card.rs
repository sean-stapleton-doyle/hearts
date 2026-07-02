//! Cards, suits, and ranks (spec §2.1).
//!
//! Cards have no global ordering: which card "wins" depends on the led suit
//! and on hearts being permanent trump, so the comparison lives in
//! [`Card::beats`] and takes that context as an argument.

use std::fmt;

/// The four suits. Hearts are permanent trump (spec §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Suit {
    Clubs,
    Diamonds,
    Spades,
    Hearts,
}

impl Suit {
    pub const ALL: [Suit; 4] = [Suit::Clubs, Suit::Diamonds, Suit::Spades, Suit::Hearts];

    /// Any heart beats any non-heart, regardless of rank.
    pub fn is_trump(self) -> bool {
        self == Suit::Hearts
    }
}

impl fmt::Display for Suit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Suit::Clubs => "♣",
            Suit::Diamonds => "♦",
            Suit::Spades => "♠",
            Suit::Hearts => "♥",
        })
    }
}

/// Ranks, ace high (spec §2.1). Discriminants match the spec's numeric
/// encoding (J=11, Q=12, K=13, A=14), and the derived `Ord` uses them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Rank {
    Two = 2,
    Three,
    Four,
    Five,
    Six,
    Seven,
    Eight,
    Nine,
    Ten,
    Jack,
    Queen,
    King,
    Ace,
}

impl Rank {
    pub const ALL: [Rank; 13] = [
        Rank::Two,
        Rank::Three,
        Rank::Four,
        Rank::Five,
        Rank::Six,
        Rank::Seven,
        Rank::Eight,
        Rank::Nine,
        Rank::Ten,
        Rank::Jack,
        Rank::Queen,
        Rank::King,
        Rank::Ace,
    ];

    /// Numeric value per the spec's data model: 2..=14.
    pub fn value(self) -> u8 {
        self as u8
    }
}

impl fmt::Display for Rank {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Rank::Jack => f.write_str("J"),
            Rank::Queen => f.write_str("Q"),
            Rank::King => f.write_str("K"),
            Rank::Ace => f.write_str("A"),
            n => write!(f, "{}", n.value()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Card {
    pub suit: Suit,
    pub rank: Rank,
}

impl Card {
    pub fn new(suit: Suit, rank: Rank) -> Self {
        Card { suit, rank }
    }

    /// Whether `self` beats `other` in a trick where `led_suit` was led
    /// (spec §5.3):
    ///
    /// - any heart beats any non-heart; among hearts, higher rank wins;
    /// - otherwise only cards of the led suit can win, higher rank first;
    /// - off-suit, non-heart cards never beat anything.
    pub fn beats(self, other: Card, led_suit: Suit) -> bool {
        match (self.suit.is_trump(), other.suit.is_trump()) {
            (true, true) => self.rank > other.rank,
            (true, false) => true,
            (false, true) => false,
            (false, false) => {
                self.suit == led_suit && (other.suit != led_suit || self.rank > other.rank)
            }
        }
    }
}

impl fmt::Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.rank, self.suit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(suit: Suit, rank: Rank) -> Card {
        Card::new(suit, rank)
    }

    #[test]
    fn ace_is_high() {
        assert!(Rank::Ace > Rank::King);
        assert!(Rank::Ten > Rank::Two);
        assert_eq!(Rank::Ace.value(), 14);
        assert_eq!(Rank::Two.value(), 2);
    }

    #[test]
    fn any_heart_beats_any_non_heart() {
        let low_heart = c(Suit::Hearts, Rank::Two);
        let high_spade = c(Suit::Spades, Rank::Ace);
        assert!(low_heart.beats(high_spade, Suit::Spades));
        assert!(!high_spade.beats(low_heart, Suit::Spades));
    }

    #[test]
    fn among_hearts_rank_decides() {
        let h3 = c(Suit::Hearts, Rank::Three);
        let h9 = c(Suit::Hearts, Rank::Nine);
        assert!(h9.beats(h3, Suit::Clubs));
        assert!(!h3.beats(h9, Suit::Clubs));
    }

    #[test]
    fn led_suit_rank_decides_without_hearts() {
        let s10 = c(Suit::Spades, Rank::Ten);
        let sk = c(Suit::Spades, Rank::King);
        assert!(sk.beats(s10, Suit::Spades));
        assert!(!s10.beats(sk, Suit::Spades));
    }

    #[test]
    fn off_suit_non_heart_never_wins() {
        let s2 = c(Suit::Spades, Rank::Two);
        let da = c(Suit::Diamonds, Rank::Ace);
        assert!(s2.beats(da, Suit::Spades));
        assert!(!da.beats(s2, Suit::Spades));
    }
}
