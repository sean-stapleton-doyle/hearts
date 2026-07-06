import { useGSAP } from '@gsap/react'
import { useRef } from 'react'

import { gsap, prefersReducedMotion } from '../../../lib/scroll-anim'
import { PlayingCard } from '../../Card'

/**
 * Page opener. The only section animated on load rather than on scroll —
 * the fanned trio pops in, then the copy, then a scroll cue that keeps
 * bobbing. Same decorative-cards-outside-any-Flip-scope pattern as the
 * home page, so the wrapper transforms are safe.
 */
export function HeroSection() {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const tl = gsap.timeline()
      tl.from('[data-hero-card]', {
        autoAlpha: 0,
        y: 44,
        scale: 0.7,
        duration: 0.5,
        stagger: 0.09,
        ease: 'back.out(1.6)',
      })
        .from(
          '[data-hero-copy]',
          { autoAlpha: 0, y: 16, duration: 0.4, stagger: 0.08, ease: 'power3.out' },
          '-=0.15',
        )
        .from('[data-scroll-cue]', { autoAlpha: 0, duration: 0.3 }, '-=0.1')
      gsap.to('[data-scroll-cue]', {
        y: 6,
        repeat: -1,
        yoyo: true,
        duration: 0.8,
        ease: 'sine.inOut',
        delay: 1.2,
      })
    },
    { scope },
  )

  return (
    <section ref={scope} className="flex flex-col items-center gap-6 pt-6 text-center">
      <div aria-hidden="true" className="flex items-end justify-center pb-2">
        <span data-hero-card className="translate-y-2 -rotate-12">
          <PlayingCard card={{ suit: 'Spades', rank: 'Queen' }} size="lg" />
        </span>
        <span data-hero-card className="z-10 -mx-4">
          <PlayingCard card={{ suit: 'Hearts', rank: 'Ace' }} size="lg" />
        </span>
        <span data-hero-card className="translate-y-2 rotate-12">
          <PlayingCard card={{ suit: 'Diamonds', rank: 'Ten' }} size="lg" />
        </span>
      </div>

      <div className="mx-auto max-w-md">
        <p
          data-hero-copy
          className="font-display text-xs font-bold uppercase tracking-[0.22em] text-mute"
        >
          A game by Colin Shaw
        </p>
        <h1 data-hero-copy className="mt-2 text-4xl sm:text-5xl">
          How to play
        </h1>
        <p data-hero-copy className="mt-3 font-semibold text-mute">
          Bid, take tricks, hit your number exactly. Scroll — the table will show you.
        </p>
      </div>

      <span data-scroll-cue aria-hidden="true" className="font-display text-2xl font-extrabold">
        ↓
      </span>
    </section>
  )
}
