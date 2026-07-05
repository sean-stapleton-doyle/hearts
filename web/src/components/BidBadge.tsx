/** A player's bid for the round, shown as a small badge on their seat.
 *  `null` (hasn't bid yet) renders a bare "?" — an ellipsis read as "still
 *  loading" rather than "hasn't bid", which is what it actually means. On
 *  the active (trump red) seat the badge flips to chip gold so it stays
 *  legible. */
export function BidBadge({
  bid,
  active = false,
}: {
  bid: number | null
  active?: boolean
}) {
  const look = active
    ? 'border-2 border-ink bg-chip text-ink'
    : bid == null
      ? 'border border-ink/30 text-current opacity-70'
      : 'border-2 border-ink bg-ink text-paper'
  return (
    <span
      className={`inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-bold tabular-nums ${look}`}
      title={bid == null ? 'no bid yet' : `bid ${bid}`}
      aria-label={bid == null ? 'no bid yet' : `bid ${bid}`}
    >
      {bid ?? '?'}
    </span>
  )
}
