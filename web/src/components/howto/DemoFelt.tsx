import type { ReactNode } from 'react'

/**
 * The mini card table every demo plays out on: a flat felt panel with the
 * poster treatment (hard ink border + offset shadow). `overflow-hidden` is
 * load-bearing — flying demo cards start well outside their resting spots
 * and must never widen the page on small screens.
 */
export function DemoFelt({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 border-ink bg-felt shadow-hard ${className}`}
    >
      {children}
    </div>
  )
}
