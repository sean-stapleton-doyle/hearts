"""The policy (bot) interface."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np

from .observation import Observation


@runtime_checkable
class Policy(Protocol):
    """A bot for one seat. Stateful per game: ``reset`` is called once per
    game with a runner-spawned RNG, so policies are deterministic given seeds
    and may accumulate per-game state (e.g. a deck tracker)."""

    name: str
    params: dict[str, Any]

    def reset(self, seat: int, num_players: int, rng: np.random.Generator) -> None: ...

    def bid(self, obs: Observation) -> int:
        """Return a bid from ``obs.legal_bids``."""
        ...

    def play(self, obs: Observation) -> int:
        """Return a card int from ``obs.legal_plays``."""
        ...


class BasePolicy:
    """Convenience base handling ``reset`` bookkeeping."""

    name = "base"
    params: dict[str, Any] = {}

    seat: int
    num_players: int
    rng: np.random.Generator

    def reset(self, seat: int, num_players: int, rng: np.random.Generator) -> None:
        self.seat = seat
        self.num_players = num_players
        self.rng = rng
