"""Integer card encoding and pure-Python rules helpers.

Cards cross the pyo3 boundary once and live as ints ``0..51`` on the Python
side: ``card_int = suit_index * 13 + (rank_value - 2)`` with suit order taken
from ``pyhearts.Suit.ALL`` (Clubs, Diamonds, Spades, Hearts). Hearts are
permanent trump. ``beats`` mirrors ``pyhearts.Card.beats`` and is validated
against it exhaustively in tests.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

import pyhearts

NUM_CARDS = 52
SUIT_NAMES = ("♣", "♦", "♠", "♥")
RANK_NAMES = ("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A")

_SUIT_TO_INT = {suit: i for i, suit in enumerate(pyhearts.Suit.ALL)}
TRUMP = _SUIT_TO_INT[pyhearts.Suit.Hearts]

#: Prebuilt Card objects so play calls never construct new ones.
INT_TO_CARD: list[pyhearts.Card] = [None] * NUM_CARDS  # type: ignore[list-item]
for _suit in pyhearts.Suit.ALL:
    for _rank in pyhearts.Rank.ALL:
        INT_TO_CARD[_SUIT_TO_INT[_suit] * 13 + _rank.value() - 2] = pyhearts.Card(_suit, _rank)


def card_to_int(card: pyhearts.Card) -> int:
    return _SUIT_TO_INT[card.suit] * 13 + card.rank.value() - 2


def suit_of(c: int) -> int:
    return c // 13


def rank_of(c: int) -> int:
    """Rank value 2..14 (ace high)."""
    return c % 13 + 2


def is_trump(c: int) -> bool:
    return c // 13 == TRUMP


def card_str(c: int) -> str:
    return f"{SUIT_NAMES[c // 13]}{RANK_NAMES[c % 13]}"


def beats(a: int, b: int, led_suit: int) -> bool:
    """Whether card ``a`` beats card ``b`` given the led suit.

    Trump (hearts) beats everything but a higher trump; a led-suit card
    beats lower led-suit cards and any off-suit non-trump; a card that is
    neither trump nor led-suit beats nothing — even a lower card of its own
    suit (matches the engine's ``Card::beats``).
    """
    sa, sb = a // 13, b // 13
    if sa == TRUMP:
        return sb != TRUMP or a > b
    if sa != led_suit:
        return False
    if sb == TRUMP:
        return False
    return sb != led_suit or a > b


def legal_plays(hand: Sequence[int], led_suit: int | None) -> tuple[int, ...]:
    """Legal plays from ``hand``: follow the led suit if able, else anything.

    ``led_suit`` is ``None`` when leading. Mirrors ``Round.legal_plays``
    (validated against the engine in tests / the runner's validate mode).
    """
    if led_suit is None:
        return tuple(hand)
    follow = tuple(c for c in hand if c // 13 == led_suit)
    return follow or tuple(hand)


def winning_play(plays: Iterable[tuple[int, int]], led_suit: int) -> tuple[int, int]:
    """The ``(seat, card)`` currently winning a non-empty trick."""
    it = iter(plays)
    best = next(it)
    for seat, card in it:
        if beats(card, best[1], led_suit):
            best = (seat, card)
    return best
