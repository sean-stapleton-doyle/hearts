import { CardBack } from './CardBack'

/**
 * The face-down deck: a few offset card backs reading as a squared-up
 * stack. The tutorial leans on this in the deal and the "never reshuffled"
 * sections, where the deck itself is the main character.
 */
export function DeckStack({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <span className="relative block h-[52px] w-[42px]">
        {[0, 1, 2, 3].map((i) => (
          <CardBack
            key={i}
            size="sm"
            className="absolute"
            style={{ left: i * 2, top: -i * 2, zIndex: i }}
          />
        ))}
      </span>
      {label ? (
        <span className="font-display text-[0.6rem] font-bold uppercase tracking-widest text-paper/80">
          {label}
        </span>
      ) : null}
    </div>
  )
}
