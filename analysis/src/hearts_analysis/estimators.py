"""Monte Carlo estimation of `P(tricks won | hand)` and the bid that
maximizes expected `score_delta` under that distribution.

**v1 is bid-independent**: every rollout plays *greedily* (always try to win
the trick as cheaply as possible; otherwise shed the highest card) regardless
of what bid is being evaluated. This isolates "how many tricks can this hand
plausibly take" from "how should play change once a bid is locked in" — the
question `HeuristicPolicy.play` answers via `want_trick`. Bid-aware play is
a documented v2 extension (see `mc_bidder.py`), not implemented here.

Opponent hands are sampled uniformly from the cards not in our own hand (the
only information available before any card of this round has been played).
Seats that have already bid use their observed bid; seats not yet bid use a
`HeuristicPolicy`-style estimate so the simulated auction stays internally
consistent (i.e. respects the forbidden-bid rule).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pyhearts

from . import cards
from .policies.heuristic import HeuristicPolicy

_DEFAULT_OPPONENT_BIDDER = HeuristicPolicy()


def forbidden_bid(cards_dealt: int, bids_so_far_sum: int, is_last: bool) -> int | None:
    """Mirrors `Round::forbidden_bid` (round.rs): only defined for the last
    bidder, and only when the balancing value is itself a legal bid."""
    if not is_last:
        return None
    would_be = cards_dealt - bids_so_far_sum
    return would_be if 0 <= would_be <= cards_dealt else None


def _opponent_bid(hand: Sequence[int], legal_bids: Sequence[int]) -> int:
    est = _DEFAULT_OPPONENT_BIDDER.estimate_tricks(tuple(hand))
    return min(legal_bids, key=lambda b: (abs(b - est), b))


def _greedy_play(legal: Sequence[int], trick: Sequence[tuple[int, int]], led_suit: int | None) -> int:
    """Always try to win the trick as cheaply as possible; when unable to
    win, shed the highest-value card (hearts first)."""
    if not trick:
        return max(legal, key=lambda c: (cards.is_trump(c), cards.rank_of(c)))
    _, best_card = cards.winning_play(trick, led_suit)
    winners = [c for c in legal if cards.beats(c, best_card, led_suit)]
    if winners:
        return min(winners, key=cards.rank_of)
    return max(legal, key=lambda c: (cards.is_trump(c), cards.rank_of(c)))


def estimate_trick_distribution(
    *,
    hand: Sequence[int],
    seat: int,
    num_players: int,
    cards_dealt: int,
    dealer: int,
    known_bids: Sequence[int | None],
    candidate_bid: int,
    n_samples: int = 1000,
    rng: np.random.Generator,
    known_opponent_cards: dict[int, Sequence[int]] | None = None,
) -> np.ndarray:
    """Monte Carlo counts of tricks won by ``seat``, over ``n_samples``
    deals consistent with ``hand``, assuming ``seat`` bids ``candidate_bid``.
    Returns an array of length ``cards_dealt + 1`` indexed by trick count.

    ``known_opponent_cards`` (optional): ``{seat: cards}`` for opponents
    whose hand is partially or fully known (e.g. from deck tracking, see
    `deck_model.py`) — those cards are fixed rather than sampled, and
    removed from the pool other seats draw from. Seats/slots not covered
    fall back to uniform sampling among the remaining unseen cards, exactly
    as with no deck knowledge.

    ``rng`` is required, not defaulted to a fresh unseeded generator: every
    estimate must be reproducible from the caller's seed.
    """
    counts = np.zeros(cards_dealt + 1, dtype=np.int64)
    known_opponent_cards = known_opponent_cards or {}
    forced = {s: tuple(c) for s, c in known_opponent_cards.items() if c}
    forced_cards = {c for cs in forced.values() for c in cs}
    unseen_base = np.array([
        c for c in range(cards.NUM_CARDS) if c not in hand and c not in forced_cards
    ])
    order = [(dealer + p) % num_players for p in range(num_players)]
    hand = list(hand)

    for _ in range(n_samples):
        unseen = unseen_base.copy()
        rng.shuffle(unseen)
        hands: list[list[int]] = [[] for _ in range(num_players)]
        hands[seat] = hand
        idx = 0
        for s in order:
            if s == seat:
                continue
            known_here = list(forced.get(s, ()))
            need = cards_dealt - len(known_here)
            hands[s] = known_here + list(unseen[idx: idx + need])
            idx += need

        bids: list[int | None] = [None] * num_players
        running_sum = 0
        for pos, s in enumerate(order):
            is_last = pos == num_players - 1
            if s == seat:
                bid = candidate_bid
            elif known_bids[s] is not None:
                bid = known_bids[s]
            else:
                forbidden = forbidden_bid(cards_dealt, running_sum, is_last)
                legal = [b for b in range(cards_dealt + 1) if b != forbidden]
                bid = _opponent_bid(hands[s], legal)
            bids[s] = bid
            running_sum += bid

        remaining = [list(h) for h in hands]
        leader = dealer
        tricks_won = 0
        for _ in range(cards_dealt):
            trick: list[tuple[int, int]] = []
            led: int | None = None
            for pos in range(num_players):
                s = (leader + pos) % num_players
                legal = cards.legal_plays(remaining[s], led)
                card = _greedy_play(legal, trick, led)
                remaining[s].remove(card)
                trick.append((s, card))
                if led is None:
                    led = card // 13
            winner, _ = cards.winning_play(trick, led)
            if winner == seat:
                tricks_won += 1
            leader = winner
        counts[tricks_won] += 1

    return counts


def expected_value(counts: np.ndarray, bid: int) -> float:
    n = int(counts.sum())
    if n == 0:
        return float("nan")
    total = sum(pyhearts.score_delta(bid, t) * int(c) for t, c in enumerate(counts))
    return total / n


def best_bid(
    *,
    hand: Sequence[int],
    seat: int,
    num_players: int,
    cards_dealt: int,
    dealer: int,
    known_bids: Sequence[int | None],
    legal_bids: Sequence[int],
    n_samples: int = 1000,
    rng: np.random.Generator,
    known_opponent_cards: dict[int, Sequence[int]] | None = None,
) -> tuple[int, dict[int, float]]:
    """The legal bid maximizing expected `score_delta`, and the value of
    every candidate (for building bid tables)."""
    values = {}
    for k in legal_bids:
        counts = estimate_trick_distribution(
            hand=hand, seat=seat, num_players=num_players, cards_dealt=cards_dealt,
            dealer=dealer, known_bids=known_bids, candidate_bid=k,
            n_samples=n_samples, rng=rng, known_opponent_cards=known_opponent_cards,
        )
        values[k] = expected_value(counts, k)
    best = max(values, key=values.get)
    return best, values
