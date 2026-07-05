import { useEffect, useState } from 'react'

/**
 * Cosmetic turn countdown, seeded from the view's `turn_deadline_in_secs`.
 * Re-seeds whenever the deadline changes (every view refresh), exactly like
 * the CLI's `App::reset_deadline` — the server is the actual enforcer.
 */
export function useCountdown(deadlineInSecs: number | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(deadlineInSecs ?? null)

  useEffect(() => {
    if (deadlineInSecs == null) {
      setRemaining(null)
      return
    }
    setRemaining(deadlineInSecs)
    const startedAt = Date.now()
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setRemaining(Math.max(0, deadlineInSecs - elapsed))
    }, 1000)
    return () => clearInterval(interval)
  }, [deadlineInSecs])

  return remaining
}
