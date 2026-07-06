import { useCountdown } from '../hooks/useCountdown'

/** Cosmetic turn timer as a depleting ring + mm:ss readout. The server is the
 *  real enforcer; this just visualizes `turn_deadline_in_secs`. */
export function Countdown({
  deadlineInSecs,
  totalInSecs,
  active,
}: {
  deadlineInSecs: number
  /** The full turn budget the ring depletes from (server-configured). */
  totalInSecs: number
  active: boolean
}) {
  const secs = useCountdown(deadlineInSecs) ?? 0
  const frac = Math.max(0, Math.min(1, secs / totalInSecs))
  const r = 12
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - frac)
  const low = secs <= 30

  return (
    <div className={`countdown ${active ? 'is-active' : ''} ${low ? 'is-low' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 28 28" className="countdown__ring">
        <circle cx="14" cy="14" r={r} className="countdown__track" />
        <circle
          cx="14"
          cy="14"
          r={r}
          className="countdown__fill"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 14 14)"
        />
      </svg>
      <span className="countdown__label">{formatTime(secs)}</span>
    </div>
  )
}

function formatTime(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
