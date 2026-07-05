"""A family of linear feature-based bidders.

Each policy bids the nearest legal bid to ``dot(weights, hand_features) +
bias`` and plays with the standard :class:`HeuristicPolicy` play logic, so
head-to-head differences between family members are attributable to bidding
alone. ``PRESETS`` names the hypotheses under test (bid your hearts; hearts
plus high cards; penalize face cards; the tuned heuristic weights for
continuity with notebooks 01–03), and :func:`grid` spans a coarse weight
sweep around them.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ..cards import TRUMP, rank_of, suit_of
from ..observation import Observation
from ..policy import BasePolicy
from .heuristic import HeuristicPolicy

#: Feature names, in a fixed order. ``n_offsuit_high`` = off-suit aces +
#: kings; ``n_face`` = jacks/queens/kings of any suit (the "face cards" of
#: the user-facing hypothesis — note off-suit J/Q can never win a trick).
FEATURES = (
    "n_hearts",
    "n_high_hearts",  # hearts ranked 9+ (subset of n_hearts)
    "n_offsuit_ace",
    "n_offsuit_king",
    "n_offsuit_high",  # = n_offsuit_ace + n_offsuit_king
    "n_face",  # J/Q/K of any suit
)


def hand_features(hand: tuple[int, ...]) -> dict[str, int]:
    f = dict.fromkeys(FEATURES, 0)
    for c in hand:
        rank = rank_of(c)
        if suit_of(c) == TRUMP:
            f["n_hearts"] += 1
            if rank >= 9:
                f["n_high_hearts"] += 1
        elif rank == 14:
            f["n_offsuit_ace"] += 1
            f["n_offsuit_high"] += 1
        elif rank == 13:
            f["n_offsuit_king"] += 1
            f["n_offsuit_high"] += 1
        if rank in (11, 12, 13):
            f["n_face"] += 1
    return f


#: Named bidding hypotheses. ``tuned`` reproduces ``HeuristicPolicy``'s
#: default estimate exactly: 1.0·high_heart + 0.55·low_heart ≡
#: 0.55·n_hearts + 0.45·n_high_hearts.
PRESETS: dict[str, dict[str, float]] = {
    "hearts_only": {"n_hearts": 1.0},
    "hearts_high": {"n_hearts": 1.0, "n_offsuit_high": 0.5},
    "hearts_high_minus_face": {"n_hearts": 1.0, "n_offsuit_high": 0.5, "n_face": -0.25},
    "tuned": {
        "n_hearts": 0.55, "n_high_hearts": 0.45,
        "n_offsuit_ace": 0.7, "n_offsuit_king": 0.35,
    },
}


def grid() -> dict[str, dict[str, float]]:
    """A coarse 18-point sweep over the three load-bearing weights."""
    out: dict[str, dict[str, float]] = {}
    for wh in (0.4, 0.7, 1.0):
        for whh in (0.0, 0.45):
            for wo in (0.0, 0.35, 0.7):
                out[f"g_h{wh}_hh{whh}_o{wo}"] = {
                    "n_hearts": wh, "n_high_hearts": whh, "n_offsuit_high": wo,
                }
    return out


class FeatureBidderPolicy(BasePolicy):
    def __init__(
        self,
        weights: dict[str, float] | None = None,
        bias: float = 0.0,
        label: str | None = None,
    ) -> None:
        if weights is None:
            weights, label = PRESETS["tuned"], label or "tuned"
        unknown = set(weights) - set(FEATURES)
        if unknown:
            raise ValueError(f"unknown features: {sorted(unknown)}")
        self.weights = dict(weights)
        self.bias = bias
        self.name = f"fb:{label}" if label else "feature_bidder"
        self.params: dict[str, Any] = {"weights": self.weights, "bias": bias}
        self._play_policy = HeuristicPolicy()

    def reset(self, seat: int, num_players: int, rng: np.random.Generator) -> None:
        super().reset(seat, num_players, rng)
        self._play_policy.reset(seat, num_players, rng)

    def estimate_tricks(self, hand: tuple[int, ...]) -> float:
        f = hand_features(hand)
        return sum(w * f[k] for k, w in self.weights.items()) + self.bias

    def bid(self, obs: Observation) -> int:
        est = self.estimate_tricks(obs.hand)
        # Same tie-break-down rule as HeuristicPolicy.bid.
        return min(obs.legal_bids, key=lambda b: (abs(b - est), b))

    def play(self, obs: Observation) -> int:
        return self._play_policy.play(obs)


def make_preset(name: str) -> FeatureBidderPolicy:
    return FeatureBidderPolicy(PRESETS[name], label=name)
