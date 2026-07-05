"""Shared test helpers."""

from __future__ import annotations

from hearts_analysis.observation import Observation

_OBS_DEFAULTS = dict(
    seat=0, num_players=4, round_index=1, cards_this_round=1, dealer=0,
    scores=(0, 0, 0, 0), bids=(None, None, None, None), my_bid_position=0,
    forbidden_bid=None, legal_bids=(), hand=(), legal_plays=(),
    current_trick=(), led_suit=None, tricks_won=(0, 0, 0, 0),
    round_tricks=(), game_log=(),
)


def make_obs(**overrides) -> Observation:
    """An Observation with sensible defaults, for unit-testing policies on
    constructed decision points."""
    return Observation(**{**_OBS_DEFAULTS, **overrides})
