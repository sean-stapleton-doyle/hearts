"""A simple rule-based bot.

Bid: estimate expected tricks from hand strength — hearts are trump so every
heart is a candidate trick; off-suit aces/kings count fractionally — then take
the nearest legal bid. Play: while under bid, try to win cheaply; once the bid
is met, shed the most dangerous cards while losing.
"""

from __future__ import annotations

from typing import Any

from ..cards import TRUMP, beats, rank_of, suit_of, winning_play
from ..observation import Observation
from ..policy import BasePolicy


class HeuristicPolicy(BasePolicy):
    name = "heuristic"

    def __init__(
        self,
        heart_high: float = 1.0,   # weight of a heart 9+
        heart_low: float = 0.55,   # weight of a heart 2-8
        offsuit_ace: float = 0.7,
        offsuit_king: float = 0.35,
    ) -> None:
        self.params: dict[str, Any] = {
            "heart_high": heart_high, "heart_low": heart_low,
            "offsuit_ace": offsuit_ace, "offsuit_king": offsuit_king,
        }

    def estimate_tricks(self, hand: tuple[int, ...]) -> float:
        p = self.params
        est = 0.0
        for c in hand:
            rank = rank_of(c)
            if suit_of(c) == TRUMP:
                est += p["heart_high"] if rank >= 9 else p["heart_low"]
            elif rank == 14:
                est += p["offsuit_ace"]
            elif rank == 13:
                est += p["offsuit_king"]
        return est

    def bid(self, obs: Observation) -> int:
        est = self.estimate_tricks(obs.hand)
        # Nearest legal bid; ties resolved downward (underbidding is the
        # cheaper miss: -gap either way, but fewer tricks to chase).
        return min(obs.legal_bids, key=lambda b: (abs(b - est), b))

    def play(self, obs: Observation) -> int:
        legal = obs.legal_plays
        if len(legal) == 1:
            return legal[0]
        want_trick = obs.my_tricks < (obs.my_bid or 0)

        if not obs.current_trick:  # leading
            if want_trick:
                # Lead our strongest card: best heart, else best off-suit.
                return max(legal, key=lambda c: (suit_of(c) == TRUMP, rank_of(c)))
            # Lead our weakest non-trump if possible.
            return min(legal, key=lambda c: (suit_of(c) == TRUMP, rank_of(c)))

        led = obs.led_suit
        assert led is not None
        _, best_card = winning_play(obs.current_trick, led)
        winners = [c for c in legal if beats(c, best_card, led)]
        if want_trick and winners:
            return min(winners, key=rank_of)  # win as cheaply as possible
        losers = [c for c in legal if not beats(c, best_card, led)]
        if losers:
            # Shed the most dangerous loser (highest rank, hearts first).
            return max(losers, key=lambda c: (suit_of(c) == TRUMP, rank_of(c)))
        # Forced to win: do it as cheaply as possible.
        return min(legal, key=rank_of)
