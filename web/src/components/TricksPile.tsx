// Total horizontal room (px) the fan is allowed to spread across, matching
// `.tricks__stack`'s width in styles.css (card width + this). Kept as a
// constant rather than truncating the stack: real trick piles never lose a
// card, they just squeeze tighter as they grow, up to a 26-card round.
const MAX_SPREAD_PX = 26
const ROTATE_DEG = 4

/** A player's won-tricks pile: one face-down card per trick, fanned
 *  diagonally — how a trick actually gets picked up and stacked at the
 *  table — plus a numeric chip so the count is exact once the fan gets too
 *  dense to eyeball. The per-card offset compresses as the count grows, so
 *  the pile never outgrows its footprint on the seat regardless of how many
 *  tricks are stacked. Empty rounds render a faint placeholder so the seat
 *  card's height stays stable. */
export function TricksPile({ count, size = 'sm' }: { count: number; size?: 'xs' | 'sm' }) {
  const step = count > 1 ? Math.min(4, MAX_SPREAD_PX / (count - 1)) : 0

  return (
    <div
      className={`tricks tricks--${size}`}
      role="img"
      aria-label={`${count} ${count === 1 ? 'trick' : 'tricks'} won`}
    >
      {count === 0 ? (
        <span className="tricks__empty" data-testid="tricks-empty" />
      ) : (
        <>
          <span className="tricks__stack">
            {Array.from({ length: count }, (_, i) => (
              <span
                key={i}
                className="tricks__card"
                data-testid="tricks-card"
                style={{
                  transform: `translate(${i * step}px, ${i * -step * 0.75}px) rotate(${(i % 2 ? 1 : -1) * ROTATE_DEG}deg)`,
                  zIndex: i,
                }}
              />
            ))}
          </span>
          <span className="tricks__count">{count}</span>
        </>
      )}
    </div>
  )
}
