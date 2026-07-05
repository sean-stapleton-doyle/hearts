"""Card encoding and pure-Python rules vs the engine, exhaustively."""

import pyhearts
import pytest

from hearts_analysis import cards


def test_int_encoding_roundtrips():
    for c in range(cards.NUM_CARDS):
        assert cards.card_to_int(cards.INT_TO_CARD[c]) == c


def test_rank_and_suit_helpers():
    for c in range(cards.NUM_CARDS):
        card = cards.INT_TO_CARD[c]
        assert cards.rank_of(c) == card.rank.value()
        assert cards.is_trump(c) == card.suit.is_trump()


def test_beats_matches_engine_exhaustively():
    for led_idx, led in enumerate(pyhearts.Suit.ALL):
        for a in range(cards.NUM_CARDS):
            for b in range(cards.NUM_CARDS):
                if a == b:
                    continue
                assert cards.beats(a, b, led_idx) == cards.INT_TO_CARD[a].beats(
                    cards.INT_TO_CARD[b], led
                ), f"{cards.card_str(a)} vs {cards.card_str(b)} led {led}"


def test_legal_plays_follows_suit():
    hand = [0, 1, 14, 40]  # ♣2 ♣3 ♦3 ♥4
    assert cards.legal_plays(hand, 0) == (0, 1)
    assert cards.legal_plays(hand, 1) == (14,)
    assert cards.legal_plays(hand, 2) == (0, 1, 14, 40)  # void: anything
    assert cards.legal_plays(hand, None) == (0, 1, 14, 40)  # leading


def test_winning_play():
    led = 0  # clubs
    plays = [(0, 12), (1, 5), (2, 20)]  # ♣A, ♣7, ♦9
    assert cards.winning_play(plays, led) == (0, 12)
    plays.append((3, 39))  # ♥2 trumps
    assert cards.winning_play(plays, led) == (3, 39)


@pytest.mark.parametrize("seed", range(5))
def test_shuffled_deck_matches_engine(seed):
    deck = pyhearts.Deck.shuffled(seed)
    ints = [cards.card_to_int(c) for c in deck.cards()]
    assert sorted(ints) == list(range(52))
