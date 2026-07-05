"""Every policy action is legal across fuzzed games (the engine raises
GameError on any illegal submission, and validate mode cross-checks the
option sets, so completing games is itself the assertion)."""

import pytest

from hearts_analysis import runner
from hearts_analysis.policies import HeuristicPolicy, RandomPolicy


@pytest.mark.parametrize("seed", range(10))
@pytest.mark.parametrize("n_players", [2, 4, 7])
def test_policies_always_act_legally(seed, n_players):
    policies = [
        HeuristicPolicy() if i % 2 == 0 else RandomPolicy() for i in range(n_players)
    ]
    rec = runner.play_game(policies, game_seed=seed, validate=True)
    assert len(rec.rounds) == 13 * n_players


def test_heuristic_handles_forbidden_bid():
    # The heuristic must pick a legal bid even when its estimate is forbidden.
    h = HeuristicPolicy()
    from hearts_analysis.observation import Observation

    obs = Observation(
        seat=0, num_players=4, round_index=7, cards_this_round=7, dealer=1,
        scores=(0, 0, 0, 0), bids=(None, 2, 1, 1), my_bid_position=3,
        forbidden_bid=3, legal_bids=(0, 1, 2, 4, 5, 6, 7),
        hand=(39, 40, 41, 12, 25, 38, 24), legal_plays=(), current_trick=(),
        led_suit=None, tricks_won=(0, 0, 0, 0), round_tricks=(), game_log=(),
    )
    assert h.bid(obs) in obs.legal_bids
