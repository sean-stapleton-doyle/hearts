import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'
import { PlayingCard } from '../../Card'

/**
 * The one rule that colors the whole game: hearts are permanent trump. A
 * proud ace of spades gets beaten by the lowliest heart in the deck.
 */
export function TrumpSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(scope, (tl) => {
    // The ace's entrance deliberately doesn't touch opacity — its later dim
    // owns that property (two from-tweens on one property fight at build).
    tl.from('[data-ace]', { x: -60, scale: 1.15, duration: 0.45, ease: 'power3.out' })
      .from(
        '[data-heart]',
        { x: 150, rotation: 14, autoAlpha: 0, duration: 0.5, ease: 'power2.out' },
        '+=0.2',
      )
      // The ace dims in defeat — a gentler dim than the game's non-legal
      // 0.38, which washes a paper card out completely against the felt.
      .from('[data-ace]', { opacity: 1, duration: 0.3 }, '-=0.15')
      .from('[data-wins-stamp]', { scale: 0, autoAlpha: 0, duration: 0.4, ease: 'back.out(2.5)' })
  })

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 04"
        title="Hearts are always trump"
        lead={
          <>
            <p>
              There is no trump card to flip, no suit of the round. <strong>Every heart beats
              every non-heart</strong>, always — the 3♥ takes down the A♠. Among hearts, highest
              wins.
            </p>
            <p>And yes: you may lead a heart whenever you like.</p>
          </>
        }
      >
        <DemoFelt className="flex items-center justify-center px-4 py-10">
          <div aria-hidden="true" className="relative flex items-center justify-center">
            <span data-ace className="opacity-60">
              <PlayingCard card={{ suit: 'Spades', rank: 'Ace' }} size="lg" flipId="howto-trump-a" />
            </span>
            <span data-heart className="z-10 -ml-8 -rotate-6">
              <PlayingCard
                card={{ suit: 'Hearts', rank: 'Three' }}
                size="lg"
                flipId="howto-trump-h"
              />
            </span>
            <span
              data-wins-stamp
              className="absolute -bottom-3 left-1/2 z-20 -translate-x-1/2 -rotate-3 rounded-md border-2 border-ink bg-chip px-2 py-0.5 font-display text-xs font-extrabold uppercase tracking-widest shadow-hard-sm"
            >
              Wins
            </span>
          </div>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
