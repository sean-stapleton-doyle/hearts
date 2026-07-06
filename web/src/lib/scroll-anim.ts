// ScrollTrigger wiring for the scroll-driven "How to play" tutorial. Kept
// out of lib/anim.ts on purpose: anim.ts is imported by the game table, and
// the router plugin's autoCodeSplitting splits per route — only /how-to-play
// imports this module, so ScrollTrigger never lands in the game bundle.
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { RefObject } from 'react'

import { prefersReducedMotion } from './anim'

gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }
export { prefersReducedMotion } from './anim'

export interface ScrollSceneOptions {
  /** Pin the trigger element while the timeline scrubs. */
  pin?: boolean
  /** Scrub smoothing in seconds (default 0.6). Ignored with toggleActions. */
  scrub?: number
  start?: string
  end?: string
  /** Switches the scene from scrubbed to play-on-enter (scrub disabled). */
  toggleActions?: string
}

/**
 * One scrubbed (or play-on-enter) GSAP timeline tied to a tutorial panel.
 * Enhancement only, same contract as everything in anim.ts: sections author
 * their JSX in its final, most-informative state and `build` animates *from*
 * offsets — so under prefers-reduced-motion (where `build` never runs) or on
 * any failure the panel simply renders complete and static.
 *
 * Runs through useGSAP so the context auto-reverts tweens and kills the
 * ScrollTrigger (pin spacers included) when the route unmounts.
 */
export function useScrollScene(
  scope: RefObject<HTMLElement | null>,
  build: (tl: gsap.core.Timeline) => void,
  opts: ScrollSceneOptions = {},
): void {
  useGSAP(
    () => {
      if (!scope.current || prefersReducedMotion()) return
      try {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: scope.current,
            // Pinned scenes hold near the top of the viewport so the whole
            // story stays visible; unpinned ones start as they scroll in.
            start: opts.start ?? (opts.pin ? 'top 12%' : 'top 70%'),
            end: opts.end ?? (opts.pin ? '+=120%' : 'bottom 55%'),
            scrub: opts.toggleActions ? undefined : (opts.scrub ?? 0.6),
            pin: opts.pin ?? false,
            toggleActions: opts.toggleActions,
          },
        })
        build(tl)
      } catch {
        /* enhancement only */
      }
    },
    { scope },
  )
}
