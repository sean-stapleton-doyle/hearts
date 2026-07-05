"""Smoke tests for the deck-tracking experiment CLI."""

import pytest

from hearts_analysis.experiments import tracking


@pytest.mark.smoke
def test_information_smoke():
    df = tracking.run_information(players=4, n_games=5, seed=1, n_workers=1)
    assert set(df["round_index"]) == set(range(1, 14))
    assert (df["known"] <= df["cards_dealt"]).all()
    assert (df["frac_known"] >= 0).all() and (df["frac_known"] <= 1).all()
    # Later rounds should see at least as much cumulative recycling
    # opportunity as round 1, which always starts from a wholly unknown deck.
    assert df[df["round_index"] == 1]["known"].sum() == 0


@pytest.mark.smoke
def test_edge_smoke(tmp_path):
    out = tracking.run_edge(n_games=6, mc_samples=30, seed=3, n_workers=1, out=tmp_path / "edge")
    import pandas as pd
    paired = pd.read_parquet(out / "paired_games.parquet")
    assert len(paired) == 6
    assert "edge" in paired.columns
