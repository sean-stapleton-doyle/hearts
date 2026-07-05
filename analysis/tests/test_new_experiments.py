"""Smoke tests for the strategy/style/dealer/counting experiment CLIs, plus
fast structural checks on their candidate tables."""

from __future__ import annotations

import pandas as pd
import pytest

from hearts_analysis.experiments import counting, dealer_edge, play_styles, strategy_sweep


def test_strategy_sweep_candidates_shape():
    with_grid = strategy_sweep.candidates(include_grid=True)
    without = strategy_sweep.candidates(include_grid=False)
    assert set(without) < set(with_grid)
    assert {"random", "heuristic", "fb:tuned", "fb:hearts_only"} <= set(without)
    assert len(with_grid) == len(without) + 18


def test_play_styles_tables_are_buildable():
    for label in play_styles.CANDIDATES:
        table = play_styles._table(label, 4)
        assert len(table) == 4
        assert table[0].name != "" and table[1].name == "style:adaptive"


@pytest.mark.smoke
def test_strategy_sweep_smoke(tmp_path):
    strategy_sweep.main([
        "--players", "2", "--games", "4", "--seed", "1", "--no-grid",
        "--out", str(tmp_path),
    ])
    games = pd.read_parquet(tmp_path / "games.parquet")
    assert set(games["candidate"]) == set(strategy_sweep.candidates(include_grid=False))
    assert (games["seat"] == 0).all()


@pytest.mark.smoke
def test_play_styles_smoke(tmp_path):
    play_styles.main(["--players", "2", "--games", "3", "--seed", "1", "--out", str(tmp_path)])
    plays = pd.read_parquet(tmp_path / "adaptive" / "plays.parquet")
    assert {"trick_index", "play_index", "trick_winner"} <= set(plays.columns)


@pytest.mark.smoke
def test_dealer_edge_smoke(tmp_path):
    dealer_edge.main(["--games", "5", "--seed", "1", "--out", str(tmp_path)])
    g = pd.read_parquet(tmp_path / "heuristic" / "games.parquet")
    assert (g["first_dealer"] == 0).all()
    assert set(g["seat"]) == {0, 1}


@pytest.mark.smoke
def test_counting_smoke(tmp_path):
    counting.main([
        "--games", "3", "--mc-samples", "20", "--seed", "1", "--out", str(tmp_path),
    ])
    df = pd.read_parquet(tmp_path / "ablation.parquet")
    assert set(df["level"]) == set(counting.LEVELS)
    assert set(df["use"]) == {"play", "bid", "bid+play"}
    # play-only arms pair against the all-heuristic baseline, bid arms
    # against mc_bidder.
    assert (df.loc[df["use"] == "play", "baseline"] == "heuristic").all()
    assert (df.loc[df["use"] != "play", "baseline"] == "mc_bidder").all()
