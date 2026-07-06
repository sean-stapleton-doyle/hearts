import { useRef } from 'react'

import { gsap, useScrollScene } from '../../../lib/scroll-anim'
import type { Card } from '../../../lib/types'
import { PlayingCard } from '../../Card'
import { DeckStack } from '../DeckStack'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'

/** The trick from Rule 06, heading back under the deck in played order. */
const PLAYED: Card[] = [
  { suit: 'Spades', rank: 'Ten' },
  { suit: 'Spades', rank: 'King' },
  { suit: 'Hearts', rank: 'Three' },
  { suit: 'Spades', rank: 'Two' },
]

/**
 * The game's signature twist, given the closing pinned scene: the loop
 * arrow draws itself, then the round's played cards slide back under the
 * deck one at a time, in the order they were played.
 */
export function DeckLoopSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(
    scope,
    (tl) => {
      const root = scope.current
      const deck = root?.querySelector('[data-deck]')
      if (!root || !deck) return

      const path = root.querySelector<SVGPathElement>('[data-loop-arrow]')
      if (path) {
        const len = path.getTotalLength()
        gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })
        tl.to(path, { strokeDashoffset: 0, duration: 0.7, ease: 'power1.inOut' }, 0)
      }

      const deckRect = deck.getBoundingClientRect()
      root.querySelectorAll<HTMLElement>('[data-played-card]').forEach((el, i) => {
        const r = el.getBoundingClientRect()
        tl.to(
          el,
          {
            x: deckRect.left + deckRect.width / 2 - (r.left + r.width / 2),
            y: deckRect.top + deckRect.height / 2 - (r.top + r.height / 2) + 8,
            scale: 0.3,
            autoAlpha: 0,
            duration: 0.5,
            ease: 'power2.in',
          },
          0.5 + i * 0.3,
        )
      })
      tl.from('[data-loop-caption]', { autoAlpha: 0, y: 8, duration: 0.35 }, '+=0.1')
    },
    { pin: true, end: '+=130%' },
  )

  return (
    <div ref={scope}>
      <HowToSection
        kicker="The twist"
        title="The deck never reshuffles"
        lead={
          <>
            <p>
              The deck is shuffled <strong>once, at the start of the game — and never again</strong>.
              When a round ends, every played card goes back <em>under</em> the deck, trick by
              trick, in the order it was played.
            </p>
            <p>
              So the cards you watched leave the table are coming back, in an order you can
              reason about. Sharp players count. Sharper players remember.
            </p>
          </>
        }
      >
        <DemoFelt className="h-64">
          <div aria-hidden="true" className="absolute inset-0">
            <div data-deck className="absolute left-[18%] top-1/2 -translate-x-1/2 -translate-y-1/2">
              <DeckStack label="Deck" />
            </div>

            <div className="absolute right-[8%] top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
              <div className="flex items-end">
                {PLAYED.map((card, i) => (
                  <span
                    key={i}
                    data-played-card
                    className={i === 0 ? '' : '-ml-3'}
                    style={{ transform: `rotate(${(i % 2 ? 1 : -1) * 4}deg)`, zIndex: i }}
                  >
                    <PlayingCard card={card} size="sm" flipId={`howto-loop-${i}`} />
                  </span>
                ))}
              </div>
              <span className="font-display text-[0.6rem] font-bold uppercase tracking-widest text-paper/80">
                Played this round
              </span>
            </div>

            {/* Loop arrow: played cards → under the deck */}
            <svg
              className="absolute inset-x-0 bottom-3 mx-auto h-14 w-3/4"
              viewBox="0 0 300 56"
              fill="none"
              aria-hidden="true"
            >
              <path
                data-loop-arrow
                d="M 265 4 C 255 40, 60 52, 40 18"
                stroke="var(--color-chip)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M 33 30 L 40 14 L 50 26"
                stroke="var(--color-chip)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <p
              data-loop-caption
              className="absolute inset-x-4 top-3 text-center font-display text-[0.7rem] font-bold uppercase tracking-widest text-chip"
            >
              Same order out, same order back in.
            </p>
          </div>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
