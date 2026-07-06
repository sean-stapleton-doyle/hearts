/** Signed score formatting shared by the static render and the GSAP
 *  count-up (ScoringSection reads `data-score-final` and rewrites
 *  textContent through this same function, so both paths agree). */
export function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/**
 * A round-score delta the scoring demo counts up from zero. Authored at its
 * final value — under reduced motion (or before the timeline mounts) the
 * real number is simply there.
 */
export function ScoreTicker({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span
      data-score-final={value}
      className={`font-display text-lg font-extrabold tabular-nums ${
        value >= 0 ? 'text-felt' : 'text-trump'
      } ${className}`}
    >
      {formatDelta(value)}
    </span>
  )
}
