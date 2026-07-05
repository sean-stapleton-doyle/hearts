"""Observations expose exactly the acting seat's legal information."""

import numpy as np

from hearts_analysis import runner
from hearts_analysis.observation import Observation
from hearts_analysis.policies import RandomPolicy


class SpyPolicy(RandomPolicy):
    """Records every observation it acts on."""

    name = "spy"

    def __init__(self, log: list):
        self.log = log

    def bid(self, obs: Observation) -> int:
        self.log.append(obs)
        return super().bid(obs)

    def play(self, obs: Observation) -> int:
        self.log.append(obs)
        return super().play(obs)


def run_spied_game(seed=5, n=4):
    log: list[Observation] = []
    runner.play_game([SpyPolicy(log) for _ in range(n)], game_seed=seed, validate=True)
    return log


def test_observation_invariants():
    log = run_spied_game()
    assert log, "no observations recorded"
    for obs in log:
        if obs.is_bidding:
            assert obs.legal_plays == () and obs.current_trick == ()
            assert obs.bids[obs.seat] is None
            assert all(b <= obs.cards_this_round for b in obs.legal_bids)
            if obs.forbidden_bid is not None:
                assert obs.my_bid_position == obs.num_players - 1
                assert obs.forbidden_bid not in obs.legal_bids
        else:
            assert obs.legal_bids == ()
            assert set(obs.legal_plays) <= set(obs.hand)
            assert None not in obs.bids
            # A seat never appears twice in the current trick, and we are not in it.
            seats_in_trick = [s for s, _ in obs.current_trick]
            assert len(set(seats_in_trick)) == len(seats_in_trick)
            assert obs.seat not in seats_in_trick
        assert len(obs.game_log) == obs.round_index - 1
        assert sum(obs.tricks_won) == len(obs.round_tricks)


def test_no_hidden_information_leaks():
    """Within a round, a hand is disjoint from the cards already played this
    round. (Across rounds overlap is expected — the deck recycles played
    cards, which is exactly what the deck-tracking analysis exploits.)"""
    log = run_spied_game(seed=17)
    for obs in log:
        played_this_round = {c for _, plays in obs.round_tricks for _, c in plays}
        played_this_round |= {c for _, c in obs.current_trick}
        assert not (set(obs.hand) & played_this_round)
        # a full deal never contains duplicate cards
        assert len(set(obs.hand)) == len(obs.hand)


def test_game_log_is_complete_public_history():
    log = run_spied_game(seed=23)
    final = max(log, key=lambda o: o.round_index)
    assert final.round_index == 13
    # Every completed round's log holds cards_dealt tricks of num_players plays.
    for rl in final.game_log:
        for leader, plays in rl.tricks:
            assert len(plays) == final.num_players
            assert plays[0][0] == leader


def test_policy_rngs_are_deterministic_and_distinct():
    from hearts_analysis import seeds

    child = np.random.SeedSequence(42)
    rngs_a = seeds.policy_rngs(np.random.SeedSequence(42), 4)
    rngs_b = seeds.policy_rngs(np.random.SeedSequence(42), 4)
    draws_a = [r.integers(1 << 30) for r in rngs_a]
    draws_b = [r.integers(1 << 30) for r in rngs_b]
    assert draws_a == draws_b
    assert len(set(draws_a)) > 1
