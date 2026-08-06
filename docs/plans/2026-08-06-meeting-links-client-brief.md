# Meeting links on a scheduled poll — client brief (#19)

**Status:** confirmed, not built. Server half shipped in #172 (`25f806c`).
**Date:** 2026-08-06
**Mode:** Operate

Design brief for the client half of #19, produced through `impeccable shape`. The
two open decisions were put to Artem and answered; both are recorded below with
the reasoning, so this can be built without re-deriving them.

## What already exists (#172)

A finalized poll can carry `meetingUrl`. Settable through `PUT /:did/:rkey/finalize`
and the MCP `schedule` tool. Validated by `normalizeMeetingUrl`
(`server/src/lib/meetingUrl.js`), delivered in the `.ics` as `LOCATION` plus a
`Join:` line in the description, cleared on unfinalize, never present on a
`METHOD:CANCEL`. Write semantics are three-way: omitted leaves alone, a URL sets,
an empty string clears.

Nothing in the UI reads or writes it yet. That is this brief.

## Job and audience

Two roles, sharply different:

- **The creator** decides where the meeting happens. Signed in, motivated, often
  a repeat user. Setting the link is a chore around the real event.
- **The responder** is the volume user: anonymous, on a phone, arriving from a
  shared link, frequently five minutes before the call. They need one thing —
  the way in.

The responder's need is the surface's real job. Optimising the creator's control
at the responder's expense would invert the product's first design principle.

## Outcome

The link appears in three places that must agree: the result card, the `.ics`,
and the email. Success is a responder tapping one obvious thing and being in the
call.

## Decisions taken

### 1. Two entry points — set at schedule time, editable after

Rejected alternatives: schedule-time only (a link decided in that moment or
never), and after-only (every link arrives as a second invite, never with the
first).

- **Scheduling bar:** an optional meeting-link field beside the confirm action.
  The first invite already carries the link, so the common case sends one email.
- **Result card:** "Add a meeting link" when absent, "Edit" when present.
  Creator-only.

### 2. The Jitsi room is offered, not assumed

The field starts **empty**, with a "Use a Jitsi room" affordance that fills it
with `https://meet.jit.si/avails-<rkey>`.

Rejected alternative: pre-filling every scheduled meeting with a room, clearable.
Fewer taps for online groups, but it assumes the meeting is online, and many
community meetings are in a room with chairs. avails' scope is explicitly
time-finding, not event management; attaching a video room to every meeting by
default is a scope claim the product does not want to make.

## The consequence this created

**Editing after scheduling must re-issue the invite.** A calendar entry is
exactly where the link needs to land, and an email carrying an `.ics` is the only
channel to it. The frozen UID (#167) is what makes this safe: a second `REQUEST`
with the same UID **updates** the event in place rather than duplicating it.

So this needs a **small server addition that does not exist yet**:

- An endpoint that writes `meetingUrl` on an already-finalized poll and re-sends
  an updated invite.
- Copy that says the link changed, not that the meeting "is scheduled" — the
  recipients already know when it is.
- **No email when the value is unchanged**, so an accidental save is silent.
- Same `normalizeMeetingUrl` validation as every other writer.
- Creator-only, same ownership check as finalize.

Reusing `PUT /finalize` for this would work mechanically (it re-sends and the UID
matches) but would send everyone an email announcing a scheduling they already
received. That is the reason for a separate route rather than a shortcut.

## Selected direction

No new visual world. The link lives **inside the existing green Scheduled card**,
which is already the peak-end moment of the product.

- Join is the card's **second line after the time**, above the OpenMeet row.
- Styled in the card's own **Confirmed Green (`#15803d`)**, not Gather Teal.
  Introducing teal inside a green card would put two brand voices in one
  component, against the Single Voice Rule. The existing OpenMeet link in that
  card already uses `#15803d`; this follows it.
- Creator controls are **inline, never a modal**. One field does not earn a
  dialog. The repo's existing dialogs (`EditPollDialog`, `UnscheduleDialog`) are
  for destructive or multi-field actions.

## Scope and boundaries

**Touches:** `client/src/pages/PollView.jsx`, the scheduling bar
(`SchedulingGrid.jsx` or the confirm bar it renders), `client/src/lib/api.js`,
and one new server route plus its tests.

**Does not touch:** the availability grid, the finalize flow's existing
semantics, or the Scheduled card's own visual treatment.

**Known drift, deliberately left alone.** DESIGN.md describes the scheduled-time
card as teal with a real shadow and a slow shimmer (§4, the system's one earned
elevation). The code ships a flat soft-green card (`#f0fdf4 → #ecfdf5`, border
`#bbf7d0`, no shadow). That gap is real and predates this work. Half-fixing it
inside a feature PR would be worse than leaving it; it wants its own decision
about which one is the truth.

## Anti-goals

- No modal.
- No new shadow (Flat-With-One-Hero).
- No second brand accent.
- No "Powered by Jitsi" badge or provider logos.
- Nothing that nudges avails from time-finding toward event management.

## States

| State | Creator sees | Responder sees |
|---|---|---|
| No link | "Add a meeting link" | nothing |
| Link set | Join + Edit | Join |
| Invalid URL | inline error, the server's own message | n/a |
| Saving | pending affordance on the control | n/a |
| Save failed | error with a retry, the schedule itself untouched | unchanged |
| Link removed | back to "Add a meeting link" | nothing |
| Unfinalized | n/a — server already clears it | n/a |

## Constraints

- **Mobile-first.** The join target needs a full-width tap area on a phone; the
  responder is on one.
- **WCAG 2.1 AA.** A real anchor with `rel="noopener noreferrer"`, a labelled
  field, and the error associated with the input rather than floating near it.
- **Long URLs** display as the host (`meet.jit.si/avails-…`) while the anchor
  carries the whole thing. Zoom links with query strings are long.
- **Copy:** sentence case, active voice, no em dashes. The action is named the
  same everywhere it appears.

## Not in scope

Zoom OAuth and Google Meet stay deferred, per the #126 design pass. Meet comes
nearly free once #7's server-side insert lands, as a `conferenceData` request on
the same call; Zoom is a whole provider integration with no demand behind it.
