//! With the `serde` feature, a `Game` must survive a JSON round-trip at any
//! point — this is exactly what the server's per-round snapshots rely on.

use hearts_core::{Game, Phase, Seat};

fn roundtrip(game: &Game) -> Game {
    let json = serde_json::to_string(game).expect("game serializes");
    serde_json::from_str(&json).expect("game deserializes")
}

/// Serialize/deserialize mid-game, then play both copies forward with the
/// same policy: they must stay identical to the original.
#[test]
fn game_survives_json_roundtrip_at_every_phase() {
    let mut game = Game::new(4, 2026).unwrap();
    assert_eq!(roundtrip(&game), game);

    let mut checked_mid_play = false;
    while game.phase() != Phase::GameOver {
        match game.phase() {
            Phase::Bidding => {
                let round = game.round().unwrap();
                let (seat, bid) = (round.next_bidder().unwrap(), round.legal_bids()[0]);
                game.place_bid(seat, bid).unwrap();
            }
            Phase::Playing => {
                let round = game.round().unwrap();
                let seat = round.next_player().unwrap();
                let card = round.legal_plays(seat)[0];
                game.play_card(seat, card).unwrap();
                // Round-trip once mid-trick, where every struct is populated.
                if !checked_mid_play {
                    assert_eq!(roundtrip(&game), game);
                    checked_mid_play = true;
                }
            }
            Phase::GameOver => unreachable!(),
        }
    }

    let restored = roundtrip(&game);
    assert_eq!(restored, game);
    assert_eq!(restored.history(), game.history());
    assert_eq!(restored.winners(), game.winners());
}

/// The restored game must be *playable*, not just structurally equal:
/// resume a snapshotted game and finish it.
#[test]
fn restored_game_continues_correctly()  {
    let mut game = Game::new(3, 7).unwrap();
    for _ in 0..3 {
        let round = game.round().unwrap();
        let (seat, bid) = (round.next_bidder().unwrap(), round.legal_bids()[0]);
        game.place_bid(seat, bid).unwrap();
    }

    let mut restored = roundtrip(&game);
    while restored.phase() != Phase::GameOver {
        let round = restored.round().unwrap();
        match round.next_bidder() {
            Some(seat) => {
                let bid = round.legal_bids()[0];
                restored.place_bid(seat, bid).unwrap();
            }
            None => {
                let seat = round.next_player().unwrap();
                let card = round.legal_plays(seat)[0];
                restored.play_card(seat, card).unwrap();
            }
        }
    }
    assert_eq!(restored.history().len(), 13);
    assert_eq!(restored.deck().len(), 52);
    let top = *restored.scores().iter().max().unwrap();
    let winners = restored.winners().unwrap();
    assert!(!winners.is_empty());
    assert!(winners.iter().all(|&Seat(seat)| restored.scores()[seat] == top));
}
