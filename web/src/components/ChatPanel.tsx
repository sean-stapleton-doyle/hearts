import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { api, isApiError } from '../lib/api'
import { PHRASES, REACTS } from '../lib/chatPhrases'
import type { ChatKind, ChatMessage } from '../lib/types'

/**
 * The chat tray: a bottom sheet (shares the scores sheet's chrome) holding the
 * scrollback log plus a composer. Live messages arrive via the SSE bridge and
 * the `messages` prop re-renders; we never write the cache here. Sending has no
 * optimistic entry — the sender receives its own message back over SSE, which
 * appends through the stash like everyone else's.
 *
 * Reactions (`REACTS`) go out as `kind:'react'` (a floating seat emoji, kept
 * out of this log); canned lines (`PHRASES`) and free text go out as
 * `kind:'text'` (a seat bubble that also lands here). `canSend` is false once
 * the game is no longer running — the log stays readable, the composer locks.
 */
export function ChatPanel({
  gameId,
  messages,
  canSend,
  onClose,
}: {
  gameId: string
  messages: ChatMessage[]
  canSend: boolean
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Only spoken messages belong in the scrollback; reactions are transient.
  const log = messages.filter((m) => m.kind === 'text')

  const send = useMutation({
    mutationFn: ({ kind, body }: { kind: ChatKind; body: string }) =>
      api.sendChat(gameId, kind, body),
    onError: (e) =>
      setError(isApiError(e) ? e.message : 'Could not send — try again.'),
  })

  // Pin to the newest message. `useLayoutEffect` so the jump happens before
  // paint (no visible scroll flash); keyed on the last id so it re-pins on a
  // new arrival but not on unrelated re-renders.
  const lastId = log.length ? log[log.length - 1].id : 0
  useLayoutEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  // Clear a stale error once the game becomes sendable again.
  useEffect(() => {
    if (canSend) setError(null)
  }, [canSend])

  const submit = (kind: ChatKind, body: string) => {
    const trimmed = body.trim()
    if (!trimmed || !canSend) return
    setError(null)
    send.mutate({ kind, body: trimmed })
  }

  const onTextSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit('text', draft)
    setDraft('')
  }

  return (
    <div className="sheet chat" role="dialog" aria-label="Game chat">
      <div className="scoreboard__bar chat__bar">
        <h3>Chat</h3>
        <button type="button" className="chat__x" aria-label="Close chat" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="chat__log" ref={logRef}>
        {log.length === 0 ? (
          <p className="chat__empty">No messages yet. Say hi 👋</p>
        ) : (
          log.map((m) => (
            <p key={m.id} className="chat__msg">
              <span className="chat__who">{m.name}</span> {m.body}
            </p>
          ))
        )}
      </div>

      {/* Quick reactions — one tap, no bubble in the log. */}
      <div className="chat__reacts">
        {REACTS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="chat__react"
            disabled={!canSend || send.isPending}
            onClick={() => submit('react', emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Canned lines — tap to speak. */}
      <div className="chat__phrases">
        {PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            className="chat__phrase"
            disabled={!canSend || send.isPending}
            onClick={() => submit('text', phrase)}
          >
            {phrase}
          </button>
        ))}
      </div>

      <form className="chat__compose" onSubmit={onTextSubmit}>
        <input
          className="chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={canSend ? 'Message…' : 'Chat is closed'}
          maxLength={280}
          disabled={!canSend}
          aria-label="Message"
        />
        <button
          type="submit"
          className="chat__send"
          disabled={!canSend || send.isPending || draft.trim().length === 0}
        >
          Send
        </button>
      </form>

      {error && (
        <p className="chat__error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="sheet__close" onClick={onClose}>
        Close chat
      </button>
    </div>
  )
}
