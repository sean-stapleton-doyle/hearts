import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useSeatBubbles } from './SeatBubble'
import type { ChatMessage } from '../lib/types'

const msg = (id: number, seat: number): ChatMessage => ({
  id,
  seat,
  kind: 'text',
  name: `p${seat}`,
  body: `m${id}`,
  sent_at: '2026-07-15T00:00:00Z',
})

describe('useSeatBubbles', () => {
  it('surfaces nothing until the history has settled', () => {
    const { result } = renderHook(({ msgs }) => useSeatBubbles(msgs, false), {
      initialProps: { msgs: [msg(1, 0), msg(2, 1)] },
    })
    expect(result.current).toEqual({})
  })

  it('does not pop pre-load backlog, only messages after the baseline', () => {
    const backlog = [msg(1, 0), msg(2, 1)]
    const { result, rerender } = renderHook(({ msgs }) => useSeatBubbles(msgs, true), {
      initialProps: { msgs: backlog },
    })
    // Backlog present at the moment history settled: no bubbles.
    expect(result.current).toEqual({})

    // A live message arrives after the baseline — it surfaces for its seat.
    rerender({ msgs: [...backlog, msg(3, 0)] })
    expect(result.current[0]?.id).toBe(3)
    expect(result.current[1]).toBeUndefined()
  })

  it('keeps only the newest live message per seat', () => {
    const { result, rerender } = renderHook(({ msgs }) => useSeatBubbles(msgs, true), {
      initialProps: { msgs: [] as ChatMessage[] },
    })
    rerender({ msgs: [msg(1, 0), msg(2, 0), msg(3, 1)] })
    expect(result.current[0]?.id).toBe(2)
    expect(result.current[1]?.id).toBe(3)
  })
})
