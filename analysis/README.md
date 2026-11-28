# hearts-analysis

Statistical, probabilistic, and game-theoretic analysis of the hearts card game
(an Oh Hell-family bidding game — see `docs/card-game-spec.md`), driven through
the `pyhearts` bindings (`crates/hearts-py`).

## Setup

Requires [uv](https://docs.astral.sh/uv/). `uv sync` builds `pyhearts` from the
sibling crate via maturin automatically (no global maturin install needed).

```sh
cd analysis
uv sync
uv run python -c "import pyhearts; print(pyhearts.Game(4, 42).phase())"
uv run pytest
```

After editing Rust sources, `uv sync` rebuilds `pyhearts` automatically (the
crate declares `[tool.uv] cache-keys` over its `.rs` files); if in doubt,
`uv sync --reinstall-package pyhearts`.

## Layout

- `src/hearts_analysis/` — the library: card int-encoding, `Observation`/`Policy`
  interfaces, game runner, record schemas, estimators, deck model, solvers.
- `src/hearts_analysis/experiments/` — CLIs (`uv run python -m
  hearts_analysis.experiments.baseline --help`) that write parquet + a
  `manifest.json` under `data/<experiment>/`. `--out` must resolve inside the
  directory you run from (`hearts_analysis.paths.safe_out_dir`); anything
  else, including `..` or a symlink that points out, is refused before the
  run starts.
- `notebooks/` — narrative analysis; notebooks read only from `data/`.
- `data/` — experiment outputs (gitignored).

## Analysis phases

1. **Baseline statistics** (`01_baseline.ipynb`) — Monte Carlo with simple bots:
   score distributions by player count, bid accuracy by round size and bidding
   position, the last-bidder ("forbidden bid") tax, seat/dealer effects, hand
   strength vs tricks won.
2. **Optimal bidding** (`02_bidding.ipynb`) — estimate `P(tricks | hand,
   position)` by Monte Carlo over deals consistent with the hand, bid to
   maximize expected `score_delta`; bid tables for small rounds.
3. **Deck tracking** (`03_deck_tracking.ipynb`) — the deck is shuffled once per
   game and played cards return to the bottom in play order, so public history
   pins down ever more of the deck; quantify the information curve and the
   score edge of a tracking policy (paired-seed design).
4. **Game theory** (`04_equilibria.ipynb`) — exact analysis of the 1-card
   round, CFR equilibrium for the 2-card 2-player round, exploitability of the
   heuristics, and an empirical meta-game across all policies.
5. **Strategies** (`05_strategies.ipynb`) — feature-based bidding families
   (hearts / high cards / face cards) and an 18-point weight sweep; fixed play
   styles (hearts-first, high-first, low-first) vs the adaptive baseline and
   phase-switching combos at both timescales; style × position interactions
   (2p and 4p); the first-dealer edge in 2-player games; a dominance chart of
   every strategy's paired edge over random.
6. **Card counting** (`06_counting.ipynb`) — a graded memory ladder (count of
   hearts → exact hearts → high cards → everything), ablated independently
   into bid and play channels with paired seeds; why within-round counting is
   worth ≈0 while counting-informed bidding is worth +2 to +9 points/game.

## Notes

- Policies act only on `Observation` (own hand + public history) — they cannot
  see other hands or the deck. The deck tracker earns its edge legitimately
  from public information.
- Cards cross the pyo3 boundary once and live as ints 0..51 (`suit*13 +
  rank-2`) on the Python side; keep tight loops in int-land.
- A Rust-side batch simulator is a possible future speedup; out of scope for now.
