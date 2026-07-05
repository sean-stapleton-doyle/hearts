"""Play-style policy family: fixed card-ordering rules for leading and
following, plus a phase-switching wrapper.

All styles bid with :class:`HeuristicPolicy` so head-to-head differences are
attributable to play alone (mirror image of ``feature_bidder``, which fixes
play and varies bidding). ``adaptive`` is the existing want-trick-conditioned
``HeuristicPolicy.play`` and serves as the baseline; the fixed styles ignore
the bid entirely.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import numpy as np

from ..cards import is_trump, rank_of
from ..observation import Observation
from ..policy import BasePolicy, Policy
from .heuristic import HeuristicPolicy


def _hearts_first(legal: Sequence[int]) -> int:
    """Shed trump as early as possible, highest heart first; without a
    heart, play the highest card held."""
    return max(legal, key=lambda c: (is_trump(c), rank_of(c)))


def _high_first(legal: Sequence[int]) -> int:
    """Always play the highest rank (hearts break rank ties upward)."""
    return max(legal, key=lambda c: (rank_of(c), is_trump(c)))


def _low_first(legal: Sequence[int]) -> int:
    """Always play the lowest rank (non-hearts break rank ties downward)."""
    return min(legal, key=lambda c: (rank_of(c), is_trump(c)))


#: name -> chooser over the legal plays; ``adaptive`` is handled separately.
STYLES: dict[str, Callable[[Sequence[int]], int]] = {
    "hearts_first": _hearts_first,
    "high_first": _high_first,
    "low_first": _low_first,
}
STYLE_NAMES = (*STYLES, "adaptive")


class StyledPlayPolicy(BasePolicy):
    """Bids like ``HeuristicPolicy``; plays by fixed style. ``follow_style``
    defaults to ``lead_style``."""

    def __init__(self, lead_style: str = "adaptive", follow_style: str | None = None) -> None:
        follow_style = follow_style or lead_style
        for style in (lead_style, follow_style):
            if style not in STYLE_NAMES:
                raise ValueError(f"unknown style {style!r}; expected one of {STYLE_NAMES}")
        self.lead_style = lead_style
        self.follow_style = follow_style
        self.name = (
            f"style:{lead_style}" if follow_style == lead_style
            else f"style:{lead_style}/{follow_style}"
        )
        self.params: dict[str, Any] = {"lead_style": lead_style, "follow_style": follow_style}
        self._heuristic = HeuristicPolicy()

    def reset(self, seat: int, num_players: int, rng: np.random.Generator) -> None:
        super().reset(seat, num_players, rng)
        self._heuristic.reset(seat, num_players, rng)

    def bid(self, obs: Observation) -> int:
        return self._heuristic.bid(obs)

    def play(self, obs: Observation) -> int:
        style = self.lead_style if not obs.current_trick else self.follow_style
        if style == "adaptive":
            return self._heuristic.play(obs)
        return STYLES[style](obs.legal_plays)


#: Game-level phases over the 1→7→1 card ramp (1-based round indices).
ROUND_BUCKETS = ((1, 4), (5, 9), (10, 13))


class PhasedPolicy(BasePolicy):
    """Switches between three sub-policies by phase.

    ``boundary="round"``: phase = position in the 13-round game
    (``ROUND_BUCKETS``); bids and plays both come from the active phase's
    policy. ``boundary="trick"``: phase = thirds of the current round's
    tricks; bids come from a dedicated ``bidder`` (HeuristicPolicy by
    default) since bidding precedes every trick.
    """

    def __init__(
        self,
        early: Policy,
        mid: Policy,
        late: Policy,
        boundary: str = "round",
        bidder: Policy | None = None,
        label: str | None = None,
    ) -> None:
        if boundary not in ("round", "trick"):
            raise ValueError(f"boundary must be 'round' or 'trick', got {boundary!r}")
        self._phases = (early, mid, late)
        self.boundary = boundary
        self._bidder = bidder or HeuristicPolicy()
        self.name = label or f"phased:{boundary}:{early.name}|{mid.name}|{late.name}"
        self.params: dict[str, Any] = {
            "boundary": boundary, "phases": tuple(p.name for p in self._phases),
        }

    def reset(self, seat: int, num_players: int, rng: np.random.Generator) -> None:
        super().reset(seat, num_players, rng)
        for p in (*self._phases, self._bidder):
            p.reset(seat, num_players, rng)

    def _phase(self, obs: Observation) -> Policy:
        if self.boundary == "round":
            for policy, (lo, hi) in zip(self._phases, ROUND_BUCKETS):
                if lo <= obs.round_index <= hi:
                    return policy
            raise ValueError(f"round_index {obs.round_index} outside {ROUND_BUCKETS}")
        frac = len(obs.round_tricks) / obs.cards_this_round
        return self._phases[0 if frac < 1 / 3 else 1 if frac < 2 / 3 else 2]

    def bid(self, obs: Observation) -> int:
        if self.boundary == "round":
            return self._phase(obs).bid(obs)
        return self._bidder.bid(obs)

    def play(self, obs: Observation) -> int:
        return self._phase(obs).play(obs)
