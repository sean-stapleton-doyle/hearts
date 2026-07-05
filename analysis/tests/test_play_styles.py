"""Style choosers pick the documented card; StyledPlayPolicy dispatches
lead vs follow; PhasedPolicy switches at the right boundaries; everything
plays full games legally."""

from __future__ import annotations

import pytest
from conftest import make_obs

from hearts_analysis import runner
from hearts_analysis.policies import HeuristicPolicy, PhasedPolicy, StyledPlayPolicy
from hearts_analysis.policies.play_styles import ROUND_BUCKETS, STYLES
from hearts_analysis.policy import BasePolicy

# Card ints: suit*13 + rank-2; suits C=0 D=1 S=2 H=3.
NINE_CLUBS, A_SPADES, TWO_HEARTS, K_HEARTS = 7, 38, 39, 50
LEGAL = (NINE_CLUBS, A_SPADES, TWO_HEARTS, K_HEARTS)


def test_style_choosers():
    assert STYLES["hearts_first"](LEGAL) == K_HEARTS  # highest heart
    assert STYLES["high_first"](LEGAL) == A_SPADES  # highest rank overall
    assert STYLES["low_first"](LEGAL) == TWO_HEARTS  # lowest rank overall


def test_low_first_prefers_non_trump_on_rank_tie():
    two_clubs = 0
    assert STYLES["low_first"]((two_clubs, TWO_HEARTS)) == two_clubs


def test_lead_vs_follow_dispatch():
    p = StyledPlayPolicy(lead_style="high_first", follow_style="low_first")
    leading = make_obs(cards_this_round=7, round_index=7, legal_plays=LEGAL)
    following = make_obs(
        cards_this_round=7, round_index=7, legal_plays=LEGAL,
        current_trick=((1, 20),), led_suit=1,
    )
    assert p.play(leading) == A_SPADES
    assert p.play(following) == TWO_HEARTS
    assert p.name == "style:high_first/low_first"


def test_unknown_style_rejected():
    with pytest.raises(ValueError, match="unknown style"):
        StyledPlayPolicy(lead_style="chaotic")


class _Stub(BasePolicy):
    """Records which decisions were routed here."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: list[tuple[str, int]] = []

    def bid(self, obs):
        self.calls.append(("bid", obs.round_index))
        return obs.legal_bids[0]

    def play(self, obs):
        self.calls.append(("play", obs.round_index))
        return obs.legal_plays[0]


def test_phased_round_boundary_dispatch():
    early, mid, late = _Stub("e"), _Stub("m"), _Stub("l")
    p = PhasedPolicy(early, mid, late, boundary="round")
    for round_index, target in [(1, early), (4, early), (5, mid), (9, mid), (10, late), (13, late)]:
        obs = make_obs(round_index=round_index, legal_bids=(0, 1), legal_plays=LEGAL)
        p.bid(obs)
        p.play(obs)
        assert target.calls[-2:] == [("bid", round_index), ("play", round_index)]
    assert ROUND_BUCKETS == ((1, 4), (5, 9), (10, 13))


def test_phased_trick_boundary_dispatch():
    early, mid, late, bidder = _Stub("e"), _Stub("m"), _Stub("l"), _Stub("b")
    p = PhasedPolicy(early, mid, late, boundary="trick", bidder=bidder)
    # 7-card round, thirds of completed-trick fraction: 0-2 done -> early
    # (2/7 < 1/3), 3-4 -> mid (4/7 < 2/3), 5-6 -> late.
    fake_trick = (0, ((0, 1), (1, 2), (2, 3), (3, 4)))
    for n_done, target in [(0, early), (2, early), (3, mid), (4, mid), (5, late), (6, late)]:
        obs = make_obs(
            round_index=7, cards_this_round=7, legal_plays=LEGAL,
            round_tricks=(fake_trick,) * n_done,
        )
        p.play(obs)
        assert target.calls[-1] == ("play", 7)
    bid_obs = make_obs(round_index=7, cards_this_round=7, legal_bids=(0, 1, 2))
    p.bid(bid_obs)
    assert bidder.calls == [("bid", 7)]


def test_one_card_round_uses_early_phase_at_trick_boundary():
    early, mid, late = _Stub("e"), _Stub("m"), _Stub("l")
    p = PhasedPolicy(early, mid, late, boundary="trick")
    obs = make_obs(round_index=1, cards_this_round=1, legal_plays=(5,))
    p.play(obs)
    assert early.calls == [("play", 1)]


def test_invalid_boundary_rejected():
    with pytest.raises(ValueError, match="boundary"):
        PhasedPolicy(_Stub("e"), _Stub("m"), _Stub("l"), boundary="epoch")


@pytest.mark.parametrize("style", ["hearts_first", "high_first", "low_first", "adaptive"])
def test_styles_play_full_games_legally(style):
    table = [StyledPlayPolicy(style)] + [HeuristicPolicy() for _ in range(3)]
    rec = runner.play_game(table, game_seed=11, validate=True)
    assert len(rec.rounds) == 13 * 4


def test_phased_plays_full_games_legally():
    def phased():
        return PhasedPolicy(
            StyledPlayPolicy("low_first"), StyledPlayPolicy("adaptive"),
            StyledPlayPolicy("hearts_first"), boundary="round",
        )

    table = [phased(), phased(), HeuristicPolicy(), HeuristicPolicy()]
    rec = runner.play_game(table, game_seed=13, validate=True)
    assert len(rec.rounds) == 13 * 4

    def phased_trick():
        return PhasedPolicy(
            StyledPlayPolicy("low_first"), StyledPlayPolicy("adaptive"),
            StyledPlayPolicy("hearts_first"), boundary="trick",
        )

    table = [phased_trick(), phased_trick(), HeuristicPolicy(), HeuristicPolicy()]
    rec = runner.play_game(table, game_seed=17, validate=True)
    assert len(rec.rounds) == 13 * 4
