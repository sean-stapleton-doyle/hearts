import { useGSAP } from '@gsap/react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { PlayingCard } from '../components/Card'
import { gsap, prefersReducedMotion } from '../lib/anim'

export const Route = createFileRoute('/')({ component: HomePage })

const TITLE = 'Hearts'

function HomePage() {
  const scope = useRef<HTMLElement>(null)

  // Poster-style entrance, then quiet ambience. Enhancement only: the JSX is
  // authored in its final state and everything animates *from*, so reduced
  // motion (or any failure) just shows the finished landing page.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const tl = gsap.timeline()
      tl.from('[data-fan-card]', {
        y: -140,
        rotation: '+=24',
        autoAlpha: 0,
        duration: 0.55,
        stagger: 0.12,
        ease: 'back.out(1.4)',
      })
        .from(
          '[data-title-letter]',
          { y: 28, autoAlpha: 0, duration: 0.4, stagger: 0.05, ease: 'power3.out' },
          '-=0.2',
        )
        .from('[data-tagline]', { autoAlpha: 0, y: 12, duration: 0.35 }, '-=0.1')
        .from('[data-play-cta]', { scale: 0.85, autoAlpha: 0, duration: 0.4, ease: 'back.out(2)' })
        .from('[data-foot-links]', { autoAlpha: 0, duration: 0.3 }, '-=0.15')

      // Ambience: the fan sways on drifting phases, and the ace's center
      // pip beats — hearts are trump, the landing page may as well say so.
      gsap.utils.toArray<HTMLElement>('[data-fan-card]').forEach((card, i) => {
        gsap.to(card, {
          y: '+=5',
          rotation: '+=1.5',
          duration: 2.4 + i * 0.4,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          delay: 1 + i * 0.5,
        })
      })
      gsap
        .timeline({ repeat: -1, repeatDelay: 1.6, delay: 1.4 })
        .to('[data-heart-pip] .card__pip', { scale: 1.22, duration: 0.14, ease: 'power2.out' })
        .to('[data-heart-pip] .card__pip', { scale: 1, duration: 0.16, ease: 'power2.in' })
        .to('[data-heart-pip] .card__pip', { scale: 1.14, duration: 0.12, ease: 'power2.out' })
        .to('[data-heart-pip] .card__pip', { scale: 1, duration: 0.3, ease: 'power2.inOut' })
    },
    { scope },
  )

  return (
    <main
      ref={scope}
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center"
    >
      {/* Static route: these decorative cards are outside any Flip scope,
          so wrapper transforms are safe here. */}
      <div aria-hidden="true" className="flex items-end justify-center pb-2">
        <span data-fan-card className="translate-y-2 -rotate-12">
          <PlayingCard card={{ suit: 'Spades', rank: 'Queen' }} size="lg" />
        </span>
        <span data-fan-card data-heart-pip className="z-10 -mx-4">
          <PlayingCard card={{ suit: 'Hearts', rank: 'Ace' }} size="lg" />
        </span>
        <span data-fan-card className="translate-y-2 rotate-12">
          <PlayingCard card={{ suit: 'Diamonds', rank: 'Ten' }} size="lg" />
        </span>
      </div>

      <div>
        <h1 aria-label={TITLE} className="text-5xl">
          {TITLE.split('').map((letter, i) => (
            <span key={i} data-title-letter aria-hidden="true" className="inline-block">
              {letter}
            </span>
          ))}
        </h1>
        <p data-tagline className="mt-2 font-semibold text-mute">
          Bid, take tricks, hit your number exactly.
        </p>
      </div>

      <span data-play-cta>
        <Link
          to="/play"
          className="rounded-lg border-2 border-ink bg-trump px-10 py-3 font-display text-lg font-extrabold uppercase tracking-wider text-white shadow-hard hover:bg-trump-deep hover:no-underline"
        >
          Play
        </Link>
      </span>

      <p data-foot-links className="text-sm font-semibold text-mute">
        <Link to="/how-to-play">How to play</Link> · <Link to="/account">Account &amp; history</Link>
      </p>

      <footer
        data-foot-links
        className="font-display text-[0.65rem] font-bold uppercase tracking-[0.22em] text-mute"
      >
        Hearts was invented by Colin Shaw
      </footer>
    </main>
  )
}
