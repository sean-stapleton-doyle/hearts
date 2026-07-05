"""What a policy is allowed to see when it acts.

An :class:`Observation` contains the acting seat's own hand plus everything
public at the table — bids, the current trick, completed tricks this round
(``round_tricks``), and the full public history of prior rounds
(``game_log``). That history is exactly what a human player could write down,
which is what legitimizes deck-tracking policies. Policies never receive the
``pyhearts.Game`` object, other seats' hands, or the deck.

Cards are ints (see :mod:`hearts_analysis.cards`).
"""

from __future__ import annotations

from dataclasses import dataclass

#: One completed trick: ``(leader, ((seat, card), ...))`` in play order.
TrickRecord = tuple[int, tuple[tuple[int, int], ...]]


@dataclass(frozen=True, slots=True)
class RoundLog:
    """Public record of one completed round."""

    index: int  # 1-based, matching the engine
    dealer: int
    bids: tuple[int, ...]
    tricks: tuple[TrickRecord, ...]


#: Public history of all completed rounds, oldest first.
GameLog = tuple[RoundLog, ...]


@dataclass(frozen=True, slots=True)
class Observation:
    """A single decision point, from the acting seat's point of view.

    During bidding ``legal_bids`` is populated and the play-phase fields are
    empty; during play ``legal_plays`` is populated and ``legal_bids`` is
    ``()``. ``bids`` uses ``None`` for seats that have not bid yet.
    """

    # Context
    seat: int
    num_players: int
    round_index: int  # 1-based
    cards_this_round: int
    dealer: int
    scores: tuple[int, ...]  # cumulative, entering this round

    # Bidding state
    bids: tuple[int | None, ...]
    my_bid_position: int  # 0 = dealer bids first
    forbidden_bid: int | None  # set only when acting as the last bidder
    legal_bids: tuple[int, ...]

    # Play state
    hand: tuple[int, ...]  # own remaining cards, ascending
    legal_plays: tuple[int, ...]
    current_trick: tuple[tuple[int, int], ...]  # (seat, card) in play order
    led_suit: int | None
    tricks_won: tuple[int, ...]  # per seat, this round

    # Public history
    round_tricks: tuple[TrickRecord, ...]  # completed tricks this round
    game_log: GameLog  # completed prior rounds

    @property
    def is_bidding(self) -> bool:
        return bool(self.legal_bids)

    @property
    def my_bid(self) -> int | None:
        return self.bids[self.seat]

    @property
    def my_tricks(self) -> int:
        return self.tricks_won[self.seat]
