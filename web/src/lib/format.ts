/** Score delta with an explicit sign for gains: `+3`, `0`, `-2`. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`
}
