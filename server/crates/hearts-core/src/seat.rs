//! Seat positions around the table (spec §2.2).
//!
//! Players sit in a fixed cyclic order; all rotation — dealing, bidding,
//! play — advances by seat index modulo the player count.

use std::fmt;

/// A position at the table, `0..num_players`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Seat(pub usize);

impl Seat {
    /// The next seat in rotation (treat as clockwise).
    pub fn next(self, num_players: usize) -> Seat {
        self.offset(1, num_players)
    }

    /// The seat `by` places after this one in rotation.
    pub fn offset(self, by: usize, num_players: usize) -> Seat {
        Seat((self.0 + by) % num_players)
    }
}

impl fmt::Display for Seat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "seat {}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_wraps() {
        assert_eq!(Seat(3).next(4), Seat(0));
        assert_eq!(Seat(1).offset(3, 4), Seat(0));
        assert_eq!(Seat(0).offset(4, 4), Seat(0));
    }
}
