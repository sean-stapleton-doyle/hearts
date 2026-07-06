import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'

/** Cards dealt per round: climbs 1→7, then back down. */
const CARDS_PER_ROUND = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]
const BRIDGE_ROUND = 7

/**
 * The shape of the game: 13 stacks of face-down cards growing to the
 * bridge round and shrinking back. Scrub grows the stacks left to right —
 * the game's whole arc in one pass of the thumb.
 */
export function RoundLadderSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(scope, (tl) => {
    tl.from('[data-round-bar]', {
      scaleY: 0,
      transformOrigin: '50% 100%',
      duration: 0.5,
      stagger: 0.06,
      ease: 'power2.out',
    }).from(
      '[data-bridge-badge]',
      { scale: 0, autoAlpha: 0, duration: 0.35, ease: 'back.out(2.2)' },
      '-=0.35',
    )
  })

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 01"
        title="Thirteen rounds"
        lead={
          <>
            <p>
              Hands grow one card at a time up to seven — the <strong>bridge round</strong> — then
              shrink back down to one. Every round you play exactly as many tricks as you hold
              cards.
            </p>
          </>
        }
      >
        <DemoFelt className="px-4 py-6 sm:px-6">
          <div aria-hidden="true" className="flex items-end justify-center gap-1 sm:gap-1.5">
            {CARDS_PER_ROUND.map((cards, i) => {
              const round = i + 1
              return (
                <div key={round} className="flex flex-col items-center gap-1.5">
                  {round === BRIDGE_ROUND ? (
                    <span
                      data-bridge-badge
                      className="rounded-full border-2 border-ink bg-chip px-1.5 py-0.5 font-display text-[0.55rem] font-extrabold uppercase tracking-wider shadow-hard-sm"
                    >
                      Bridge
                    </span>
                  ) : null}
                  <div data-round-bar className="flex flex-col gap-[3px]">
                    {Array.from({ length: cards }, (_, c) => (
                      <span
                        key={c}
                        className="h-[9px] w-4 rounded-[2px] border border-ink bg-paper shadow-hard-sm sm:w-5"
                      />
                    ))}
                  </div>
                  <span className="font-display text-[0.6rem] font-bold text-paper/80 tabular-nums">
                    {round}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-center font-display text-[0.65rem] font-bold uppercase tracking-widest text-paper/80">
            Cards per hand, rounds 1–13
          </p>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
