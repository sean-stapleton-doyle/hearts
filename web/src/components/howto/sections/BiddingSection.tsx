import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import { BidChip } from '../BidChip'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'
import { SeatChip } from '../SeatChip'

/** The spec's own round-5 hook example: A=2, B=1, C=1 → D may not bid 1. */
const PLACED_BIDS = [
  { name: 'Ava', bid: 2, dealer: true },
  { name: 'Ben', bid: 1, dealer: false },
  { name: 'Cleo', bid: 1, dealer: false },
] as const
const CANDIDATE_BIDS = [0, 1, 2, 3, 4, 5]
const FORBIDDEN = 1

/**
 * Bidding and the hook, on a pinned felt: the first three bids pop in one
 * by one, the running total lands, then the last bidder's options fan out
 * and the forbidden one gets stamped out.
 */
export function BiddingSection() {
  const scope = useRef<HTMLDivElement>(null)

  useScrollScene(
    scope,
    (tl) => {
      tl.from('[data-seat-bid]', {
        scale: 0,
        autoAlpha: 0,
        duration: 0.4,
        stagger: 0.45,
        ease: 'back.out(2)',
      })
        .from('[data-bid-total]', { autoAlpha: 0, y: 10, duration: 0.35 })
        .from('[data-candidate]', {
          y: 16,
          autoAlpha: 0,
          duration: 0.3,
          stagger: 0.08,
          ease: 'power3.out',
        })
        .from('[data-forbidden-mark]', {
          scale: 0,
          autoAlpha: 0,
          duration: 0.4,
          ease: 'back.out(2.5)',
        })
        .from('[data-hook-caption]', { autoAlpha: 0, y: 8, duration: 0.35 })
    },
    { pin: true, end: '+=140%' },
  )

  return (
    <div ref={scope}>
      <HowToSection
        kicker="Rule 03"
        title="Bid your tricks"
        lead={
          <>
            <p>
              Before a card hits the felt, everyone predicts how many tricks they'll win — dealer
              first, then around the table. Any number from zero up to the hand size goes.
            </p>
            <p>
              <strong>Except one.</strong> The last bidder may not bring the total to exactly the
              number of tricks. That's <strong>the hook</strong>: the bids can never all come true.
            </p>
          </>
        }
      >
        <DemoFelt className="px-4 py-6 sm:px-6">
          <div aria-hidden="true" className="flex flex-col items-center gap-5">
            <div className="flex items-start justify-center gap-3 sm:gap-6">
              {PLACED_BIDS.map(({ name, bid, dealer }) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <SeatChip name={name} dealer={dealer} />
                  <span data-seat-bid>
                    <BidChip value={bid} />
                  </span>
                </div>
              ))}
              <div className="flex flex-col items-center gap-2">
                <SeatChip name="Dee" />
                <span className="font-display text-lg font-extrabold text-paper">?</span>
              </div>
            </div>

            <p
              data-bid-total
              className="font-display text-[0.7rem] font-bold uppercase tracking-widest text-paper"
            >
              Bids so far: 4 · Tricks in round: 5
            </p>

            <div className="flex flex-col items-center gap-2.5">
              <div className="flex items-center gap-2">
                {CANDIDATE_BIDS.map((v) => (
                  <span key={v} data-candidate className="relative">
                    <BidChip value={v} variant={v === FORBIDDEN ? 'forbidden' : 'default'} />
                    {v === FORBIDDEN ? (
                      <span
                        data-forbidden-mark
                        className="absolute -right-1.5 -top-1.5 inline-grid h-4 w-4 place-items-center rounded-full border border-ink bg-trump font-display text-[0.6rem] font-extrabold text-white shadow-hard-sm"
                      >
                        ✕
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
              <p
                data-hook-caption
                className="text-center font-display text-[0.7rem] font-bold uppercase tracking-widest text-chip"
              >
                4 + 1 = 5 — hooked. Dee bids anything but 1.
              </p>
            </div>
          </div>
        </DemoFelt>
      </HowToSection>
    </div>
  )
}
