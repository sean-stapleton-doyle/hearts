//! A single trick / showdown (spec §5.3).
//!
//! The trick records plays in order; the winner is derived from
//! [`Card::beats`] folded over the plays. Mutation goes through
//! [`Round::play_card`](crate::round::Round::play_card), which enforces
//! turn order and follow-suit — `Trick` itself holds no rules beyond
//! "who is winning".

use crate::card::{Card, Suit};
use crate::seat::Seat;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trick {
    leader: Seat,
    num_players: usize,
    plays: Vec<(Seat, Card)>,
}

impl Trick {
    pub(crate) fn new(leader: Seat, num_players: usize) -> Self {
        Trick { leader, num_players, plays: Vec::with_capacity(num_players) }
    }

    pub fn leader(&self) -> Seat {
        self.leader
    }

    /// The suit of the first card played, once there is one.
    pub fn led_suit(&self) -> Option<Suit> {
        self.plays.first().map(|(_, card)| card.suit)
    }

    /// Plays so far, in play order starting from the leader.
    pub fn plays(&self) -> &[(Seat, Card)] {
        &self.plays
    }

    /// The seat due to play next (the leader when the trick is empty).
    pub fn next_seat(&self) -> Seat {
        self.leader.offset(self.plays.len(), self.num_players)
    }

    pub fn is_complete(&self) -> bool {
        self.plays.len() == self.num_players
    }

    /// The play currently winning the trick (spec §5.3): the highest heart
    /// if any heart was played, otherwise the highest card of the led suit.
    /// A winner always exists once there is a play, because the lead itself
    /// is in the led suit.
    pub fn winning_play(&self) -> Option<(Seat, Card)> {
        let led_suit = self.led_suit()?;
        self.plays
            .iter()
            .copied()
            .reduce(|best, play| if play.1.beats(best.1, led_suit) { play } else { best })
    }

    /// The trick's winner, once all players have played.
    pub fn winner(&self) -> Option<Seat> {
        if self.is_complete() { self.winning_play().map(|(seat, _)| seat) } else { None }
    }

    pub(crate) fn add_play(&mut self, seat: Seat, card: Card) {
        debug_assert!(!self.is_complete());
        debug_assert_eq!(seat, self.next_seat());
        self.plays.push((seat, card));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{Rank, Suit};

    fn trick_of(leader: usize, cards: &[Card]) -> Trick {
        let mut trick = Trick::new(Seat(leader), cards.len());
        for (i, &card) in cards.iter().enumerate() {
            trick.add_play(Seat(leader).offset(i, cards.len()), card);
        }
        trick
    }

    /// Spec §11: A leads ♠10, B ♠K, C (void) ♥3, D ♠2 → C wins with ♥3.
    #[test]
    fn lowest_heart_beats_high_spades() {
        let trick = trick_of(
            0,
            &[
                Card::new(Suit::Spades, Rank::Ten),
                Card::new(Suit::Spades, Rank::King),
                Card::new(Suit::Hearts, Rank::Three),
                Card::new(Suit::Spades, Rank::Two),
            ],
        );
        assert_eq!(trick.led_suit(), Some(Suit::Spades));
        assert_eq!(trick.winner(), Some(Seat(2)));
    }

    #[test]
    fn highest_of_led_suit_wins_without_hearts() {
        let trick = trick_of(
            1,
            &[
                Card::new(Suit::Spades, Rank::Ten),
                Card::new(Suit::Spades, Rank::King),
                Card::new(Suit::Diamonds, Rank::Ace), // off-suit, cannot win
                Card::new(Suit::Spades, Rank::Two),
            ],
        );
        assert_eq!(trick.winner(), Some(Seat(2))); // seat 1 led; seat 2 played ♠K
    }

    #[test]
    fn hearts_led_highest_heart_wins() {
        let trick = trick_of(
            0,
            &[Card::new(Suit::Hearts, Rank::Nine), Card::new(Suit::Hearts, Rank::Queen)],
        );
        assert_eq!(trick.led_suit(), Some(Suit::Hearts));
        assert_eq!(trick.winner(), Some(Seat(1)));
    }

    #[test]
    fn no_winner_until_complete() {
        let mut trick = Trick::new(Seat(0), 3);
        trick.add_play(Seat(0), Card::new(Suit::Clubs, Rank::Ace));
        assert_eq!(trick.winner(), None);
        assert_eq!(trick.winning_play(), Some((Seat(0), Card::new(Suit::Clubs, Rank::Ace))));
        assert_eq!(trick.next_seat(), Seat(1));
    }
}
