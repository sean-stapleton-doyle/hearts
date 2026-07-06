import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as Popover from '@radix-ui/react-popover'

import { api } from '../lib/api'
import type { EngineView, PlayerInfo } from '../lib/types'

interface TableMenuProps {
  gameId: string
  players: PlayerInfo[]
  away: EngineView['away']
  isHost: boolean
}

/** The kebab beside the round/phase label: roster of who's at the table,
 *  plus — host only — ending the game early. A Radix popover (dismissal,
 *  Escape, and focus management for free) rather than the mobile scores
 *  sheet since it's table-scoped, not personal, and rare enough not to
 *  earn its own dedicated button. Kept controlled so the end-game
 *  mutation can close it programmatically. */
export function TableMenu({ gameId, players, away, isHost }: TableMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  // Collapse the confirm step whenever the menu closes, so reopening it
  // always starts from the plain "End game" button.
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setConfirmingEnd(false)
  }

  const endMutation = useMutation({
    mutationFn: () => api.endGame(gameId),
    // No local cache patch: the `game_abandoned` SSE event (and its
    // FinishedView result-cache write) does that for every client at once.
    onSettled: () => onOpenChange(false),
  })

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="ghost table__menu-toggle" aria-label="Table menu">
          ⋮
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="table__menu-panel modal__panel z-30"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <h4 className="m-0 text-xs font-bold uppercase tracking-widest text-mute">
            Players
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {players.map((p) => (
              <li key={p.seat} className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="truncate">{p.is_you ? 'You' : p.display_name}</span>
                <span className="flex shrink-0 gap-1 text-xs font-bold uppercase text-mute">
                  {p.is_creator && <span>host</span>}
                  {away[p.seat] && <span>away</span>}
                </span>
              </li>
            ))}
          </ul>

          {isHost && (
            <>
              <hr className="my-1 border-ink/15" />
              {confirmingEnd ? (
                <div className="flex flex-col gap-1.5">
                  <p className="m-0 text-sm font-semibold">End the game for everyone?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="danger flex-1"
                      onClick={() => endMutation.mutate()}
                      disabled={endMutation.isPending}
                    >
                      {endMutation.isPending ? 'Ending…' : 'End game'}
                    </button>
                    <button
                      type="button"
                      className="ghost flex-1"
                      onClick={() => setConfirmingEnd(false)}
                      disabled={endMutation.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="danger w-full" onClick={() => setConfirmingEnd(true)}>
                  End game
                </button>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
