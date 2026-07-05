"""Seed management: one experiment seed reproduces every game exactly.

``SeedSequence(experiment_seed)`` spawns one child per game; each child yields
the engine's ``game_seed`` (uint64) and per-seat policy RNGs. Records carry
``experiment_seed`` and ``game_seed`` so any single game can be replayed with
:func:`hearts_analysis.runner.play_game`.
"""

from __future__ import annotations

import numpy as np


def spawn_game_seeds(experiment_seed: int, n_games: int) -> list[np.random.SeedSequence]:
    return np.random.SeedSequence(experiment_seed).spawn(n_games)


def game_seed_of(child: np.random.SeedSequence) -> int:
    """The engine seed derived from a per-game SeedSequence."""
    return int(child.generate_state(1, np.uint64)[0])


def policy_rngs(child: np.random.SeedSequence, num_players: int) -> list[np.random.Generator]:
    return [np.random.Generator(np.random.PCG64(s)) for s in child.spawn(num_players)]


def replay_seed_seq(game_seed: int) -> np.random.SeedSequence:
    """A stand-in SeedSequence for replaying a single game outside an
    experiment (policy RNG streams differ from the original experiment's)."""
    return np.random.SeedSequence(game_seed)
