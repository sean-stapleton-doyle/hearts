"""Feature extraction, preset equivalences, bid legality, and full-game
legality for the linear feature-bidder family."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import make_obs

from hearts_analysis import runner
from hearts_analysis.policies import HeuristicPolicy
from hearts_analysis.policies.feature_bidder import (
    FEATURES, PRESETS, FeatureBidderPolicy, grid, hand_features, make_preset,
)

# Card ints: suit*13 + rank-2; suits C=0 D=1 S=2 H=3.
A_HEARTS, K_HEARTS, FIVE_HEARTS = 51, 50, 42
A_SPADES, K_DIAMONDS, J_CLUBS, TWO_CLUBS = 38, 24, 9, 0


def test_hand_features_counts():
    f = hand_features((A_HEARTS, FIVE_HEARTS, A_SPADES, K_DIAMONDS, J_CLUBS))
    assert f == {
        "n_hearts": 2, "n_high_hearts": 1,  # A♥ high, 5♥ low
        "n_offsuit_ace": 1, "n_offsuit_king": 1, "n_offsuit_high": 2,
        "n_face": 2,  # K♦ and J♣ (aces are not face cards)
    }


def test_empty_hand_all_zero():
    assert all(v == 0 for v in hand_features(()).values())


def test_tuned_preset_matches_heuristic_estimate():
    heuristic = HeuristicPolicy()
    tuned = make_preset("tuned")
    rng = np.random.default_rng(0)
    for _ in range(50):
        hand = tuple(rng.choice(52, size=7, replace=False))
        assert tuned.estimate_tricks(hand) == pytest.approx(
            heuristic.estimate_tricks(hand)
        )


def test_bid_is_nearest_legal_and_respects_forbidden():
    # hearts_only with 3 hearts estimates 3; forbidden 3 forces a neighbor.
    p = make_preset("hearts_only")
    hand = (A_HEARTS, K_HEARTS, FIVE_HEARTS, TWO_CLUBS, J_CLUBS, K_DIAMONDS, A_SPADES)
    obs = make_obs(
        round_index=7, cards_this_round=7, hand=hand,
        legal_bids=(0, 1, 2, 4, 5, 6, 7), forbidden_bid=3, my_bid_position=3,
        bids=(None, 1, 1, 1),
    )
    assert p.bid(obs) == 2  # nearest legal to 3, ties break down


def test_unknown_feature_rejected():
    with pytest.raises(ValueError, match="unknown features"):
        FeatureBidderPolicy({"n_unicorns": 1.0})


def test_grid_is_valid_and_sized():
    g = grid()
    assert len(g) == 18
    for weights in g.values():
        assert set(weights) <= set(FEATURES)


def test_presets_play_full_games_legally():
    for name in PRESETS:
        table = [make_preset(name), HeuristicPolicy(), HeuristicPolicy(), HeuristicPolicy()]
        rec = runner.play_game(table, game_seed=7, validate=True)
        assert len(rec.rounds) == 13 * 4
        assert rec.policy_names[0] == f"fb:{name}"
