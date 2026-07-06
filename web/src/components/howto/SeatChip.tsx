/** A player marker on the demo felt, with an optional dealer button. */
export function SeatChip({ name, dealer = false }: { name: string; dealer?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-2.5 py-0.5 font-display text-[0.65rem] font-extrabold uppercase tracking-wider shadow-hard-sm">
      {name}
      {dealer ? (
        <span className="inline-grid h-4 w-4 place-items-center rounded-full border border-ink bg-chip text-[0.55rem]">
          D
        </span>
      ) : null}
    </span>
  )
}
