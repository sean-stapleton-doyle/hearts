"""End-to-end tests for the pyhearts bindings.

Mirrors the canonical Rust driver loop (see hearts-core
`tests/full_game.rs`): ask the round who acts and what's legal, then submit.
A fixed "first legal action" policy makes runs deterministic per seed, so we
can assert reproducibility and JSON round-tripping.
"""

import pytest

import pyhearts
from pyhearts import Game, Phase, PlayOutcome, Suit, Rank, Card, Seat


def play_full_game(num_players=4, seed=1):
    """Drive a game to completion with a deterministic first-legal policy.

    Returns (game, outcomes) where outcomes is the list of PlayOutcome objects.
    """
    game = Game(num_players, seed)
    outcomes = []
    while game.phase() != Phase.GameOver:
        rnd = game.round()
        if game.phase() == Phase.Bidding:
            seat = rnd.next_bidder()
            game.place_bid(seat, rnd.legal_bids()[0])
        else:
            seat = rnd.next_player()
            outcomes.append(game.play_card(seat, rnd.legal_plays(seat)[0]))
    return game, outcomes


def test_full_game_reaches_game_over_with_winners():
    game, outcomes = play_full_game(num_players=4, seed=7)
    assert game.phase() == Phase.GameOver
    assert game.round() is None
    winners = game.winners()
    assert winners is not None and len(winners) >= 1
    assert all(isinstance(w, Seat) for w in winners)
    # 13 rounds were recorded.
    assert len(game.history()) == pyhearts.NUM_ROUNDS
    # Winner(s) hold the top cumulative score.
    scores = game.scores()
    top = max(scores)
    assert {w.index for w in winners} == {i for i, s in enumerate(scores) if s == top}
    # The very last play ends the game.
    assert isinstance(outcomes[-1], PlayOutcome.GameOver)
    assert len(outcomes[-1].deltas) == 4


def test_determinism_same_seed_same_actions():
    g1, _ = play_full_game(num_players=4, seed=42)
    g2, _ = play_full_game(num_players=4, seed=42)
    assert g1.scores() == g2.scores()
    assert g1.to_json() == g2.to_json()

    g3, _ = play_full_game(num_players=4, seed=43)
    assert g1.to_json() != g3.to_json()


def test_json_round_trip_mid_game_is_playable():
    game = Game(4, 99)
    # Advance a little: finish bidding for round 1.
    while game.phase() == Phase.Bidding:
        rnd = game.round()
        seat = rnd.next_bidder()
        game.place_bid(seat, rnd.legal_bids()[0])

    blob = game.to_json()
    restored = Game.from_json(blob)
    # Structurally identical snapshot.
    assert restored.to_json() == blob
    assert restored.phase() == game.phase()
    assert restored.scores() == game.scores()

    # And still playable: driving both identically keeps them equal.
    def step(g):
        rnd = g.round()
        seat = rnd.next_player()
        g.play_card(seat, rnd.legal_plays(seat)[0])

    step(game)
    step(restored)
    assert game.to_json() == restored.to_json()


def test_play_outcome_variants_appear():
    _, outcomes = play_full_game(num_players=4, seed=3)
    kinds = {type(o).__name__ for o in outcomes}
    # A full game must produce continuing tricks, completed tricks, completed
    # rounds, and exactly one game-over.
    assert "TrickContinues" in kinds
    assert "TrickComplete" in kinds
    assert "RoundComplete" in kinds
    assert sum(isinstance(o, PlayOutcome.GameOver) for o in outcomes) == 1


def test_illegal_action_raises_game_error():
    game = Game(4, 1)
    # Round 1: dealer (seat 0) bids first. Seat 1 acting out of turn is refused.
    with pytest.raises(pyhearts.GameError):
        game.place_bid(Seat(1), 0)


def test_card_not_held_raises_game_error():
    game = Game(4, 1)
    rnd = game.round()
    # Finish bidding with the first-legal policy.
    while game.phase() == Phase.Bidding:
        rnd = game.round()
        game.place_bid(rnd.next_bidder(), rnd.legal_bids()[0])
    rnd = game.round()
    seat = rnd.next_player()
    held = set((c.suit, c.rank) for c in rnd.hand(seat))
    # Find a card the player does not hold (round 1 deals a single card).
    missing = next(
        Card(s, r)
        for s in Suit.ALL
        for r in Rank.ALL
        if (s, r) not in held
    )
    with pytest.raises(pyhearts.GameError):
        game.play_card(seat, missing)


def test_cards_for_round_guards_range():
    assert pyhearts.cards_for_round(1) == 1
    assert pyhearts.cards_for_round(7) == 7
    assert pyhearts.cards_for_round(13) == 1
    with pytest.raises(ValueError):
        pyhearts.cards_for_round(0)
    with pytest.raises(ValueError):
        pyhearts.cards_for_round(14)


def test_card_value_semantics():
    ace_hearts = Card(Suit.Hearts, Rank.Ace)
    two_spades = Card(Suit.Spades, Rank.Two)
    # Any heart beats any non-heart, regardless of led suit.
    assert ace_hearts.beats(two_spades, Suit.Spades)
    assert not two_spades.beats(ace_hearts, Suit.Spades)
    # Hashable / equal by value.
    assert Card(Suit.Hearts, Rank.Ace) == ace_hearts
    assert len({ace_hearts, Card(Suit.Hearts, Rank.Ace)}) == 1
    assert Suit.Hearts.is_trump() and not Suit.Spades.is_trump()
    assert Rank.Ace.value() == 14


def test_score_delta_and_constants():
    assert pyhearts.score_delta(2, 2) == 3
    assert pyhearts.score_delta(2, 1) == -1
    assert pyhearts.score_delta(0, 0) == 1
    assert pyhearts.MIN_PLAYERS == 2
    assert pyhearts.MAX_PLAYERS == 7
    assert pyhearts.NUM_ROUNDS == 13


def test_stub_covers_exported_symbols():
    """Every public symbol in the compiled module should appear in the stub."""
    import ast
    import pathlib

    stub_path = pathlib.Path(pyhearts.__file__).with_name("__init__.pyi")
    tree = ast.parse(stub_path.read_text())
    declared = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    }
    declared |= {
        t.id
        for node in tree.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
        for t in [node.target]
    }
    exported = {name for name in dir(pyhearts) if not name.startswith("_")}
    # `from .pyhearts import *` in the generated __init__.py also binds the
    # compiled submodule itself as `pyhearts.pyhearts` — an implementation
    # detail, not a public symbol the stub should declare.
    exported -= {"pyhearts"}
    missing = exported - declared
    assert not missing, f"symbols missing from __init__.pyi: {sorted(missing)}"
