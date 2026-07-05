"""Shared matplotlib styling for the analysis notebooks.

Palette values follow the dataviz reference palette and were validated with
its six-checks validator (categorical pair, 4-step ordinal ramp, sequential
ramp) against a white surface. Categorical hues are assigned in fixed order;
sub-3:1 slots (aqua) always ship with direct labels.
"""

from __future__ import annotations

import matplotlib as mpl
from matplotlib.colors import LinearSegmentedColormap

# Categorical slots, fixed order (validated: worst adjacent CVD ΔE 73.6).
BLUE = "#2a78d6"
AQUA = "#1baf7a"  # < 3:1 on white — use with direct labels
YELLOW = "#eda100"
VIOLET = "#4a3aa7"
CATEGORICAL = [BLUE, AQUA, YELLOW, VIOLET]

# 4-step single-hue ordinal ramp (validated), light -> dark.
ORDINAL_4 = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]

# Sequential blue ramp for heatmaps (light = near zero).
_SEQ_STEPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
SEQUENTIAL = LinearSegmentedColormap.from_list("hearts_blue", _SEQ_STEPS)

# Ink & chrome.
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
BASELINE = "#c3c2b7"


def use_style() -> None:
    """Apply the notebook chart style: recessive grid/axes, thin marks,
    text in ink tokens."""
    mpl.rcParams.update({
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.edgecolor": BASELINE,
        "axes.linewidth": 0.8,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.6,
        "axes.axisbelow": True,
        "axes.titlecolor": INK,
        "axes.titlesize": 11,
        "axes.titleweight": "bold",
        "axes.labelcolor": INK_2,
        "axes.labelsize": 9.5,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "xtick.labelsize": 8.5,
        "ytick.labelsize": 8.5,
        "lines.linewidth": 2.0,
        "lines.markersize": 6,
        "font.family": "sans-serif",
        "legend.frameon": False,
        "legend.fontsize": 9,
        "figure.dpi": 110,
    })


def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return (center - half, center + half)
