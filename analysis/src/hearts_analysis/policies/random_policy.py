"""Uniformly random legal actions — the noise floor for comparisons."""

from __future__ import annotations

from ..observation import Observation
from ..policy import BasePolicy


class RandomPolicy(BasePolicy):
    name = "random"

    def bid(self, obs: Observation) -> int:
        return int(self.rng.choice(obs.legal_bids))

    def play(self, obs: Observation) -> int:
        return int(self.rng.choice(obs.legal_plays))
