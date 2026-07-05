"""Smoke test for the bid-table CLI."""

import pytest

from hearts_analysis.experiments import bidding


@pytest.mark.smoke
def test_bid_table_smoke(tmp_path):
    df = bidding.build_table(players=[4], rounds=[1], n_hands=5, mc_samples=100, seed=1)
    assert set(df["cards_dealt"]) == {1}
    assert set(df["bid"]) <= {0, 1}
    assert len(df) == 5 * 2  # 5 hands x 2 candidate bids (0, 1)
