const VARIANT = {
  default: 'bg-paper text-ink',
  /** The hook: a bid the last player is not allowed to pick. */
  forbidden: 'bg-paper text-trump line-through decoration-2',
  /** A made bid — winner gold, same accent as the dealer button. */
  made: 'bg-chip text-ink',
} as const

/** A poker-chip-shaped bid marker. */
export function BidChip({
  value,
  variant = 'default',
  className = '',
}: {
  value: number
  variant?: keyof typeof VARIANT
  className?: string
}) {
  return (
    <span
      className={`inline-grid h-8 w-8 place-items-center rounded-full border-2 border-ink font-display text-sm font-extrabold shadow-hard-sm ${VARIANT[variant]} ${className}`}
    >
      {value}
    </span>
  )
}
