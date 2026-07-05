"""Solver correctness: exact 1-card theory, the 3-player bimatrix, Nash
finder, and replicator dynamics — all checked against known-good cases."""

from __future__ import annotations

import numpy as np

from hearts_analysis import solver


def test_ace_of_hearts_always_bids_one():
    for n in (2, 3, 4, 7):
        bid, value, p = solver.optimal_bid_one_card(3 * 13 + 12, n)
        assert bid == 1
        assert p == 1.0  # unbeatable


def test_p_win_matches_break_even_threshold():
    # Break-even for bid 1 vs 0 is exactly p = 0.4 under this scoring.
    for card in (0, 10, 25, 40, 51):
        for n in (2, 3, 5):
            bid, value, p = solver.optimal_bid_one_card(card, n)
            expected = 1 if p > 0.4 else 0
            assert bid == expected


def test_three_player_bimatrix_shape_and_symmetry():
    p0, p1, p2 = solver.three_player_bimatrix()
    assert p0.shape == p1.shape == p2.shape == (2, 2)
    # Player 0's payoff never depends on player 1's bid (bidding doesn't
    # affect who wins the trick) — rows are constant across columns, and
    # vice versa for player 1.
    assert np.allclose(p0[:, 0], p0[:, 1])
    assert np.allclose(p1[0, :], p1[1, :])


def test_pure_nash_matches_dominant_strategies():
    p0, p1, _ = solver.three_player_bimatrix()
    best0 = int(p0[1, 0] > p0[0, 0])  # player 0's dominant bid
    best1 = int(p1[0, 1] > p1[0, 0])  # player 1's dominant bid
    equilibria = solver.pure_nash_2x2(p0, p1)
    assert (best0, best1) in equilibria


def test_pure_nash_prisoners_dilemma():
    # Classic PD: (defect, defect) is the unique pure NE.
    p0 = np.array([[3, 0], [5, 1]])  # row = player0's action
    p1 = np.array([[3, 5], [0, 1]])  # col = player1's action
    assert solver.pure_nash_2x2(p0, p1) == [(1, 1)]


def test_replicator_dynamics_dominant_strategy_takes_over():
    # Strategy 0 strictly dominates strategy 1 for both players.
    payoff = np.array([[1.0, 1.0], [0.0, 0.5]])
    traj = solver.replicator_dynamics(payoff, x0=[0.5, 0.5], steps=500, dt=0.1)
    assert traj[-1, 0] > 0.99


def test_replicator_dynamics_stays_on_simplex():
    payoff = np.array([[0.0, -1.0, 1.0], [1.0, 0.0, -1.0], [-1.0, 1.0, 0.0]])  # RPS
    traj = solver.replicator_dynamics(payoff, steps=200, dt=0.05)
    assert np.allclose(traj.sum(axis=1), 1.0)
    assert (traj >= -1e-9).all()
