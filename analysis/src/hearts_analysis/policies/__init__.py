from .counters import CountingPolicy
from .deck_tracker import DeckTrackerPolicy
from .feature_bidder import FeatureBidderPolicy
from .heuristic import HeuristicPolicy
from .mc_bidder import MCBidderPolicy
from .play_styles import PhasedPolicy, StyledPlayPolicy
from .random_policy import RandomPolicy

#: Names accepted by experiment CLIs (--bots).
REGISTRY = {
    "random": RandomPolicy,
    "heuristic": HeuristicPolicy,
    "mc_bidder": MCBidderPolicy,
    "deck_tracker": DeckTrackerPolicy,
    "feature_bidder": FeatureBidderPolicy,  # defaults to the "tuned" preset
    "styled": StyledPlayPolicy,  # defaults to the "adaptive" baseline
    "counting": CountingPolicy,  # defaults to hearts_exact, bid+play
}

__all__ = [
    "HeuristicPolicy", "RandomPolicy", "MCBidderPolicy", "DeckTrackerPolicy",
    "FeatureBidderPolicy", "StyledPlayPolicy", "PhasedPolicy", "CountingPolicy",
    "REGISTRY",
]
