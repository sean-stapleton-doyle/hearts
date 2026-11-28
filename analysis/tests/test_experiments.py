"""End-to-end smoke: the baseline CLI writes a loadable experiment."""

import json

import pytest

from hearts_analysis import records
from hearts_analysis.experiments import baseline


@pytest.mark.smoke
def test_baseline_smoke(tmp_path, monkeypatch):
    # --out must stay under the working directory (hearts_analysis.paths).
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "exp"
    baseline.main([
        "--players", "4", "--games", "20", "--bots", "heuristic,random,heuristic,random",
        "--seed", "3", "--out", "exp", "--record-plays",
    ])
    frames = records.load_experiment(out)
    assert set(frames) == {"games", "rounds", "plays"}
    assert len(frames["games"]) == 20 * 4
    assert len(frames["rounds"]) == 20 * 4 * 13
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["n_games"] == 20 and manifest["experiment_seed"] == 3
