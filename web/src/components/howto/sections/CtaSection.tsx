import { Link } from '@tanstack/react-router'
import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'

/** Send-off: same Play button as the landing page. */
export function CtaSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(
    scope,
    (tl) => {
      tl.from('[data-cta]', {
        autoAlpha: 0,
        y: 20,
        scale: 0.94,
        duration: 0.45,
        stagger: 0.1,
        ease: 'back.out(1.6)',
      })
    },
    { toggleActions: 'play none none reverse', start: 'top 85%' },
  )

  return (
    <section ref={scope} className="flex flex-col items-center gap-6 pb-6 text-center">
      <div data-cta className="mx-auto max-w-md">
        <h2 className="text-3xl">You know the rules</h2>
        <p className="mt-2 font-semibold text-mute">Now go hit your number.</p>
      </div>
      <span data-cta>
        <Link
          to="/play"
          className="rounded-lg border-2 border-ink bg-trump px-10 py-3 font-display text-lg font-extrabold uppercase tracking-wider text-white shadow-hard hover:bg-trump-deep hover:no-underline"
        >
          Play
        </Link>
      </span>
      <footer
        data-cta
        className="border-t-2 border-ink/15 pt-5 font-display text-[0.65rem] font-bold uppercase tracking-[0.22em] text-mute"
      >
        Hearts was invented by Colin Shaw
      </footer>
    </section>
  )
}
