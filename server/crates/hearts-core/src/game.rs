//! Whole-game orchestration: the §8 state machine over 13 rounds.
//!
//! `Game` owns the deck and cumulative scores and drives [`Round`]s through
//! deal → bid → play → score. Dealing and scoring are deterministic, so
//! they happen automatically: the only external inputs are
//! [`Game::place_bid`] and [`Game::play_card`], and the observable phases
//! reduce to bidding, playing, and game over.
//!
//! Everything is cheap to `Clone`, so callers can snapshot a game state and
//! explore continuations — the intended entry point for statistical or
//! probabilistic analysis.

use crate::card::Card;
use crate::deck::Deck;
use crate::error::GameError;
use crate::round::{MAX_PLAYERS, MIN_PLAYERS, NUM_ROUNDS, Round, cards_for_round, next_dealer};
use crate::seat::Seat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Phase {
    Bidding,
    Playing,
    GameOver,
}

/// What a successful [`Game::play_card`] set in motion.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum PlayOutcome {
    /// The trick is still open; the next seat is due to play.
    TrickContinues,
    /// The trick closed; its winner leads the next one.
    TrickComplete { winner: Seat },
    /// The round's last trick closed: scores were applied, cards returned
    /// to the deck, and the next round dealt.
    RoundComplete { trick_winner: Seat, deltas: Vec<i32> },
    /// Round 13 finished; the game is over.
    GameOver { trick_winner: Seat, deltas: Vec<i32> },
}

/// The record of a finished round, kept for history and analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoundResult {
    pub index: u8,
    pub dealer: Seat,
    pub bids: Vec<u8>,
    pub tricks_won: Vec<u8>,
    pub deltas: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Game {
    num_players: usize,
    seed: u64,
    deck: Deck,
    round_index: u8,
    dealer: Seat,
    scores: Vec<i32>,
    /// The round in progress; `None` once the game is over.
    round: Option<Round>,
    history: Vec<RoundResult>,
}

impl Game {
    /// Start a game: shuffle the deck once from `seed` and deal round 1.
    /// The first dealer is seat 0 (spec §4.3 leaves this to table
    /// convention; see [`Game::with_first_dealer`]).
    pub fn new(num_players: usize, seed: u64) -> Result<Self, GameError> {
        Self::with_first_dealer(num_players, seed, Seat(0))
    }

    pub fn with_first_dealer(
        num_players: usize,
        seed: u64,
        first_dealer: Seat,
    ) -> Result<Self, GameError> {
        if !(MIN_PLAYERS..=MAX_PLAYERS).contains(&num_players) {
            return Err(GameError::InvalidPlayerCount(num_players));
        }
        if first_dealer.0 >= num_players {
            return Err(GameError::InvalidSeat(first_dealer));
        }
        let mut game = Game {
            num_players,
            seed,
            deck: Deck::shuffled(seed),
            round_index: 1,
            dealer: first_dealer,
            scores: vec![0; num_players],
            round: None,
            history: Vec::with_capacity(NUM_ROUNDS as usize),
        };
        game.deal();
        Ok(game)
    }

    pub fn num_players(&self) -> usize {
        self.num_players
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// The deck as it stands. This is hidden information at the table; a
    /// server must not reveal it to players, but analysis code may want it.
    pub fn deck(&self) -> &Deck {
        &self.deck
    }

    /// The current round number, 1..=13 (13 after the game ends).
    pub fn round_index(&self) -> u8 {
        self.round_index
    }

    pub fn dealer(&self) -> Seat {
        self.dealer
    }

    /// Cumulative scores by seat; may go negative (spec §5.4).
    pub fn scores(&self) -> &[i32] {
        &self.scores
    }

    /// The round in progress, if the game is not over.
    pub fn round(&self) -> Option<&Round> {
        self.round.as_ref()
    }

    /// Results of every finished round, in order.
    pub fn history(&self) -> &[RoundResult] {
        &self.history
    }

    pub fn phase(&self) -> Phase {
        match &self.round {
            None => Phase::GameOver,
            Some(round) if !round.bidding_complete() => Phase::Bidding,
            Some(_) => Phase::Playing,
        }
    }

    /// The winner(s) once the game is over: highest cumulative score. The
    /// spec leaves the tie-break open (§6), so every tied seat is returned.
    pub fn winners(&self) -> Option<Vec<Seat>> {
        if self.round.is_some() {
            return None;
        }
        let top = *self.scores.iter().max().expect("at least two players");
        Some(
            self.scores
                .iter()
                .enumerate()
                .filter(|&(_, &score)| score == top)
                .map(|(seat, _)| Seat(seat))
                .collect(),
        )
    }

    pub fn place_bid(&mut self, seat: Seat, bid: u8) -> Result<(), GameError> {
        let round = self.round.as_mut().ok_or(GameError::GameOver)?;
        round.place_bid(seat, bid)
    }

    pub fn play_card(&mut self, seat: Seat, card: Card) -> Result<PlayOutcome, GameError> {
        let round = self.round.as_mut().ok_or(GameError::GameOver)?;
        let Some(winner) = round.play_card(seat, card)? else {
            return Ok(PlayOutcome::TrickContinues);
        };
        if !round.is_complete() {
            return Ok(PlayOutcome::TrickComplete { winner });
        }
        let deltas = self.finish_round();
        if self.round.is_some() {
            Ok(PlayOutcome::RoundComplete { trick_winner: winner, deltas })
        } else {
            Ok(PlayOutcome::GameOver { trick_winner: winner, deltas })
        }
    }

    /// Deal the current round (spec §4.1): one card at a time off the top,
    /// starting at the dealer's left, around the table until every player
    /// has `cards(r)` cards.
    fn deal(&mut self) {
        let cards = cards_for_round(self.round_index);
        let mut hands = vec![Vec::with_capacity(cards as usize); self.num_players];
        for _ in 0..cards {
            for by in 1..=self.num_players {
                let seat = self.dealer.offset(by, self.num_players);
                hands[seat.0].push(self.deck.deal().expect("52 cards cover any deal"));
            }
        }
        self.round = Some(
            Round::new(self.round_index, self.dealer, hands).expect("dealt hands are valid"),
        );
    }

    /// Round resolution (spec §5.5): apply deltas, record the result, hand
    /// the deal to the round's top scorer, return the played cards to the
    /// bottom of the deck (trick by trick, in play order), and deal the
    /// next round — or end the game after round 13.
    fn finish_round(&mut self) -> Vec<i32> {
        let round = self.round.take().expect("round in progress");
        let deltas = round.deltas().expect("round complete");
        for (score, delta) in self.scores.iter_mut().zip(&deltas) {
            *score += delta;
        }
        self.history.push(RoundResult {
            index: self.round_index,
            dealer: self.dealer,
            bids: round.bids().iter().map(|bid| bid.expect("bidding complete")).collect(),
            tricks_won: (0..self.num_players)
                .map(|seat| round.tricks_won(Seat(seat)))
                .collect(),
            deltas: deltas.clone(),
        });
        for trick in round.tricks() {
            for &(_, card) in trick.plays() {
                self.deck.return_card(card);
            }
        }
        if self.round_index < NUM_ROUNDS {
            self.dealer = next_dealer(self.dealer, &deltas);
            self.round_index += 1;
            self.deal();
        }
        deltas
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_setups() {
        assert_eq!(Game::new(1, 0).unwrap_err(), GameError::InvalidPlayerCount(1));
        assert_eq!(Game::new(8, 0).unwrap_err(), GameError::InvalidPlayerCount(8));
        assert_eq!(
            Game::with_first_dealer(4, 0, Seat(4)).unwrap_err(),
            GameError::InvalidSeat(Seat(4))
        );
    }

    #[test]
    fn round_one_deals_one_card_each_from_dealers_left() {
        let game = Game::new(3, 99).unwrap();
        assert_eq!(game.phase(), Phase::Bidding);
        assert_eq!(game.round_index(), 1);
        assert_eq!(game.deck().len(), 52 - 3);
        let round = game.round().unwrap();
        for seat in 0..3 {
            assert_eq!(round.hand(Seat(seat)).len(), 1);
        }
        // Seat 1 (dealer's left) got the pre-shuffle top card.
        let mut fresh = Deck::shuffled(99);
        assert_eq!(round.hand(Seat(1))[0], fresh.deal().unwrap());
        assert_eq!(round.hand(Seat(2))[0], fresh.deal().unwrap());
        assert_eq!(round.hand(Seat(0))[0], fresh.deal().unwrap());
    }
}
