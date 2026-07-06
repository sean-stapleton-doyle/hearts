import type { CSSProperties } from 'react'

const SIZE = {
  xs: 'h-[26px] w-[18px] rounded-[3px] border',
  sm: 'h-[48px] w-[34px] rounded-md border-2',
  md: 'h-[64px] w-[46px] rounded-lg border-2',
} as const

/**
 * A face-down card, drawn to match the imperative `.deal-card` ghosts from
 * lib/anim.ts (flat trump-red back, ink border, hard shadow) but as a
 * declarative element the tutorial can lay out and animate. Purely
 * decorative wherever it appears, hence no aria contract of its own —
 * containers mark whole clusters aria-hidden.
 */
export function CardBack({
  size = 'sm',
  className = '',
  style,
}: {
  size?: keyof typeof SIZE
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`block border-ink bg-trump shadow-hard-sm ${SIZE[size]} ${className}`}
      style={style}
    />
  )
}
