import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { useRef, type RefObject } from 'react'

gsap.registerPlugin(Flip)

export { gsap, Flip }

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const DEAL_STAGGER = 0.055 // seconds between consecutive cards leaving the dealer
const DEAL_FLIGHT = 0.3 // seconds a card spends in the air
const DEAL_MAX_CARDS_PER_SEAT = 6 // visual cap; big rounds stay ~2s total
const DEAL_FAILSAFE_MS = 4000

/**
 * Fly face-down cards from the dealer's seat to every player. Purely
 * decorative — the server has already dealt — so it animates disposable
 * clones in a fixed overlay (never the real cards, which belong to Flip)
 * and always resolves, even on failure or reduced motion.
 *
 * Seat positions are measured from the live `[data-seat]` elements; the
 * deal runs round-robin starting at the dealer's left, like a real deal.
 */
export function runDealAnimation(opts: {
  scope: HTMLElement
  dealerSeat: number
  seats: number[]
  cardsPerPlayer: number
}): Promise<void> {
  return new Promise((resolve) => {
    let layer: HTMLDivElement | null = null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      layer?.remove()
      resolve()
    }
    try {
      if (prefersReducedMotion()) return finish()

      const rects = new Map<number, DOMRect>()
      for (const seat of opts.seats) {
        const el = opts.scope.querySelector(`[data-seat="${seat}"]`)
        if (!el) return finish()
        rects.set(seat, el.getBoundingClientRect())
      }
      const origin = rects.get(opts.dealerSeat)
      if (!origin) return finish()

      layer = document.createElement('div')
      layer.className = 'deal-layer'
      document.body.appendChild(layer)

      // `.deal-card` sizes itself from the same `--card-w`/`--card-h` root
      // variables the real hand cards use (styles.css), so it always
      // matches — read them back here rather than hardcoding half-dims that
      // would silently drift out of sync with the CSS.
      const rootStyle = getComputedStyle(document.documentElement)
      const halfW = (parseFloat(rootStyle.getPropertyValue('--card-w')) || 58) / 2
      const halfH = (parseFloat(rootStyle.getPropertyValue('--card-h')) || 82) / 2

      const sorted = [...opts.seats].sort((a, b) => a - b)
      const dealerAt = sorted.indexOf(opts.dealerSeat)
      const order = sorted.map((_, k) => sorted[(dealerAt + 1 + k) % sorted.length])
      const passes = Math.max(1, Math.min(opts.cardsPerPlayer, DEAL_MAX_CARDS_PER_SEAT))
      const center = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2]
      const [ox, oy] = center(origin)

      const tl = gsap.timeline({ onComplete: finish })
      for (let pass = 0; pass < passes; pass++) {
        order.forEach((seat, k) => {
          const i = pass * order.length + k
          const [tx, ty] = center(rects.get(seat)!)
          const card = document.createElement('span')
          card.className = 'deal-card'
          layer!.appendChild(card)
          const at = i * DEAL_STAGGER
          tl.fromTo(
            card,
            { x: ox - halfW, y: oy - halfH, rotation: gsap.utils.random(-15, 15), autoAlpha: 1 },
            {
              x: tx - halfW + gsap.utils.random(-6, 6),
              y: ty - halfH + gsap.utils.random(-4, 4),
              rotation: gsap.utils.random(-8, 8),
              duration: DEAL_FLIGHT,
              ease: 'power2.out',
              immediateRender: false,
            },
            at,
          )
          tl.to(card, { autoAlpha: 0, duration: 0.18 }, at + DEAL_FLIGHT + 0.04)
        })
      }
      // Failsafe: never leave the table gated behind a wedged animation.
      setTimeout(finish, DEAL_FAILSAFE_MS)
    } catch {
      finish() // enhancement only
    }
  })
}

/**
 * Lift and tilt a card in the hand when the player selects it. Runs
 * independently of `useFlipLayout` — selection is local React state, not
 * part of `view`, so it never triggers a Flip pass — but tweens the same
 * `.card` element Flip later animates during flight; GSAP's default tween
 * overwrite management lets a flight tween cleanly take over from this one.
 * Enhancement only; skipped under `prefers-reduced-motion`.
 */
export function useSelectionLift(ref: RefObject<HTMLElement | null>, selected: boolean): void {
  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return
      gsap.to(ref.current, {
        y: selected ? -16 : 0,
        rotation: selected ? -8 : 0,
        scale: selected ? 1.05 : 1,
        duration: selected ? 0.22 : 0.18,
        ease: selected ? 'back.out(1.7)' : 'power2.out',
        overwrite: 'auto',
      })
    },
    { dependencies: [selected] },
  )
}

/**
 * Bridge React state changes into smooth GSAP Flip transitions for every
 * element carrying a `data-flip-id`. This is how a card "flies" from the
 * hand into the trick and back out as the trick is collected: the same
 * `data-flip-id` follows a card across containers, so Flip treats it as one
 * element moving. Newly-appearing cards (a dealt hand, an opponent's play)
 * fade/scale in; collected trick cards drift out.
 *
 * Motion is enhancement only — every call is guarded so it can never break
 * rendering, and `prefers-reduced-motion` skips it entirely.
 */
export function useFlipLayout(scope: RefObject<HTMLElement | null>, deps: unknown[]): void {
  const previous = useRef<Flip.FlipState | null>(null)
  useGSAP(
    () => {
      const targets = scope.current?.querySelectorAll<HTMLElement>('[data-flip-id]') ?? []
      try {
        if (previous.current && !prefersReducedMotion()) {
          Flip.from(previous.current, {
            targets,
            absolute: true,
            nested: true,
            scale: true,
            duration: 0.36,
            ease: 'power3.out',
            onEnter: (elements) =>
              gsap.from(elements, {
                autoAlpha: 0,
                scale: 0.72,
                y: 20,
                duration: 0.42,
                stagger: 0.04,
                ease: 'power3.out',
              }),
            onLeave: (elements) =>
              gsap.to(elements, {
                autoAlpha: 0,
                y: -22,
                scale: 0.84,
                duration: 0.32,
                ease: 'power2.in',
              }),
          })
        }
      } catch {
        /* enhancement only */
      }
      try {
        previous.current = Flip.getState(targets)
      } catch {
        previous.current = null
      }
    },
    { scope, dependencies: deps },
  )
}
