"""A bot that bids from a Monte Carlo trick-distribution estimate and plays
like `HeuristicPolicy` (bid-aware) once a bid is locked in."""

from __future__ import annotations

from typing import Any

from .. import estimators
from ..observation import Observation
from ..policy import BasePolicy
from .heuristic import HeuristicPolicy


class MCBidderPolicy(BasePolicy):
    name = "mc_bidder"

    def __init__(self, n_samples: int = 600) -> None:
        self.n_samples = n_samples
        self.params: dict[str, Any] = {"n_samples": n_samples}
        self._play_policy = HeuristicPolicy()

    def bid(self, obs: Observation) -> int:
        if len(obs.legal_bids) == 1:
            return obs.legal_bids[0]
        best, _ = estimators.best_bid(
            hand=obs.hand, seat=obs.seat, num_players=obs.num_players,
            cards_dealt=obs.cards_this_round, dealer=obs.dealer,
            known_bids=obs.bids, legal_bids=obs.legal_bids,
            n_samples=self.n_samples, rng=self.rng,
        )
        return best

    def play(self, obs: Observation) -> int:
        return self._play_policy.play(obs)
