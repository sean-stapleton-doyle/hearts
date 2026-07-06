import type { ReactNode } from 'react'

/**
 * Layout shell for one tutorial rule: numbered kicker + display heading +
 * prose, then the animated demo panel underneath. The kicker numbers are
 * real sequence — the rules are taught in the order a round plays out
 * (deal → bid → play → score), so "Rule 03" carries information.
 *
 * Prose clamps to max-w-md for a readable measure even though the page
 * column is wider to give the demo panels room.
 */
export function HowToSection({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string
  title: string
  lead: ReactNode
  children?: ReactNode
}) {
  // Block flow + margins, not flex/gap: a pinned demo panel's ScrollTrigger
  // pin-spacer reserves scroll distance with padding, which a flex parent
  // ignores — following sections would slide up over the pinned panel.
  return (
    <section className="space-y-5">
      <header className="mx-auto w-full max-w-md">
        <p className="font-display text-xs font-bold uppercase tracking-[0.22em] text-mute">
          {kicker}
        </p>
        <h2 className="mt-1">{title}</h2>
        <div className="mt-3 flex flex-col gap-3 text-[0.95rem] font-medium leading-relaxed">
          {lead}
        </div>
      </header>
      {children}
    </section>
  )
}
