//! The never-reshuffled deck (spec §2.1, §4).
//!
//! The deck is an ordered queue: deal from the top, return spent cards to
//! the bottom. It is shuffled exactly once, at game start, from a seed —
//! the shuffle is implemented in-crate (SplitMix64 + Fisher–Yates) so the
//! same seed produces the same game on any platform, with no dependency on
//! an external RNG crate's stability guarantees.

use std::collections::VecDeque;

use crate::card::{Card, Rank, Suit};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Deck {
    cards: VecDeque<Card>,
}

impl Deck {
    /// All 52 cards in a fixed reference order (suits per [`Suit::ALL`],
    /// ranks low to high). Mostly useful for tests and enumeration.
    pub fn standard() -> Self {
        let mut cards = VecDeque::with_capacity(52);
        for suit in Suit::ALL {
            for rank in Rank::ALL {
                cards.push_back(Card::new(suit, rank));
            }
        }
        Deck { cards }
    }

    /// The standard deck shuffled deterministically from `seed`. This is the
    /// game's single shuffle (spec §2.1): the deck is never shuffled again.
    pub fn shuffled(seed: u64) -> Self {
        let mut deck = Deck::standard();
        let cards = deck.cards.make_contiguous();
        let mut rng = SplitMix64(seed);
        for i in (1..cards.len()).rev() {
            let j = rng.next_below(i as u64 + 1) as usize;
            cards.swap(i, j);
        }
        deck
    }

    /// Deal one card off the top.
    pub fn deal(&mut self) -> Option<Card> {
        self.cards.pop_front()
    }

    /// Return a spent card to the bottom (spec §4.2).
    pub fn return_card(&mut self, card: Card) {
        self.cards.push_back(card);
    }

    pub fn len(&self) -> usize {
        self.cards.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }

    /// Cards from top (next to be dealt) to bottom.
    pub fn iter(&self) -> impl Iterator<Item = &Card> {
        self.cards.iter()
    }
}

/// Minimal deterministic RNG (SplitMix64) for the one-time shuffle.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    // Modulo bias is negligible for bounds ≤ 52 against a 64-bit range.
    fn next_below(&mut self, bound: u64) -> u64 {
        self.next_u64() % bound
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn standard_deck_has_52_unique_cards() {
        let deck = Deck::standard();
        assert_eq!(deck.len(), 52);
        let unique: HashSet<_> = deck.iter().collect();
        assert_eq!(unique.len(), 52);
    }

    #[test]
    fn shuffle_is_deterministic_per_seed() {
        assert_eq!(Deck::shuffled(7), Deck::shuffled(7));
        assert_ne!(Deck::shuffled(7), Deck::shuffled(8));
    }

    #[test]
    fn shuffled_deck_is_a_permutation() {
        let deck = Deck::shuffled(42);
        assert_eq!(deck.len(), 52);
        let unique: HashSet<_> = deck.iter().collect();
        assert_eq!(unique.len(), 52);
    }

    #[test]
    fn deal_from_top_return_to_bottom() {
        let mut deck = Deck::standard();
        let top = deck.deal().unwrap();
        assert_eq!(deck.len(), 51);
        deck.return_card(top);
        assert_eq!(deck.len(), 52);
        assert_eq!(deck.iter().last(), Some(&top));
    }
}
