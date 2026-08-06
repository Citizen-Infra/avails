import { useId } from 'react'
import { Input } from '@/components/ui/input'

// The video call link for a scheduled meeting (#19). Used in two places that
// need identical validation, affordances and copy: the scheduling bar, where
// the link is set as part of picking the time, and the result card, where it is
// added or changed afterwards.
//
// The Jitsi room is OFFERED, never pre-filled. A room needs no account, so
// suggesting one is nearly free — but assuming one presumes the meeting is
// online, and plenty of community meetings are in a room with chairs. Avails
// finds times; it does not decide how a group meets.
export default function MeetingLinkField({
  value,
  onChange,
  suggestion,
  error,
  disabled = false,
  autoFocus = false,
}) {
  const id = useId()
  const errorId = `${id}-error`
  const hasValue = value.trim().length > 0

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[#6b6560]">
        Meeting link <span className="font-normal text-[#a09a94]">(optional)</span>
      </label>

      <Input
        id={id}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-10 border-[#d8d4cf] bg-[#faf9f6] text-[#1a1a1a] placeholder:text-[#a09a94]"
      />

      <div className="flex items-center gap-3 min-h-5">
        {!hasValue && suggestion && (
          <button
            type="button"
            onClick={() => onChange(suggestion)}
            disabled={disabled}
            className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            Use a Jitsi room
          </button>
        )}
        {hasValue && (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="text-sm text-[#6b6560] hover:text-[#1a1a1a] underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        )}
        {/* The server is the authority on what a valid link is, so its message
            is shown verbatim rather than re-worded here. */}
        {error && (
          <p id={errorId} role="alert" className="text-sm text-[#b91c1c]">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

// Deterministic from the poll's rkey, so the same poll always suggests the same
// room and a participant who saved the link still lands in it. Jitsi creates a
// room on first join, so naming one is all it takes.
export function jitsiSuggestionFor(rkey) {
  return `https://meet.jit.si/avails-${encodeURIComponent(rkey)}`
}
