// The quick-chat palettes. Two kinds, one source: emoji go out as reactions
// (`kind:'react'` — a floating emoji over the seat, kept out of the log),
// canned lines go out as speech (`kind:'text'` — a bubble that also lands in
// the scrollback log). Free-text messages are also `kind:'text'`.

/** Tap-to-send emoji reactions. */
export const REACTS = ['👍', '🎉', '😅', '😮', '🤔', '🔥', '😡', '👀'] as const

/** Tap-to-send canned lines. */
export const PHRASES = ['Nice!', 'Oops', 'Good game', 'Your turn 👀', 'Hurry up!', 'Well played'] as const
