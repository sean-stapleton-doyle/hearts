//! A single round: bidding (with the hook), trick play, and scoring
//! (spec §5).
//!
//! `Round` owns everything between deal and score: hands, bids, tricks.
//! It validates every action (spec §9) but knows nothing about the deck or
//! cumulative scores — that is [`Game`](crate::game::Game)'s job. `Round`
//! is constructible with arbitrary hands, so game positions can be set up
//! directly for tests or analysis without replaying a deck.

use crate::card::Card;
use crate::error::GameError;
use crate::seat::Seat;
use crate::trick::Trick;

pub const MIN_PLAYERS: usize = 2;
pub const MAX_PLAYERS: usize = 7;
pub const NUM_ROUNDS: u8 = 13;

/// Cards dealt per player in round `r` (spec §3): climbs 1..7, then
/// descends back to 1.
///
/// # Panics
/// If `round_index` is outside `1..=13`.
pub fn cards_for_round(round_index: u8) -> u8 {
    assert!(
        (1..=NUM_ROUNDS).contains(&round_index),
        "round index {round_index} outside 1..=13"
    );
    if round_index <= 7 { round_index } else { 14 - round_index }
}

/// Round score for one player (spec §5.4): an exact bid earns the tricks
/// plus a 1-point bonus; a miss loses the gap in either direction.
pub fn score_delta(bid: u8, tricks: u8) -> i32 {
    if bid == tricks { tricks as i32 + 1 } else { -(bid as i32 - tricks as i32).abs() }
}

/// Next round's dealer (spec §5.5): the player with the highest round
/// delta; ties go to the first tied seat in rotation starting from the
/// current dealer's left.
pub fn next_dealer(current_dealer: Seat, deltas: &[i32]) -> Seat {
    let n = deltas.len();
    let mut best = current_dealer.next(n);
    for by in 2..=n {
        let seat = current_dealer.offset(by, n);
        if deltas[seat.0] > deltas[best.0] {
            best = seat;
        }
    }
    best
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Round {
    index: u8,
    cards_dealt: u8,
    dealer: Seat,
    num_players: usize,
    hands: Vec<Vec<Card>>,
    bids: Vec<Option<u8>>,
    bids_placed: usize,
    tricks: Vec<Trick>,
}

impl Round {
    /// Build a round from dealt hands (`hands[seat]`, in deal order). Every
    /// hand must hold exactly [`cards_for_round`]`(index)` cards.
    pub fn new(index: u8, dealer: Seat, hands: Vec<Vec<Card>>) -> Result<Self, GameError> {
        if !(1..=NUM_ROUNDS).contains(&index) {
            return Err(GameError::InvalidRoundIndex(index));
        }
        let num_players = hands.len();
        if !(MIN_PLAYERS..=MAX_PLAYERS).contains(&num_players) {
            return Err(GameError::InvalidPlayerCount(num_players));
        }
        if dealer.0 >= num_players {
            return Err(GameError::InvalidSeat(dealer));
        }
        let cards_dealt = cards_for_round(index);
        for (seat, hand) in hands.iter().enumerate() {
            if hand.len() != cards_dealt as usize {
                return Err(GameError::WrongHandSize {
                    seat: Seat(seat),
                    expected: cards_dealt,
                    actual: hand.len(),
                });
            }
        }
        Ok(Round {
            index,
            cards_dealt,
            dealer,
            num_players,
            hands,
            bids: vec![None; num_players],
            bids_placed: 0,
            tricks: Vec::with_capacity(cards_dealt as usize),
        })
    }

    pub fn index(&self) -> u8 {
        self.index
    }

    pub fn cards_dealt(&self) -> u8 {
        self.cards_dealt
    }

    pub fn dealer(&self) -> Seat {
        self.dealer
    }

    pub fn num_players(&self) -> usize {
        self.num_players
    }

    /// A player's current hand, in deal order.
    pub fn hand(&self, seat: Seat) -> &[Card] {
        &self.hands[seat.0]
    }

    /// Bids by seat; `None` until that seat has bid.
    pub fn bids(&self) -> &[Option<u8>] {
        &self.bids
    }

    // ── Bidding (spec §5.2) ─────────────────────────────────────────────

    /// The seat due to bid: the dealer first, then around the table.
    pub fn next_bidder(&self) -> Option<Seat> {
        (self.bids_placed < self.num_players)
            .then(|| self.dealer.offset(self.bids_placed, self.num_players))
    }

    pub fn bidding_complete(&self) -> bool {
        self.bids_placed == self.num_players
    }

    /// The hook (spec §5.2): once only the last bidder remains, the bid
    /// that would make total bids equal the trick count — if it is in
    /// range. `None` while earlier seats are still bidding or when the
    /// would-be forbidden value is unreachable.
    pub fn forbidden_bid(&self) -> Option<u8> {
        if self.bids_placed != self.num_players - 1 {
            return None;
        }
        let sum: i32 = self.bids.iter().flatten().map(|&b| b as i32).sum();
        let forbidden = self.cards_dealt as i32 - sum;
        (0..=self.cards_dealt as i32).contains(&forbidden).then_some(forbidden as u8)
    }

    /// Every bid the next bidder may legally place; empty once bidding is
    /// complete.
    pub fn legal_bids(&self) -> Vec<u8> {
        if self.next_bidder().is_none() {
            return Vec::new();
        }
        let forbidden = self.forbidden_bid();
        (0..=self.cards_dealt).filter(|&bid| Some(bid) != forbidden).collect()
    }

    pub fn place_bid(&mut self, seat: Seat, bid: u8) -> Result<(), GameError> {
        let expected = self.next_bidder().ok_or(GameError::BiddingComplete)?;
        if seat != expected {
            return Err(GameError::NotYourTurn(seat));
        }
        if bid > self.cards_dealt {
            return Err(GameError::BidOutOfRange { bid, max: self.cards_dealt });
        }
        if self.forbidden_bid() == Some(bid) {
            return Err(GameError::ForbiddenBid(bid));
        }
        self.bids[seat.0] = Some(bid);
        self.bids_placed += 1;
        if self.bidding_complete() {
            // The dealer leads the first trick (spec §5.3).
            self.tricks.push(Trick::new(self.dealer, self.num_players));
        }
        Ok(())
    }

    // ── Play (spec §5.3) ────────────────────────────────────────────────

    /// Tricks so far, in completion order; the last may be in progress.
    pub fn tricks(&self) -> &[Trick] {
        &self.tricks
    }

    pub fn current_trick(&self) -> Option<&Trick> {
        self.tricks.last()
    }

    /// The seat due to play a card; `None` during bidding or once the
    /// round is complete.
    pub fn next_player(&self) -> Option<Seat> {
        let trick = self.tricks.last()?;
        (!trick.is_complete()).then(|| trick.next_seat())
    }

    /// The cards `seat` could legally play into the current trick:
    /// follow the led suit if able, otherwise anything — hearts may be
    /// led or dumped at any time. Does not check whose turn it is.
    pub fn legal_plays(&self, seat: Seat) -> Vec<Card> {
        let hand = &self.hands[seat.0];
        let led_suit = self
            .tricks
            .last()
            .filter(|trick| !trick.is_complete())
            .and_then(|trick| trick.led_suit());
        match led_suit {
            Some(led) if hand.iter().any(|card| card.suit == led) => {
                hand.iter().copied().filter(|card| card.suit == led).collect()
            }
            _ => hand.clone(),
        }
    }

    /// Play a card into the current trick. Returns the trick's winner when
    /// this play completes it (the winner leads the next trick), `None`
    /// while the trick is still open.
    pub fn play_card(&mut self, seat: Seat, card: Card) -> Result<Option<Seat>, GameError> {
        if !self.bidding_complete() {
            return Err(GameError::BiddingNotComplete);
        }
        let expected = self.next_player().ok_or(GameError::RoundComplete)?;
        if seat != expected {
            return Err(GameError::NotYourTurn(seat));
        }
        let led_suit = self.tricks.last().and_then(|trick| trick.led_suit());
        let hand = &mut self.hands[seat.0];
        let position =
            hand.iter().position(|&held| held == card).ok_or(GameError::CardNotHeld(card))?;
        if let Some(led) = led_suit
            && card.suit != led
            && hand.iter().any(|held| held.suit == led)
        {
            return Err(GameError::MustFollowSuit(led));
        }
        hand.remove(position);
        let trick = self.tricks.last_mut().expect("current trick exists");
        trick.add_play(seat, card);
        if !trick.is_complete() {
            return Ok(None);
        }
        let winner = trick.winner().expect("complete trick has a winner");
        if (self.tricks.len() as u8) < self.cards_dealt {
            self.tricks.push(Trick::new(winner, self.num_players));
        }
        Ok(Some(winner))
    }

    // ── Scoring (spec §5.4) ─────────────────────────────────────────────

    pub fn is_complete(&self) -> bool {
        self.tricks.len() == self.cards_dealt as usize
            && self.tricks.last().is_some_and(Trick::is_complete)
    }

    /// Tricks won by `seat` so far this round.
    pub fn tricks_won(&self, seat: Seat) -> u8 {
        self.tricks.iter().filter(|trick| trick.winner() == Some(seat)).count() as u8
    }

    /// Per-seat round scores, once every trick has been played.
    pub fn deltas(&self) -> Option<Vec<i32>> {
        if !self.is_complete() {
            return None;
        }
        Some(
            (0..self.num_players)
                .map(|seat| {
                    let bid = self.bids[seat].expect("bidding complete");
                    score_delta(bid, self.tricks_won(Seat(seat)))
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deck::Deck;

    /// A round with arbitrary (but valid) hands dealt from the reference
    /// deck; bidding tests only care about hand sizes.
    fn round(index: u8, dealer: usize, num_players: usize) -> Round {
        let mut deck = Deck::standard();
        let hands = (0..num_players)
            .map(|_| (0..cards_for_round(index)).map(|_| deck.deal().unwrap()).collect())
            .collect();
        Round::new(index, Seat(dealer), hands).unwrap()
    }

    #[test]
    fn cards_climb_to_seven_then_descend() {
        let expected = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
        for (i, &cards) in expected.iter().enumerate() {
            assert_eq!(cards_for_round(i as u8 + 1), cards);
        }
    }

    #[test]
    fn scoring_matches_spec_examples() {
        assert_eq!(score_delta(0, 0), 1); // exact 0 → +1
        assert_eq!(score_delta(2, 2), 3);
        assert_eq!(score_delta(2, 1), -1);
        assert_eq!(score_delta(2, 3), -1);
        assert_eq!(score_delta(0, 4), -4);
        assert_eq!(score_delta(5, 5), 6);
    }

    #[test]
    fn next_dealer_takes_highest_delta_ties_from_dealers_left() {
        assert_eq!(next_dealer(Seat(0), &[3, -1, 2, -1]), Seat(0));
        // Tie between seats 0 and 1 with dealer 1: order is 2, 3, 0, 1 → 0.
        assert_eq!(next_dealer(Seat(1), &[3, 3, 2, 1]), Seat(0));
        // Dealer loses ties to everyone: with all-equal deltas the seat at
        // the dealer's left deals next.
        assert_eq!(next_dealer(Seat(2), &[1, 1, 1, 1]), Seat(3));
    }

    #[test]
    fn bidding_starts_with_dealer_and_rotates() {
        let mut round = round(5, 1, 4);
        assert_eq!(round.next_bidder(), Some(Seat(1)));
        round.place_bid(Seat(1), 2).unwrap();
        assert_eq!(round.next_bidder(), Some(Seat(2)));
        assert_eq!(round.place_bid(Seat(0), 1), Err(GameError::NotYourTurn(Seat(0))));
    }

    /// Spec §5.2 examples, round 5 with players A=dealer, B, C, D.
    #[test]
    fn hook_forbids_bid_summing_to_trick_count() {
        // A=2, B=3, C=0 → forbidden 0.
        let mut r = round(5, 0, 4);
        for (seat, bid) in [(0, 2), (1, 3), (2, 0)] {
            r.place_bid(Seat(seat), bid).unwrap();
        }
        assert_eq!(r.forbidden_bid(), Some(0));
        assert_eq!(r.legal_bids(), vec![1, 2, 3, 4, 5]);
        assert_eq!(r.place_bid(Seat(3), 0), Err(GameError::ForbiddenBid(0)));
        r.place_bid(Seat(3), 1).unwrap();

        // A=2, B=1, C=1 → forbidden 1.
        let mut r = round(5, 0, 4);
        for (seat, bid) in [(0, 2), (1, 1), (2, 1)] {
            r.place_bid(Seat(seat), bid).unwrap();
        }
        assert_eq!(r.forbidden_bid(), Some(1));
        assert_eq!(r.legal_bids(), vec![0, 2, 3, 4, 5]);

        // A=4, B=4, C=4 → forbidden value −7 is out of range → unconstrained.
        let mut r = round(5, 0, 4);
        for seat in 0..3 {
            r.place_bid(Seat(seat), 4).unwrap();
        }
        assert_eq!(r.forbidden_bid(), None);
        assert_eq!(r.legal_bids(), vec![0, 1, 2, 3, 4, 5]);
    }

    /// Spec §10: two players, one card; dealer bids 0 → the last bidder
    /// may not bid 1, so only 0 remains.
    #[test]
    fn hook_applies_in_one_card_rounds() {
        let mut r = round(1, 0, 2);
        r.place_bid(Seat(0), 0).unwrap();
        assert_eq!(r.legal_bids(), vec![0]);
        assert_eq!(r.place_bid(Seat(1), 1), Err(GameError::ForbiddenBid(1)));
    }

    #[test]
    fn earlier_bidders_are_unconstrained() {
        let mut r = round(3, 0, 4);
        assert_eq!(r.forbidden_bid(), None);
        assert_eq!(r.legal_bids(), vec![0, 1, 2, 3]);
        assert_eq!(r.place_bid(Seat(0), 4), Err(GameError::BidOutOfRange { bid: 4, max: 3 }));
        r.place_bid(Seat(0), 3).unwrap();
    }

    #[test]
    fn dealer_leads_first_trick_after_bidding() {
        let mut r = round(1, 2, 3);
        assert_eq!(r.next_player(), None);
        let bids = [(2, 0), (0, 0), (1, 0)];
        for (seat, bid) in bids {
            assert_eq!(r.play_card(Seat(2), r.hand(Seat(2))[0]), Err(GameError::BiddingNotComplete));
            r.place_bid(Seat(seat), bid).unwrap();
        }
        assert_eq!(r.next_player(), Some(Seat(2)));
    }

    #[test]
    fn follow_suit_is_enforced() {
        use crate::card::{Rank, Suit};
        // Hand-built round 2, 2 players: seat 0 (dealer) holds ♣2 ♦2;
        // seat 1 holds ♣3 ♥2.
        let hands = vec![
            vec![Card::new(Suit::Clubs, Rank::Two), Card::new(Suit::Diamonds, Rank::Two)],
            vec![Card::new(Suit::Clubs, Rank::Three), Card::new(Suit::Hearts, Rank::Two)],
        ];
        let mut r = Round::new(2, Seat(0), hands).unwrap();
        r.place_bid(Seat(0), 0).unwrap();
        r.place_bid(Seat(1), 1).unwrap();

        // Seat 0 leads ♣2; seat 1 holds a club and may not throw the heart.
        r.play_card(Seat(0), Card::new(Suit::Clubs, Rank::Two)).unwrap();
        assert_eq!(
            r.legal_plays(Seat(1)),
            vec![Card::new(Suit::Clubs, Rank::Three)]
        );
        assert_eq!(
            r.play_card(Seat(1), Card::new(Suit::Hearts, Rank::Two)),
            Err(GameError::MustFollowSuit(Suit::Clubs))
        );
        let winner = r.play_card(Seat(1), Card::new(Suit::Clubs, Rank::Three)).unwrap();
        assert_eq!(winner, Some(Seat(1)));

        // Seat 1 leads the next trick; seat 0 is void in the led suit once
        // seat 1 leads the heart, so the off-suit diamond is legal.
        assert_eq!(r.next_player(), Some(Seat(1)));
        r.play_card(Seat(1), Card::new(Suit::Hearts, Rank::Two)).unwrap();
        let winner = r.play_card(Seat(0), Card::new(Suit::Diamonds, Rank::Two)).unwrap();
        assert_eq!(winner, Some(Seat(1)));

        assert!(r.is_complete());
        assert_eq!(r.tricks_won(Seat(1)), 2);
        // Seat 0: bid 0, won 0 → +1. Seat 1: bid 1, won 2 → −1.
        assert_eq!(r.deltas(), Some(vec![1, -1]));
    }
}
