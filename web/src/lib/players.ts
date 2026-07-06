// Seat → player lookups, shared by every surface that captions a seat
// (table, recap, finished screen). One home for the `seat N` fallback so a
// missing player renders consistently everywhere.
import type { PlayerInfo } from './types'

export function playerBySeat(players: PlayerInfo[], seat: number): PlayerInfo | undefined {
  return players.find((p) => p.seat === seat)
}

export function nameBySeat(players: PlayerInfo[], seat: number): string {
  return playerBySeat(players, seat)?.display_name ?? `seat ${seat}`
}

/** Bound form for components that take a `nameBySeat(seat)` prop. */
export function seatNamer(players: PlayerInfo[]): (seat: number) => string {
  return (seat) => nameBySeat(players, seat)
}
