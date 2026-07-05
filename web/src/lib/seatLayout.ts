/** Seat geometry for the radial table: where each player sits on the felt,
 *  as percentages of the table surface. Pure math — components position
 *  seats with inline `--x`/`--y` style values derived from these placements.
 *
 *  Screen coordinates: 0° is the right edge, 90° the bottom, 270° the top.
 *  You are always at the bottom; ascending seat order walks around the
 *  table from you. */

export interface SeatPlacement {
  seat: number
  xPct: number
  yPct: number
  angleDeg: number
}

export type SeatLayoutMode = 'ring' | 'arc'

/** Ellipse the ring seats sit on, as % of the surface box. */
const RING_RX = 42
const RING_RY = 38

/** Small screens: opponents spread across the top arc instead; your own
 *  seat lives in the action dock below the table. The x-radius is tighter
 *  than the ring so seats at the arc's ends stay inside a phone viewport. */
const ARC_START = 205
const ARC_END = 335
const ARC_RX = 34
const ARC_RY = 40

function place(seat: number, angleDeg: number, rx: number, ry: number): SeatPlacement {
  const rad = (angleDeg * Math.PI) / 180
  return {
    seat,
    angleDeg,
    xPct: 50 + rx * Math.cos(rad),
    yPct: 50 + ry * Math.sin(rad),
  }
}

/**
 * Compute a placement for every seat rendered on the table surface.
 * `ring` (≥768px) places all seats — you included, at the bottom — on an
 * ellipse. `arc` (small screens) returns only your opponents, spread across
 * the top arc; your seat is not part of the surface in that mode.
 */
export function seatLayout(
  seats: number[],
  mySeat: number,
  mode: SeatLayoutMode,
): SeatPlacement[] {
  const sorted = [...seats].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return []
  const myIdx = Math.max(0, sorted.indexOf(mySeat))
  const relOf = (seat: number) => (sorted.indexOf(seat) - myIdx + n) % n

  if (mode === 'ring') {
    return sorted.map((seat) => place(seat, 90 + relOf(seat) * (360 / n), RING_RX, RING_RY))
  }

  const opponents = sorted.filter((seat) => seat !== mySeat)
  const m = opponents.length
  return opponents
    .sort((a, b) => relOf(a) - relOf(b))
    .map((seat, i) =>
      place(
        seat,
        m === 1 ? 270 : ARC_START + (i * (ARC_END - ARC_START)) / (m - 1),
        ARC_RX,
        ARC_RY,
      ),
    )
}
