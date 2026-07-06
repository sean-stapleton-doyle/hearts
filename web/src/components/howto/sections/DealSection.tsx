import { useRef } from 'react'

import { gsap, useScrollScene } from '../../../lib/scroll-anim'
import type { Card } from '../../../lib/types'
import { PlayingCard } from '../../Card'
import { CardBack } from '../CardBack'
import { DeckStack } from '../DeckStack'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'
import { SeatChip } from '../SeatChip'

/** Your revealed hand in the demo's 3-card round. */
const YOUR_HAND: Card[] = [
  { suit: 'Clubs', rank: 'Nine' },
  { suit: 'Spades', rank: 'King' },
  { suit: 'Hearts', rank: 'Four' },
]

/** Small fan of face-down cards parked at an opponent's seat. Deal order
 *  indices (`data-di`) interleave across seats — one card at a time around
 *  the table, matching the real deal — so they're wired per card here. */
function SeatFan({ dis }: { dis: [number, number, number] }) {
  return (
    <span className="relative block h-[48px] w-[62px]">
      {dis.map((di, j) => (
        <CardBack
          key={di}
          size="sm"
          data-deal-card
          data-di={di}
          className="absolute top-0"
          style={{ left: j * 14, transform: `rotate(${(j - 1) * 7}deg)`, zIndex: j }}
        />
      ))}
    </span>
  )
}

/**
 * The deal, played out on a pinned mini table: card backs fly off the deck
 * one at a time round-robin (dealer's left first), and your three land
 * face-up. Flight deltas are measured from the live layout at mount — same
 * approach as runDealAnimation — so the demo stays honest at every
 * viewport width.
 */
export function DealSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(
    scope,
    (tl) => {
      const root = scope.current
      const deck = root?.querySelector('[data-deck]')
      if (!root || !deck) return
      const deckRect = deck.getBoundingClientRect()
      const [dcx, dcy] = [deckRect.left + deckRect.width / 2, deckRect.top + deckRect.height / 2]

      const cards = Array.from(
        root.querySelectorAll<HTMLElement>('[data-deal-card], [data-deal-ghost]'),
      ).sort((a, b) => Number(a.dataset.di) - Number(b.dataset.di))

      for (const el of cards) {
        const di = Number(el.dataset.di)
        const r = el.getBoundingClientRect()
        const at = di * 0.12
        const flight = {
          x: dcx - (r.left + r.width / 2),
          y: dcy - (r.top + r.height / 2),
          rotation: gsap.utils.random(-14, 14),
        }
        if (el.dataset.dealGhost === undefined) {
          tl.from(el, { ...flight, duration: 0.35, ease: 'power2.out' }, at)
        } else {
          // Your three cards: the back is authored invisible (the final
          // state is the revealed hand), so its flight is a fromTo that
          // keeps it solid until it lands, then it crossfades into the
          // pre-placed face-up card.
          const face = root.querySelector(`[data-your-card="${el.dataset.hand}"]`)
          tl.fromTo(
            el,
            { ...flight, autoAlpha: 1 },
            { x: 0, y: 0, rotation: 0, autoAlpha: 1, duration: 0.35, ease: 'power2.out' },
            at,
          )
          tl.to(el, { autoAlpha: 0, duration: 0.18 }, at + 0.35)
          if (face) tl.from(face, { autoAlpha: 0, duration: 0.18 }, at + 0.35)
        }
      }
    },
    { pin: true, end: '+=140%' },
  )

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 02"
        title="The deal"
        lead={
          <p>
            The dealer hands out cards <strong>one at a time, off the top of the deck</strong>,
            starting at their left. Whatever the deck doesn't deal sits out for the round. The deal
            passes clockwise every round.
          </p>
        }
      >
        <DemoFelt className="h-80">
          <div aria-hidden="true" className="absolute inset-0">
            {/* North */}
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
              <SeatChip name="North" />
              <SeatFan dis={[1, 5, 9]} />
            </div>
            {/* West */}
            <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
              <SeatChip name="West" />
              <SeatFan dis={[0, 4, 8]} />
            </div>
            {/* East */}
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
              <SeatChip name="East" />
              <SeatFan dis={[2, 6, 10]} />
            </div>
            {/* The deck */}
            <div data-deck className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
              <DeckStack label="Deck" />
            </div>
            {/* You: face-up hand, plus the flying backs that reveal it */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
              <div className="relative flex items-end gap-1">
                {YOUR_HAND.map((card, j) => (
                  <span key={j} data-your-card={j} className="relative">
                    <PlayingCard card={card} size="sm" flipId={`howto-deal-${j}`} />
                  </span>
                ))}
                {/* Ghost backs: authored invisible (final state is the revealed
                    hand); the timeline flies them in and crossfades. */}
                {YOUR_HAND.map((_, j) => (
                  <CardBack
                    key={j}
                    size="sm"
                    data-deal-ghost
                    data-di={3 + j * 4}
                    data-hand={j}
                    className="absolute bottom-1 opacity-0"
                    style={{ left: j * 50 + 6 }}
                  />
                ))}
              </div>
              <SeatChip name="You" dealer />
            </div>
          </div>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
