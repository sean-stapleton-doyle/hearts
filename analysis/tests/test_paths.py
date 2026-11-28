"""`safe_out_dir` keeps experiment output under the working directory, and
every experiment CLI applies it before running (SonarQube S8707)."""

import pytest

from hearts_analysis.experiments import (
    baseline,
    bidding,
    counting,
    dealer_edge,
    metagame,
    play_styles,
    strategy_sweep,
    tracking,
)
from hearts_analysis.paths import safe_out_dir


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    base = tmp_path / "work"
    base.mkdir()
    monkeypatch.chdir(base)
    return base


@pytest.mark.parametrize("rel", ["data/x", "data/../data/x", "data", "."])
def test_allows_paths_inside(workdir, rel):
    assert safe_out_dir(rel) == (workdir / rel).resolve()


def test_allows_absolute_path_inside(workdir):
    assert safe_out_dir(workdir / "data") == (workdir / "data").resolve()


@pytest.mark.parametrize("bad", ["..", "../elsewhere", "data/../../elsewhere", "/etc"])
def test_rejects_paths_outside(workdir, bad):
    with pytest.raises(ValueError, match="outside the working directory"):
        safe_out_dir(bad)


def test_rejects_sibling_sharing_the_prefix(workdir):
    # "/…/work-evil" starts with "/…/work" but is not inside it.
    with pytest.raises(ValueError, match="outside the working directory"):
        safe_out_dir(workdir.parent / "work-evil")


def test_rejects_symlink_pointing_out(workdir, tmp_path):
    (workdir / "link").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="outside the working directory"):
        safe_out_dir("link/elsewhere")


CLIS = [
    ("baseline", baseline.main, []),
    ("bidding", bidding.main, []),
    ("counting", counting.main, []),
    ("dealer_edge", dealer_edge.main, []),
    ("metagame", metagame.main, []),
    ("play_styles", play_styles.main, []),
    ("strategy_sweep", strategy_sweep.main, []),
    ("tracking information", tracking.main, ["information"]),
    ("tracking edge", tracking.main, ["edge"]),
]


@pytest.mark.parametrize("main, argv", [c[1:] for c in CLIS], ids=[c[0] for c in CLIS])
def test_cli_rejects_escaping_out_before_running(workdir, main, argv):
    # Default experiment sizes: if the check ran after the experiment instead
    # of before it, this would take minutes rather than milliseconds.
    with pytest.raises(ValueError, match="outside the working directory"):
        main([*argv, "--out", "../elsewhere"])
    assert not (workdir.parent / "elsewhere").exists()
