"""Smoke test for the meta-game payoff matrix CLI."""

import pytest

from hearts_analysis.experiments import metagame


@pytest.mark.smoke
def test_run_matchup_smoke():
    mean_a, mean_b = metagame.run_matchup("random", "heuristic", n_games=10, seed=1, n_workers=1)
    assert isinstance(mean_a, float) and isinstance(mean_b, float)
