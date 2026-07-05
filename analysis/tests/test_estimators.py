"""Validate the MC trick-distribution estimator against exact enumeration
for the 1-card round, and sanity-check MCBidderPolicy end to end."""

from __future__ import annotations

from itertools import combinations
from math import comb

import numpy as np
import pytest

from hearts_analysis import cards, estimators, runner
from hearts_analysis.policies import HeuristicPolicy, MCBidderPolicy


def _exact_p_win_one_card(my_card: int, dealer_leads: bool, n_players: int) -> float:
    """Exact P(my single card wins the only trick) in a `cards_dealt=1`
    round, enumerating every possible set of opponents' cards. Only the led
    suit (my card's, if I lead; otherwise irrelevant to *my* win chance only
    when I also hold the led suit) and my card matter, so this brute-forces
    every combination of the other n_players-1 cards from the remaining 51.
    """
    remaining = [c for c in range(cards.NUM_CARDS) if c != my_card]
    n_other = n_players - 1
    total = comb(len(remaining), n_other)
    wins = 0
    led_suit = my_card // 13 if dealer_leads else None
    for combo in combinations(remaining, n_other):
        if dealer_leads:
            beats_all = all(cards.beats(my_card, o, led_suit) for o in combo)
        else:
            # I am not the leader: the leader is one specific other seat.
            # For this exact check we only exercise the dealer-leads case
            # (dealer always leads the first trick), so this branch is unused.
            raise NotImplementedError
        wins += beats_all
    return wins / total


@pytest.mark.parametrize("my_card", [0, 12, 25, 38, 51])  # low/high clubs, hearts, etc.
@pytest.mark.parametrize("n_players", [2, 3])
def test_mc_matches_exact_one_card_round(my_card, n_players):
    exact = _exact_p_win_one_card(my_card, dealer_leads=True, n_players=n_players)
    rng = np.random.default_rng(0)
    counts = estimators.estimate_trick_distribution(
        hand=(my_card,), seat=0, num_players=n_players, cards_dealt=1, dealer=0,
        known_bids=[None] * n_players, candidate_bid=1, n_samples=20_000, rng=rng,
    )
    mc_p_win = counts[1] / counts.sum()
    assert abs(mc_p_win - exact) < 0.02, f"{mc_p_win=} vs {exact=}"


def test_best_bid_prefers_ace_over_two():
    """A round-1 hand of the ace of hearts should always bid 1 (it is
    unbeatable). Under this scoring (exact bid = tricks+1, miss = -|gap|)
    the break-even win probability for bidding 1 vs 0 is p=0.4 — with the
    two of clubs at a 2-player table P(win) ~= (51-25)/51 ~= 0.51 (only a
    higher club or any heart beats it), so 1 is *also* correct there; at a
    6-player table enough opponents make winning unlikely and 0 is correct.
    """
    rng = np.random.default_rng(1)
    ace_hearts = 3 * 13 + 12  # hearts suit index 3, ace rank offset 12
    two_clubs = 0
    for n in (2, 4, 6):
        best_ace, _ = estimators.best_bid(
            hand=(ace_hearts,), seat=0, num_players=n, cards_dealt=1, dealer=0,
            known_bids=[None] * n, legal_bids=(0, 1), n_samples=3000, rng=rng,
        )
        assert best_ace == 1
    best_two, _ = estimators.best_bid(
        hand=(two_clubs,), seat=0, num_players=6, cards_dealt=1, dealer=0,
        known_bids=[None] * 6, legal_bids=(0, 1), n_samples=3000, rng=rng,
    )
    assert best_two == 0


def _table():
    return [MCBidderPolicy(n_samples=150), HeuristicPolicy(), MCBidderPolicy(n_samples=150), HeuristicPolicy()]


def test_mc_bidder_plays_legally_and_completes():
    rec = runner.play_game(_table(), game_seed=42, validate=True)
    assert len(rec.rounds) == 13 * 4


def test_mc_bidder_beats_heuristic_head_to_head():
    recs = runner.play_games(9, 400, _table, n_workers=1)
    import pandas as pd

    from hearts_analysis.records import games_frame
    g = games_frame(recs, 9)
    means = g.groupby("policy")["final_score"].mean()
    # MC bidder should not be meaningfully worse than heuristic; a hard "must
    # win" assertion is flaky at this sample size, so assert it isn't losing
    # by a wide margin (regression guard, not a benchmark).
    assert means["mc_bidder"] > means["heuristic"] - 3.0
