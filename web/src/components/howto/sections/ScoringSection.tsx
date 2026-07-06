import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import { BidChip } from '../BidChip'
import { HowToSection } from '../HowToSection'
import { ScoreTicker, formatDelta } from '../ScoreTicker'
import { TricksPile } from '../../TricksPile'

/** The spec's round-5 result: three made bids, one miss. */
const HEAD = 'font-display text-[0.65rem] font-bold uppercase tracking-widest text-mute'

const RESULTS = [
  { name: 'Ava', bid: 2, tricks: 2, delta: 3 },
  { name: 'Ben', bid: 1, tricks: 1, delta: 2 },
  { name: 'Cleo', bid: 1, tricks: 1, delta: 2 },
  { name: 'Dee', bid: 2, tricks: 1, delta: -1 },
]

/**
 * Scoring: a mini score sheet whose deltas count up from zero as it
 * scrolls in. Rows and numbers are authored at their final values — the
 * count-up is layered on top, so the static render is the finished sheet.
 */
export function ScoringSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(scope, (tl) => {
    tl.from('[data-score-row]', {
      autoAlpha: 0,
      y: 14,
      duration: 0.35,
      stagger: 0.15,
      ease: 'power3.out',
    })
    scope.current?.querySelectorAll<HTMLElement>('[data-score-final]').forEach((el, i) => {
      const target = Number(el.dataset.scoreFinal)
      const proxy = { v: 0 }
      // fromTo + immediateRender so the ticker reads 0 from the first
      // scrubbed frame, not its authored final value.
      tl.fromTo(
        proxy,
        { v: 0 },
        {
          v: target,
          duration: 0.5,
          ease: 'power1.out',
          immediateRender: true,
          onUpdate: () => {
            el.textContent = formatDelta(Math.round(proxy.v))
          },
        },
        0.35 + i * 0.15,
      )
    })
    tl.from('[data-formula]', { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.12 })
  })

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 07"
        title="Hit your number"
        lead={
          <>
            <p>
              <strong>Exact bid: tricks + 1 point.</strong> A made bid of zero still pays +1.
              Miss in either direction and you <em>lose</em> the gap — overtricks hurt exactly as
              much as coming up short.
            </p>
            <p>Scores run across all 13 rounds, and yes, they go negative.</p>
          </>
        }
      >
        <div className="rounded-xl border-2 border-ink bg-paper p-4 shadow-hard sm:p-5">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-1 sm:gap-x-6">
            <span className={HEAD}>Player</span>
            <span className={`${HEAD} text-center`}>Bid</span>
            <span className={`${HEAD} text-center`}>Won</span>
            <span className={`${HEAD} text-right`}>Score</span>
            {RESULTS.map(({ name, bid, tricks, delta }) => (
              <div key={name} data-score-row className="col-span-4 grid grid-cols-subgrid items-center border-t border-ink/15 py-1.5">
                <span className="font-display text-sm font-extrabold uppercase tracking-wide">
                  {name}
                </span>
                <span className="justify-self-center">
                  <BidChip value={bid} variant={bid === tricks ? 'made' : 'default'} />
                </span>
                <span className="justify-self-center">
                  <TricksPile count={tricks} size="xs" />
                </span>
                <span className="justify-self-end">
                  <ScoreTicker value={delta} />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <span
              data-formula
              className="rounded-full border-2 border-ink bg-felt px-3 py-1 font-display text-[0.65rem] font-extrabold uppercase tracking-wider text-paper shadow-hard-sm"
            >
              Made it: tricks + 1
            </span>
            <span
              data-formula
              className="rounded-full border-2 border-ink bg-trump px-3 py-1 font-display text-[0.65rem] font-extrabold uppercase tracking-wider text-white shadow-hard-sm"
            >
              Missed: −gap
            </span>
          </div>
        </div>
      </HowToSection>
    </div>
  )
}
