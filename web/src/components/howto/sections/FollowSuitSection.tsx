import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import type { Card } from '../../../lib/types'
import { PlayingCard } from '../../Card'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'

/** Diamonds led; the two diamonds in hand are the only legal plays. */
const HAND: { card: Card; legal: boolean }[] = [
  { card: { suit: 'Clubs', rank: 'Jack' }, legal: false },
  { card: { suit: 'Diamonds', rank: 'Nine' }, legal: true },
  { card: { suit: 'Diamonds', rank: 'Queen' }, legal: true },
  { card: { suit: 'Spades', rank: 'Ace' }, legal: false },
  { card: { suit: 'Hearts', rank: 'Five' }, legal: false },
]

/**
 * Follow suit, shown with the game's own legality visuals: the hand fans in
 * and the legal diamonds wear the same blue ring they do at the real table.
 * Plays on enter (not scrubbed) — this one reads as a single beat.
 */
export function FollowSuitSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(
    scope,
    (tl) => {
      tl.from('[data-led-card]', { y: -24, autoAlpha: 0, duration: 0.4, ease: 'power3.out' })
        .from('[data-hand-card]', {
          y: 24,
          autoAlpha: 0,
          duration: 0.4,
          stagger: 0.06,
          ease: 'power3.out',
        })
        .to('[data-legal-card]', {
          scale: 1.07,
          yoyo: true,
          repeat: 1,
          duration: 0.18,
          stagger: 0.12,
        })
    },
    { toggleActions: 'play none none reverse' },
  )

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 05"
        title="Follow the led suit"
        lead={
          <>
            <p>
              The first card of a trick sets the <strong>led suit</strong>, and everyone who holds
              that suit must play it. Diamonds led? Your diamonds are your only legal plays.
            </p>
            <p>
              Out of the led suit entirely? Then play <em>anything</em> — dump a dead card, or
              drop a heart and steal the trick.
            </p>
          </>
        }
      >
        <DemoFelt className="pointer-events-none px-4 py-6">
          <div aria-hidden="true" className="flex flex-col items-center gap-5">
            <div className="flex flex-col items-center gap-1.5">
              <span data-led-card>
                <PlayingCard
                  card={{ suit: 'Diamonds', rank: 'King' }}
                  flipId="howto-follow-led"
                />
              </span>
              <span className="font-display text-[0.6rem] font-bold uppercase tracking-widest text-paper/80">
                Led
              </span>
            </div>
            <div className="flex items-end justify-center">
              {HAND.map(({ card, legal }, i) => (
                <span
                  key={i}
                  data-hand-card
                  data-legal-card={legal ? '' : undefined}
                  className={i === 0 ? '' : '-ml-3'}
                >
                  <PlayingCard
                    card={card}
                    interactive
                    legal={legal}
                    flipId={`howto-follow-${i}`}
                  />
                </span>
              ))}
            </div>
          </div>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
