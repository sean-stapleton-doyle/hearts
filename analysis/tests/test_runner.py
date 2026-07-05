"""Runner correctness: determinism, engine agreement, record integrity."""

import pyhearts
import pytest

from hearts_analysis import records, runner
from hearts_analysis.policies import HeuristicPolicy, RandomPolicy


def random_table_4():
    return [RandomPolicy() for _ in range(4)]


def mixed_table_4():
    return [HeuristicPolicy(), RandomPolicy(), HeuristicPolicy(), RandomPolicy()]


@pytest.mark.parametrize("n_players", range(2, 8))
def test_full_game_completes_and_agrees_with_engine(n_players):
    # validate=True cross-checks turn order and legal moves against the
    # engine at every decision; the runner itself cross-checks bids, tricks,
    # deltas, and final scores at every round boundary.
    rec = runner.play_game(
        [RandomPolicy() for _ in range(n_players)], game_seed=1234, validate=True
    )
    assert len(rec.rounds) == 13 * n_players
    assert len(rec.final_scores) == n_players
    assert rec.winners


def test_determinism_byte_identical_records():
    a = runner.play_games(7, 20, mixed_table_4)
    b = runner.play_games(7, 20, mixed_table_4)
    assert records.games_frame(a, 7).equals(records.games_frame(b, 7))
    assert records.rounds_frame(a, 7).equals(records.rounds_frame(b, 7))


def test_different_seeds_differ():
    a = runner.play_games(7, 5, random_table_4)
    b = runner.play_games(8, 5, random_table_4)
    assert not records.games_frame(a, 7)["final_score"].equals(
        records.games_frame(b, 8)["final_score"]
    )


def test_deltas_match_score_delta():
    for rec in runner.play_games(11, 10, mixed_table_4):
        totals = [0] * rec.num_players
        for row in rec.rounds:
            assert row.delta == pyhearts.score_delta(row.bid, row.tricks_won)
            totals[row.seat] += row.delta
        assert tuple(totals) == rec.final_scores
        best = max(rec.final_scores)
        assert set(rec.winners) == {
            s for s, sc in enumerate(rec.final_scores) if sc == best
        }


def test_record_plays_covers_every_card():
    rec = runner.play_game(random_table_4(), game_seed=99, record_plays=True)
    assert rec.plays is not None
    # Total plays = sum over rounds of cards_dealt * num_players
    expected = sum(pyhearts.cards_for_round(r) for r in range(1, 14)) * 4
    assert len(rec.plays) == expected


def test_rotate_first_dealer():
    recs = runner.play_games(3, 8, random_table_4, rotate_first_dealer=True)
    assert [r.first_dealer for r in recs] == [0, 1, 2, 3, 0, 1, 2, 3]


def test_multiprocessing_matches_serial():
    serial = runner.play_games(21, 12, random_table_4)
    parallel = runner.play_games(21, 12, random_table_4, n_workers=2)
    assert records.games_frame(serial, 21).equals(records.games_frame(parallel, 21))
