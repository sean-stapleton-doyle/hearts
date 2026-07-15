import { useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '../lib/types'

/** How long a message lingers over its seat before fading out. */
const BUBBLE_LINGER_MS = 5000

/**
 * The latest *live* chat message per seat, for popping seat bubbles. "Live"
 * means arrived after this mount: the history GET seeds the log with backlog,
 * and without a baseline every one of those old messages would pop a bubble on
 * load. We snapshot the highest `id` present once the history has settled
 * (`ready`) and only surface messages past it. `messages` is already id-sorted
 * (see `mergeChat`), so the last match for a seat is its newest.
 *
 * Reconnect replay is a non-issue: `mergeChat` dedups by id and returns the
 * same array reference for a duplicate, so replayed messages never re-pop.
 */
export function useSeatBubbles(
  messages: ChatMessage[],
  ready: boolean,
): Record<number, ChatMessage | undefined> {
  // Null until the backlog has loaded; while null, nothing is "live" yet.
  const baseline = useRef<number | null>(null)
  if (baseline.current === null && ready) {
    baseline.current = messages.reduce((max, m) => Math.max(max, m.id), 0)
  }
  const cutoff = baseline.current
  const bySeat: Record<number, ChatMessage | undefined> = {}
  if (cutoff !== null) {
    for (const m of messages) {
      if (m.id > cutoff) bySeat[m.seat] = m
    }
  }
  return bySeat
}

/**
 * The transient overlay that pops the latest chat message over a seat and
 * fades it. The parent passes the seat's newest message; the timer is keyed on
 * `message.id`, so a fresh message re-arms the linger while an unchanged one
 * (a re-render for any other reason) does not re-show a bubble that already
 * faded.
 *
 * Renders by `kind`: `text` is a speech bubble with a tail; `react` is a bare,
 * larger emoji with a little pop — no bubble chrome, and it never lands in the
 * scrollback log. `below` flips the bubble under the seat for top-of-felt
 * opponents so it doesn't clip off the felt's top edge.
 */
export function SeatBubble({ message, below = false }: { message: ChatMessage | null; below?: boolean }) {
  const [shown, setShown] = useState<ChatMessage | null>(null)

  useEffect(() => {
    if (!message) return
    setShown(message)
    const t = setTimeout(() => setShown(null), BUBBLE_LINGER_MS)
    return () => clearTimeout(t)
  }, [message?.id])

  if (!shown) return null

  const react = shown.kind === 'react'
  const side = below ? 'seat-bubble--below' : ''
  const kind = react ? 'seat-bubble--react' : ''

  return (
    <div
      // `key` restarts the pop animation each time a new message shows.
      key={shown.id}
      className={`seat-bubble ${kind} ${side}`.trim()}
      role="status"
      title={react ? undefined : `${shown.name}: ${shown.body}`}
    >
      {shown.body}
    </div>
  )
}
