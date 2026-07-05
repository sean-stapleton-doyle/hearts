"""Exact game-theoretic analysis of the smallest rounds, and a discrete
replicator-dynamics solver for the empirical policy meta-game.

The 1-card round is small enough to solve exactly by full enumeration —
no sampling anywhere in this module. For 2 players it's degenerate: the
last bidder's bid is entirely determined by the first bidder's (the
forbidden-bid rule with `cards_dealt=1` leaves exactly one legal bid once
the first bid is known), so there's no real strategic interaction. For 3
players the first two bidders' *joint* choice determines the third's forced
bid, which is genuine strategic interdependence — small enough (2x2 joint
actions x every 3-card deal) to solve as an exact bimatrix game.
"""

from __future__ import annotations

from itertools import permutations

import numpy as np
import pyhearts

from . import cards


def exact_p_win_one_card(my_card: int, n_players: int) -> float:
    """P(my single card wins the round's only trick). I win iff every one
    of the `n_players - 1` opponents' cards fails to beat mine — closed
    form: with `k` of the other 51 cards capable of beating mine, I win iff
    all `n_players - 1` drawn opponents come from the `51 - k` that can't,
    i.e. `P(win) = C(51-k, n-1) / C(51, n-1)` (hypergeometric, no
    combinatorial enumeration needed — that scales to `C(51,6)` ~ 18M for
    `n_players=7` otherwise). Assumes I lead (true for the dealer, who
    always leads the first trick)."""
    from math import comb

    remaining = [c for c in range(cards.NUM_CARDS) if c != my_card]
    n_other = n_players - 1
    k = sum(cards.beats(o, my_card, my_card // 13) for o in remaining)
    return comb(len(remaining) - k, n_other) / comb(len(remaining), n_other)


def value_one_card(p_win: float, bid: int) -> float:
    """E[score_delta] for bidding `bid` (0 or 1) with win probability
    `p_win`, in a 1-card round."""
    if bid == 1:
        return p_win * pyhearts.score_delta(1, 1) + (1 - p_win) * pyhearts.score_delta(1, 0)
    return p_win * pyhearts.score_delta(0, 1) + (1 - p_win) * pyhearts.score_delta(0, 0)


def optimal_bid_one_card(my_card: int, n_players: int) -> tuple[int, float, float]:
    """(best bid, its value, P(win)) for a single card, first bidder,
    round 1. Closed-form break-even is `p_win = 0.4` given this scoring."""
    p = exact_p_win_one_card(my_card, n_players)
    v1, v0 = value_one_card(p, 1), value_one_card(p, 0)
    return (1, v1, p) if v1 >= v0 else (0, v0, p)


def three_player_bimatrix(dealer_leads: bool = True) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Exact 2x2x2 payoff tensor for the 3-player, 1-card round: bidder0
    (dealer, leads) and bidder1 each freely choose a bid in {0, 1}; bidder2
    (last) is then *forced* by the engine's forbidden-bid rule (bids must
    sum to something other than `cards_dealt=1`, so bidder2's bid is
    whichever of {0,1} keeps the sum off 1). Returns `(payoff0, payoff1,
    payoff2)`, each shape `(2, 2)` indexed `[bid0, bid1]`, averaged exactly
    over every ordered assignment of 3 distinct cards to the 3 seats.
    """
    payoff = np.zeros((2, 2, 3))
    n = 0
    for c0, c1, c2 in permutations(range(cards.NUM_CARDS), 3):
        hand = (c0, c1, c2)
        led_suit = c0 // 13  # seat 0 (dealer) always leads
        winner = max(range(3), key=lambda s: _beats_key(hand, s, led_suit))
        for b0 in (0, 1):
            for b1 in (0, 1):
                total_so_far = b0 + b1
                # forbidden bid for the last bidder, cards_dealt=1
                forbidden = 1 - total_so_far if 0 <= 1 - total_so_far <= 1 else None
                b2 = 0 if forbidden == 1 else 1 if forbidden == 0 else 0
                bids = (b0, b1, b2)
                for s in range(3):
                    tricks = 1 if s == winner else 0
                    payoff[b0, b1, s] += pyhearts.score_delta(bids[s], tricks)
        n += 1
    payoff /= n
    return payoff[..., 0], payoff[..., 1], payoff[..., 2]


def _beats_key(hand: tuple[int, int, int], seat: int, led_suit: int) -> tuple[bool, int]:
    """Sort key so `max` over seats picks the trick winner: trump beats
    all, else led-suit rank; anything else loses to everything (mirrors
    `cards.beats`, expressed as a totally-ordered key for 3-way `max`)."""
    c = hand[seat]
    suit, rank = c // 13, c % 13
    if suit == cards.TRUMP:
        return (2, rank)
    if suit == led_suit:
        return (1, rank)
    return (0, rank)


def pure_nash_2x2(payoff0: np.ndarray, payoff1: np.ndarray) -> list[tuple[int, int]]:
    """Pure-strategy Nash equilibria of a 2x2 bimatrix game: cells where
    neither player can improve by unilaterally deviating."""
    equilibria = []
    for a in (0, 1):
        for b in (0, 1):
            best_a = payoff0[a, b] >= payoff0[1 - a, b]
            best_b = payoff1[a, b] >= payoff1[a, 1 - b]
            if best_a and best_b:
                equilibria.append((a, b))
    return equilibria


def replicator_dynamics(
    payoff: np.ndarray, x0: np.ndarray | None = None, steps: int = 2000, dt: float = 0.05,
) -> np.ndarray:
    """Discrete-time replicator dynamics on a symmetric-ish `payoff[i, j]`
    (row strategy's payoff vs column strategy) meta-game: returns the
    trajectory of the population mixture, shape `(steps + 1, n)`."""
    n = payoff.shape[0]
    x = np.full(n, 1.0 / n) if x0 is None else np.array(x0, dtype=float)
    traj = [x.copy()]
    for _ in range(steps):
        fitness = payoff @ x
        avg_fitness = x @ fitness
        x = x * (1 + dt * (fitness - avg_fitness))
        x = np.clip(x, 0, None)
        x /= x.sum()
        traj.append(x.copy())
    return np.array(traj)
