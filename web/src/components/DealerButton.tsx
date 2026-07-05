/** The physical dealer chip. Exactly one is rendered (inside the dealer's
 *  seat), and its stable `data-flip-id` makes GSAP Flip glide it around the
 *  table whenever the deal passes to the next player. */
export function DealerButton() {
  return (
    <span
      data-flip-id="dealer-button"
      title="Dealer"
      aria-label="dealer"
      className="inline-grid size-5 shrink-0 place-items-center rounded-full border-2 border-ink bg-chip font-display text-[0.65rem] font-extrabold text-ink"
    >
      D
    </span>
  )
}
