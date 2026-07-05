"""A bot that maintains a `DeckModel` from public history and feeds any
foreseen opponent cards into its bidding estimate — the same MC estimator as
`MCBidderPolicy`, but with a sharper opponent-hand prior wherever the
never-reshuffled deck lets one be derived. Its edge over `MCBidderPolicy` is
attributable entirely to this: play logic is identical (`HeuristicPolicy`),
and both use the same estimator and sample count."""

from __future__ import annotations

from typing import Any

from .. import estimators
from ..deck_model import DeckModel
from ..observation import Observation
from ..policy import BasePolicy
from .heuristic import HeuristicPolicy


class DeckTrackerPolicy(BasePolicy):
    name = "deck_tracker"

    def __init__(self, n_samples: int = 600) -> None:
        self.n_samples = n_samples
        self.params: dict[str, Any] = {"n_samples": n_samples}
        self._play_policy = HeuristicPolicy()

    def reset(self, seat, num_players, rng) -> None:
        super().reset(seat, num_players, rng)
        self._deck = DeckModel(num_players)
        self._replayed = 0
        self._dealt_round = 0
        self._current_deal: list[list[int | None]] | None = None

    def _sync_deck(self, obs: Observation) -> None:
        while self._replayed < len(obs.game_log):
            self._deck.resolve_round(obs.game_log[self._replayed].tricks)
            self._replayed += 1
        if self._dealt_round < obs.round_index:
            # `deal_round` mutates the deque (pops this round's front), so
            # its return value — the prediction for *this* round — must be
            # cached now; calling `predict_deal` again later would silently
            # read the now-advanced front (i.e. leak into next round).
            self._current_deal = self._deck.deal_round(obs.round_index, obs.dealer)
            self._dealt_round = obs.round_index
        for c in obs.hand:
            self._deck.reveal(c)

    def _known_opponents(self, obs: Observation) -> dict[int, tuple[int, ...]]:
        assert self._current_deal is not None
        known: dict[int, tuple[int, ...]] = {}
        for seat, cells in enumerate(self._current_deal):
            if seat == obs.seat:
                continue
            revealed = tuple(c for c in cells if c is not None)
            if revealed:
                known[seat] = revealed
        return known

    def bid(self, obs: Observation) -> int:
        self._sync_deck(obs)
        if len(obs.legal_bids) == 1:
            return obs.legal_bids[0]
        known_opponents = self._known_opponents(obs)
        best, _ = estimators.best_bid(
            hand=obs.hand, seat=obs.seat, num_players=obs.num_players,
            cards_dealt=obs.cards_this_round, dealer=obs.dealer,
            known_bids=obs.bids, legal_bids=obs.legal_bids,
            n_samples=self.n_samples, rng=self.rng,
            known_opponent_cards=known_opponents,
        )
        return best

    def play(self, obs: Observation) -> int:
        self._sync_deck(obs)
        return self._play_policy.play(obs)
