import { describe, expect, it } from 'vitest'

import { seatLayout } from './seatLayout'

describe('seatLayout', () => {
  it('puts you at the bottom center of the ring for every table size', () => {
    for (let n = 2; n <= 7; n++) {
      const seats = Array.from({ length: n }, (_, i) => i)
      const layout = seatLayout(seats, 0, 'ring')
      expect(layout).toHaveLength(n)
      const me = layout.find((p) => p.seat === 0)!
      expect(me.xPct).toBeCloseTo(50, 5)
      expect(me.yPct).toBeGreaterThan(80)
    }
  })

  it('keeps you at the bottom regardless of which seat is yours', () => {
    const layout = seatLayout([0, 1, 2, 3], 2, 'ring')
    const me = layout.find((p) => p.seat === 2)!
    expect(me.xPct).toBeCloseTo(50, 5)
    expect(me.yPct).toBeGreaterThan(80)
  })

  it('gives every seat a distinct placement', () => {
    for (let n = 2; n <= 7; n++) {
      const seats = Array.from({ length: n }, (_, i) => i)
      for (const mode of ['ring', 'arc'] as const) {
        const layout = seatLayout(seats, 0, mode)
        const keys = new Set(layout.map((p) => `${p.xPct.toFixed(2)},${p.yPct.toFixed(2)}`))
        expect(keys.size).toBe(layout.length)
      }
    }
  })

  it('excludes your seat from the arc and keeps opponents in the top half', () => {
    for (let n = 2; n <= 7; n++) {
      const seats = Array.from({ length: n }, (_, i) => i)
      const layout = seatLayout(seats, 0, 'arc')
      expect(layout).toHaveLength(n - 1)
      expect(layout.some((p) => p.seat === 0)).toBe(false)
      for (const p of layout) expect(p.yPct).toBeLessThan(50)
    }
  })

  it('handles non-contiguous seat numbers', () => {
    const layout = seatLayout([1, 3, 5], 3, 'ring')
    expect(layout.map((p) => p.seat).sort()).toEqual([1, 3, 5])
    const me = layout.find((p) => p.seat === 3)!
    expect(me.yPct).toBeGreaterThan(80)
  })
})
