//! End-to-end games driven purely through the public API, the way a server
//! or analysis harness would: ask the engine who acts and what is legal,
//! then submit an action.

use hearts_core::{Game, Phase, PlayOutcome, Seat, cards_for_round};

/// Total cards across deck, hands, and tricks — must always be 52.
fn total_cards(game: &Game) -> usize {
    let in_round = game.round().map_or(0, |round| {
        let in_hands: usize =
            (0..game.num_players()).map(|seat| round.hand(Seat(seat)).len()).sum();
        let in_tricks: usize = round.tricks().iter().map(|trick| trick.plays().len()).sum();
        in_hands + in_tricks
    });
    game.deck().len() + in_round
}

/// Drive a full game with a deterministic policy: always the lowest legal
/// bid, always the first legal card. `pick` skews card choice per seat so
/// different seeds/counts explore different lines.
fn play_full_game(num_players: usize, seed: u64) -> Game {
    let mut game = Game::new(num_players, seed).unwrap();
    let mut rounds_seen = 0;
    loop {
        assert_eq!(total_cards(&game), 52, "card conservation violated");
        match game.phase() {
            Phase::Bidding => {
                let round = game.round().unwrap();
                let seat = round.next_bidder().unwrap();
                let bid = round.legal_bids()[0];
                game.place_bid(seat, bid).unwrap();
            }
            Phase::Playing => {
                let round = game.round().unwrap();
                let seat = round.next_player().unwrap();
                let choices = round.legal_plays(seat);
                assert!(!choices.is_empty());
                let card = choices[(seed as usize + seat.0) % choices.len()];
                match game.play_card(seat, card).unwrap() {
                    PlayOutcome::RoundComplete { deltas, .. }
                    | PlayOutcome::GameOver { deltas, .. } => {
                        rounds_seen += 1;
                        assert_eq!(deltas.len(), num_players);
                    }
                    _ => {}
                }
            }
            Phase::GameOver => break,
        }
    }
    assert_eq!(rounds_seen, 13);
    game
}

#[test]
fn full_games_complete_for_all_table_sizes() {
    for num_players in 2..=7 {
        for seed in [0, 1, 12345] {
            let game = play_full_game(num_players, seed);
            assert_eq!(game.history().len(), 13);
            assert_eq!(game.deck().len(), 52);
            assert!(!game.winners().unwrap().is_empty());

            for (i, result) in game.history().iter().enumerate() {
                let cards = cards_for_round(i as u8 + 1);
                assert_eq!(result.index, i as u8 + 1);
                // Tricks won each round sum to the tricks available.
                assert_eq!(result.tricks_won.iter().sum::<u8>(), cards);
                // The hook guarantees someone misses every round.
                assert_ne!(result.bids.iter().sum::<u8>(), cards);
            }

            // Cumulative scores equal the sum of round deltas.
            for seat in 0..num_players {
                let total: i32 = game.history().iter().map(|r| r.deltas[seat]).sum();
                assert_eq!(game.scores()[seat], total);
            }
        }
    }
}

#[test]
fn same_seed_and_actions_reproduce_the_same_game() {
    let a = play_full_game(4, 777);
    let b = play_full_game(4, 777);
    assert_eq!(a, b);
    let c = play_full_game(4, 778);
    assert_ne!(a, c);
}

/// Spec §4.2: played cards return to the bottom of the deck in play order,
/// so with a 1-card round the deck's last two cards are the lead then the
/// follow.
#[test]
fn played_cards_return_to_deck_bottom_in_play_order() {
    let mut game = Game::new(2, 42).unwrap();
    let dealer = game.dealer();
    let other = dealer.next(2);

    game.place_bid(dealer, 0).unwrap();
    // Hook: 1 trick, dealer bid 0 → the other player may not bid 1.
    assert_eq!(game.round().unwrap().legal_bids(), vec![0]);
    game.place_bid(other, 0).unwrap();

    let dealer_card = game.round().unwrap().hand(dealer)[0];
    let other_card = game.round().unwrap().hand(other)[0];
    game.play_card(dealer, dealer_card).unwrap();
    let outcome = game.play_card(other, other_card).unwrap();

    // One of the two won a trick they bid 0 on (−1); the other made 0 (+1).
    match outcome {
        PlayOutcome::RoundComplete { trick_winner, deltas } => {
            assert_eq!(deltas[trick_winner.0], -1);
            assert_eq!(deltas.iter().sum::<i32>(), 0);
            // The +1 player deals round 2.
            assert_eq!(game.dealer(), trick_winner.next(2));
        }
        other => panic!("expected RoundComplete, got {other:?}"),
    }

    // Round 2 has been dealt off the top; the played cards sit at the
    // bottom, lead first-returned (higher) and follow last (bottom).
    assert_eq!(game.round_index(), 2);
    let deck: Vec<_> = game.deck().iter().copied().collect();
    assert_eq!(deck[deck.len() - 2..], [dealer_card, other_card]);
}
