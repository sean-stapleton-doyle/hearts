"""Counting-policy correctness: memory pools per level, sure-winner play
decisions that differ from the memoryless baseline, bid-channel knowledge
filtering, and full-game legality."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import make_obs

from hearts_analysis import runner
from hearts_analysis.policies import CountingPolicy, HeuristicPolicy
from hearts_analysis.policies.counters import HEARTS, HIGH_CARDS, LEVELS

# Card ints: suit*13 + rank-2; suits C=0 D=1 S=2 H=3.
TWO_CLUBS, A_CLUBS, Q_SPADES = 0, 12, 36
EIGHT_HEARTS, NINE_HEARTS, TEN_HEARTS = 45, 46, 47
J_HEARTS, Q_HEARTS, K_HEARTS, A_HEARTS = 48, 49, 50, 51


def _policy(level: str, use_for=("play",)) -> CountingPolicy:
    p = CountingPolicy(level, use_for=use_for, n_samples=20)
    p.reset(0, 4, np.random.default_rng(0))
    return p


def test_tracked_sets():
    assert len(HEARTS) == 13 and all(c >= 39 for c in HEARTS)
    assert A_CLUBS in HIGH_CARDS and NINE_HEARTS in HIGH_CARDS
    assert Q_SPADES not in HIGH_CARDS and EIGHT_HEARTS not in HIGH_CARDS


def test_invalid_args_rejected():
    with pytest.raises(ValueError, match="unknown level"):
        CountingPolicy("perfect_recall")
    with pytest.raises(ValueError, match="use_for"):
        CountingPolicy("hearts_exact", use_for=())
    with pytest.raises(ValueError, match="use_for"):
        CountingPolicy("hearts_exact", use_for=("bid", "vibes"))


def test_possible_unseen_per_level():
    # Trick 1 saw K♥ and A♣ played; I hold 2♣; Q♠ is on the table now.
    obs = make_obs(
        cards_this_round=7, round_index=7, hand=(TWO_CLUBS,),
        round_tricks=((1, ((1, K_HEARTS), (2, A_CLUBS), (3, 20), (0, 21))),),
        current_trick=((1, Q_SPADES),), led_suit=2,
    )
    exact = _policy("hearts_exact")._possible_unseen(obs)
    high = _policy("high_cards")._possible_unseen(obs)
    count = _policy("hearts_count")._possible_unseen(obs)

    for pool in (exact, high, count):
        assert TWO_CLUBS not in pool and Q_SPADES not in pool  # visible now
    assert K_HEARTS not in exact and A_CLUBS in exact  # only hearts remembered
    assert K_HEARTS not in high and A_CLUBS not in high  # both are high cards
    assert K_HEARTS in count and A_CLUBS in count  # count-only keeps neither


def test_hearts_count_infers_exhaustion():
    # 11 hearts played, I hold the other 2 -> no opponent can hold a heart.
    played_hearts = tuple(c for c in sorted(HEARTS) if c not in (K_HEARTS, A_HEARTS))
    tricks = tuple(
        (0, tuple((s % 4, c) for s, c in enumerate(played_hearts[i:i + 4], start=i)))
        for i in range(0, 8, 4)
    )
    last = (0, tuple((s % 4, c) for s, c in enumerate(played_hearts[8:], start=8)))
    obs = make_obs(
        cards_this_round=7, round_index=7, hand=(K_HEARTS, A_HEARTS),
        round_tricks=(*tricks, last),
    )
    pool = _policy("hearts_count")._possible_unseen(obs)
    assert not pool & HEARTS


def test_lead_prefers_cheapest_sure_winner():
    # Holding A♥+K♥: nothing unseen beats K♥ (the only higher heart is in
    # hand), so the counter leads K♥ and saves the ace; the memoryless
    # heuristic leads its strongest card, A♥.
    obs = make_obs(
        cards_this_round=7, round_index=7, bids=(2, 1, 1, 2), tricks_won=(0, 0, 0, 0),
        hand=(A_HEARTS, K_HEARTS, TWO_CLUBS), legal_plays=(A_HEARTS, K_HEARTS, TWO_CLUBS),
    )
    assert _policy("hearts_exact").play(obs) == K_HEARTS
    assert HeuristicPolicy().play(obs) == A_HEARTS


def test_lead_sure_winner_depends_on_memory_level():
    # K♥ already played. hearts_exact knows Q♥ is now sure (A♥ in hand);
    # hearts_count still fears K♥, so only A♥ is sure.
    obs = make_obs(
        cards_this_round=7, round_index=7, bids=(2, 1, 1, 2),
        hand=(A_HEARTS, Q_HEARTS, TWO_CLUBS), legal_plays=(A_HEARTS, Q_HEARTS, TWO_CLUBS),
        round_tricks=((1, ((1, K_HEARTS), (2, 20), (3, 21), (0, 22))),),
    )
    assert _policy("hearts_exact").play(obs) == Q_HEARTS
    assert _policy("hearts_count").play(obs) == A_HEARTS


def test_follow_prefers_sure_winner_when_not_last():
    # 5♥ led; I hold A♥ and 9♥, J/Q/K♥ already played but 10♥ is not:
    # 9♥ could be overtaken, A♥ cannot — take the sure trick. The baseline
    # hopes with the cheapest winner, 9♥.
    obs = make_obs(
        cards_this_round=7, round_index=7, bids=(2, 1, 1, 2),
        hand=(A_HEARTS, NINE_HEARTS), legal_plays=(A_HEARTS, NINE_HEARTS),
        current_trick=((1, 42),), led_suit=3,
        round_tricks=((1, ((1, J_HEARTS), (2, Q_HEARTS), (3, K_HEARTS), (0, 22))),),
    )
    assert _policy("hearts_exact").play(obs) == A_HEARTS
    assert HeuristicPolicy().play(obs) == NINE_HEARTS


def test_follow_last_to_play_takes_cheapest_winner():
    # Same as above but I'm the 4th player: nothing can overtake, so the
    # counter agrees with the baseline's cheapest winner.
    obs = make_obs(
        cards_this_round=7, round_index=7, bids=(2, 1, 1, 2),
        hand=(A_HEARTS, NINE_HEARTS), legal_plays=(A_HEARTS, NINE_HEARTS),
        current_trick=((1, 42), (2, 40), (3, 41)), led_suit=3,
        round_tricks=((1, ((1, J_HEARTS), (2, Q_HEARTS), (3, K_HEARTS), (0, 22))),),
    )
    assert _policy("hearts_exact").play(obs) == NINE_HEARTS


def test_known_opponents_filtered_to_tracked_set():
    deal = [
        [None, None],  # my seat
        [A_HEARTS, A_CLUBS],
        [Q_SPADES, None],
        [EIGHT_HEARTS, 20],
    ]
    obs = make_obs(seat=0, cards_this_round=2, round_index=2)
    for level, expected in [
        ("hearts_exact", {1: (A_HEARTS,), 3: (EIGHT_HEARTS,)}),
        ("high_cards", {1: (A_HEARTS, A_CLUBS)}),
        ("hearts_count", {}),
    ]:
        p = _policy(level, use_for=("bid",))
        p._current_deal = deal
        assert p._known_opponents(obs) == expected


@pytest.mark.parametrize("level", LEVELS)
def test_play_channel_full_game_legality(level):
    table = [CountingPolicy(level, use_for=("play",))] + [HeuristicPolicy() for _ in range(3)]
    rec = runner.play_game(table, game_seed=19, validate=True)
    assert len(rec.rounds) == 13 * 4


def test_bid_channel_full_game_legality():
    table = [CountingPolicy("hearts_exact", use_for=("bid", "play"), n_samples=20),
             HeuristicPolicy()]
    rec = runner.play_game(table, game_seed=23, validate=True)
    assert len(rec.rounds) == 13 * 2


def test_p_survives_hypergeometric():
    p = _policy("full")
    pool = set(range(20))  # 20 unseen cards
    # A♥ has no threats anywhere.
    assert p._p_survives(A_HEARTS, 3, pool, m=10) == 1.0
    # One threat (A♥) in a 21-card pool, 10 unknown opponent cards:
    # P = C(20,10)/C(21,10) = 11/21.
    pool_with_threat = pool | {A_HEARTS}
    assert p._p_survives(K_HEARTS, 3, pool_with_threat, m=10) == pytest.approx(11 / 21)
    # 1 threat in a 2-card pool, 1 draw -> 1/2.
    assert p._p_survives(K_HEARTS, 3, {A_HEARTS, TWO_CLUBS}, m=1) == pytest.approx(0.5)
    # More unknown opponent cards than safe cards -> certain loss.
    assert p._p_survives(K_HEARTS, 3, {A_HEARTS}, m=1) == 0.0


def test_confidence_is_monotone_in_memory():
    # Coarser memory (bigger pool) can never be *more* confident.
    obs = make_obs(
        cards_this_round=7, round_index=7, bids=(2, 1, 1, 2),
        hand=(A_HEARTS, Q_HEARTS, TWO_CLUBS),
        round_tricks=((1, ((1, K_HEARTS), (2, 20), (3, 21), (0, 22))),),
    )
    exact_pool = _policy("hearts_exact")._possible_unseen(obs)
    count_pool = _policy("hearts_count")._possible_unseen(obs)
    assert exact_pool <= count_pool
    p = _policy("full")
    for card in (A_HEARTS, Q_HEARTS, TWO_CLUBS):
        assert (p._p_survives(card, 3, exact_pool, 6)
                >= p._p_survives(card, 3, count_pool, 6))
