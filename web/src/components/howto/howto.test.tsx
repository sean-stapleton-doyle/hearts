import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// jsdom has no layout for ScrollTrigger to measure, so no-op the scene hook
// entirely: sections then render exactly what a reduced-motion visitor sees
// — the authored, final, static state — which is what these tests assert.
vi.mock('../../lib/scroll-anim', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/scroll-anim')>()
  return { ...mod, useScrollScene: () => {}, prefersReducedMotion: () => true }
})

import { BiddingSection } from './sections/BiddingSection'
import { RoundLadderSection } from './sections/RoundLadderSection'
import { ScoringSection } from './sections/ScoringSection'
import { TrickNoHeartSection, TrickSection } from './sections/TrickSection'

// vitest globals are off, so RTL's auto-cleanup never registers itself.
afterEach(cleanup)

describe('how-to-play sections (static / reduced-motion render)', () => {
  it('shows the round shape up to the bridge', () => {
    render(<RoundLadderSection />)
    expect(screen.getByRole('heading', { name: /thirteen rounds/i })).toBeDefined()
    expect(screen.getByText('Bridge')).toBeDefined()
  })

  it('teaches the hook with the forbidden bid visible', () => {
    render(<BiddingSection />)
    expect(screen.getByRole('heading', { name: /bid your tricks/i })).toBeDefined()
    // The spec's example: bids sum to 4 of 5 tricks, so 1 is forbidden.
    expect(screen.getByText(/anything but 1/i)).toBeDefined()
    expect(screen.getByText('✕')).toBeDefined()
  })

  it('shows the worked trick with the heart winning', () => {
    render(<TrickSection />)
    expect(screen.getByText(/3♥ beats them all/i)).toBeDefined()
    expect(screen.getByText(/Cleo takes the trick/i)).toBeDefined()
  })

  it('shows the no-heart trick won by the led suit', () => {
    render(<TrickNoHeartSection />)
    expect(screen.getByText(/highest spade wins/i)).toBeDefined()
    expect(screen.getByText(/Ben collects the trick/i)).toBeDefined()
  })

  it('renders the spec scoring example at final values', () => {
    render(<ScoringSection />)
    expect(screen.getByText('+3')).toBeDefined()
    expect(screen.getAllByText('+2')).toHaveLength(2)
    expect(screen.getByText('-1')).toBeDefined()
    expect(screen.getByText(/made it: tricks \+ 1/i)).toBeDefined()
  })
})
