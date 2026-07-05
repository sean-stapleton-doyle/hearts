"""Reconstructs which of the 52 physical deck positions are publicly known,
mirroring the engine's deal-from-top / return-to-bottom-in-play-order
mechanics exactly (`crates/hearts-core/src/game.rs::deal`, `finish_round`).

The deck is shuffled **once**, at the start of the game, and never again.
Every card dealt in a round is played by someone before the round ends (a
round plays out exactly ``cards_dealt`` tricks, and every seat plays exactly
one card per trick), so by the time a round completes, the full set of cards
dealt that round is public — and they return to the *bottom* of the deck in
exact play order. That means part of the deck's future content can become
knowable **before it is dealt**: once enough rounds have recycled, the front
of the deque may already hold cards whose identity is public, and the
deterministic dealing order tells us exactly which seat each such card will
go to.

This needs no knowledge of the original shuffle — only what has been
publicly observed (own hand + every play), which is exactly the ``game_log``
carried on every `Observation`. It never touches `pyhearts.Game.deck()`.
"""

from __future__ import annotations

import pyhearts

from . import cards
from .observation import GameLog, TrickRecord

#: A deck cell: a known card int, or ``None`` for a still-unresolved
#: original-shuffle card.
Cell = int | None


class DeckModel:
    """Positional deck-tracking state, built purely from public history."""

    def __init__(self, num_players: int) -> None:
        self.num_players = num_players
        self.deque: list[Cell] = [None] * cards.NUM_CARDS
        self._known: set[int] = set()

    def unseen_pool(self) -> frozenset[int]:
        """Cards not yet observed anywhere (own hand or any play)."""
        return frozenset(range(cards.NUM_CARDS)) - self._known

    def reveal(self, card: int) -> None:
        """Mark a card as observed immediately (own hand, or a play) even
        before its round finishes, so `unseen_pool` stays live mid-round."""
        self._known.add(card)

    @staticmethod
    def _deal_order(dealer: int, num_players: int) -> list[int]:
        """One dealing pass: dealer's left first, dealer last (game.rs::deal:
        `dealer.offset(by, num_players)` for `by` in `1..=num_players`)."""
        return [(dealer + by) % num_players for by in range(1, num_players + 1)]

    def predict_deal(self, round_index: int, dealer: int) -> list[list[Cell]]:
        """What can be foreseen about the upcoming deal for ``round_index``,
        without mutating state: ``hands[seat]`` has one entry per card that
        seat will receive, each either a known card int or ``None``."""
        n = self.num_players
        d = pyhearts.cards_for_round(round_index)
        order = self._deal_order(dealer, n)
        front = self.deque[: d * n]
        hands: list[list[Cell]] = [[] for _ in range(n)]
        for k, cell in enumerate(front):
            hands[order[k % n]].append(cell)
        return hands

    def deal_round(self, round_index: int, dealer: int) -> list[list[Cell]]:
        """Consume the front of the deque for this round's deal (mirrors
        `Game::deal`) and return the same per-seat prediction."""
        n = self.num_players
        d = pyhearts.cards_for_round(round_index)
        front, self.deque = self.deque[: d * n], self.deque[d * n :]
        order = self._deal_order(dealer, n)
        hands: list[list[Cell]] = [[] for _ in range(n)]
        for k, cell in enumerate(front):
            hands[order[k % n]].append(cell)
        return hands

    def resolve_round(self, tricks: tuple[TrickRecord, ...]) -> None:
        """After a round completes, push every played card onto the deck
        bottom in exact play order (mirrors `Game::finish_round`: "return
        the played cards to the bottom of the deck, trick by trick, in play
        order")."""
        for _, plays in tricks:
            for _, card in plays:
                self.deque.append(card)
                self._known.add(card)

    def replay(self, game_log: GameLog) -> None:
        """Rebuild deal/resolve state for every round in ``game_log``, in
        order. Cheap to call repeatedly with a growing log if the caller
        tracks how many rounds it has already replayed and slices
        accordingly — this method itself always replays from empty state."""
        for round_log in game_log:
            self.deal_round(round_log.index, round_log.dealer)
            self.resolve_round(round_log.tricks)
