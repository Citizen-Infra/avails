# Google Calendar event creation on schedule

**Date:** 2026-05-06
**Status:** Approved (design); pending implementation plan

## Problem

When a creator finalizes an Avails poll, participants get an `.ics` email attachment they can import individually. But for community-organized events that use a shared Google Calendar (e.g., `sensemakingscenius@gmail.com`, which all Sensemaking Scenius members have subscribed to), the natural place for the event is on that shared calendar — once it's there, every subscribed member sees it without further action.

Today this requires the organizer to manually copy the time, title, and description into the shared calendar after scheduling. The fix: at schedule time, let the creator pick a calendar they have write access to, and insert the event there automatically.

## Scope (v1)

- At schedule confirmation, creator picks one writable Google Calendar from a dropdown. Avails inserts an event into it.
- The choice is remembered per-creator in `localStorage` (default-selected next time).
- Write access comes from the creator's existing membership on the shared calendar — no service account, no per-community admin handshake. The creator's own Google account already has "Make changes to events" on the shared calendar (that's how the shared-calendar model works); Avails inherits that access through OAuth on the creator's behalf.

### Scope discipline note

Avails' charter is "time-finding, not event management" (`CLAUDE.md`). This feature sits at the boundary: the existing `.ics` email is already calendar-adjacent, and this is a thin extension of "the schedule moment produces calendar artefacts." It does not turn Avails into an event-management platform. Specifically: no RSVP, no attendees, no event editing UI, no calendar browsing, no event lifecycle beyond first creation.

### Out of scope (deferred)

- **Per-community calendar config** in `scenius-digest`'s `groups.json` (option 2 from brainstorming) — filed for community-admin backlog.
- **Participants as Google Calendar attendees.** The shared-calendar pattern is "everyone's subscribed, so the event just appears." Attendees would (a) overlap with the existing `.ics` email and create double-notifications, and (b) push Avails into the RSVP-system territory it explicitly disclaims.
- **Updating or cancelling the Google event when a poll is re-scheduled.** No re-schedule path exists in the product today. Adding update/cancel would also require persisting the Google event ID on the poll record (lexicon change). Defer until re-scheduling exists.

## Permissions & OAuth

- Today's scope: `https://www.googleapis.com/auth/calendar.readonly` (busy-time overlay in `client/src/lib/googleCalendar.js`).
- New scope on top: `https://www.googleapis.com/auth/calendar.events` — write access scoped to events only, not full calendar metadata. Better trust posture than the broader `calendar` scope.
- Google Identity Services supports incremental consent: the user sees one extra consent dialog the first time they schedule a poll with calendar-add. After that, silent.
- Token usage is client-side only, same pattern as the existing busy-time fetch. No server-side OAuth changes. The token is short-lived (~1 hour); the schedule click is synchronous, so this is fine.

## UI

At the schedule confirmation step (where the creator picks a final time and clicks Confirm), add a calendar picker:

```
Schedule for [time] (X min)
  Add to calendar:  [▾ Sensemaking Scenius]
                       Don't add
                       Sensemaking Scenius     ← default: last-used per creator
                       My personal calendar
                       …
  [Cancel]  [Confirm]
```

States:
- **Creator already OAuth'd Google (any scope):** Dropdown is populated from `calendarList`, filtered to `accessRole: writer | owner`.
- **Creator has not OAuth'd Google:** Show a "Connect Google Calendar" link in place of the dropdown. Never auto-trigger OAuth — the user opts in by clicking.
- **Creator OAuth'd but `calendarList` fetch fails:** Dropdown shows only "Don't add"; surface a small error.

After confirmation succeeds: the success view includes "Added to Sensemaking Scenius calendar" with a link to the inserted Google event (`htmlLink` returned by the API).

## Data flow on Confirm

1. Client calls existing `schedule` MCP tool. PDS update + participant emails fire as today. **Unchanged.**
2. If the calendar dropdown is not "Don't add":
   a. If current OAuth token doesn't include `calendar.events`, request scope upgrade via GIS (one consent dialog).
   b. Call `POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` with the event body (see "Event content" below).
3. On calendar-insert success: write the chosen `calendarId` to `localStorage` so it's the default next time.

**Order matters:** schedule first, calendar second.
- Schedule failure → no calendar insert attempted → no orphan event.
- Calendar failure after schedule success → poll is finalized, but no event on the shared calendar. Show "Scheduled — couldn't add to calendar [retry]". The retry button re-runs only the calendar insert, not the whole schedule.

## Event content

| Field | Value |
|-------|-------|
| `summary` | Poll title |
| `description` | Poll description (if any) + link to poll page (using existing `pollUrl(did, rkey)` helper) |
| `start.dateTime` | `finalTime` (ISO 8601) |
| `start.timeZone` | Poll's `timezone` |
| `end.dateTime` | `finalTime` + `finalDuration` minutes |
| `end.timeZone` | Poll's `timezone` |
| `location` | (empty — poll model has no source) |
| `attendees` | (omitted — see scope discipline) |
| `source.url` | Poll URL |
| `source.title` | "View poll" |

## Error handling

All of these occur *after* step 1 (schedule MCP) has already succeeded. The poll is already finalized. The behavior in each case is about the calendar insert only.

| Failure mode | Behavior |
|--------------|----------|
| `calendarList` fetch fails (at picker open) | Dropdown shows "Don't add" only; small inline error. Doesn't block confirm. |
| Scope upgrade denied at confirm time | "Couldn't add — schedule still confirmed". No retry: user re-opens consent by clicking the calendar link on the success view. |
| Token expired during insert | Re-request scope silently; if user re-consents, retry insert once; otherwise show "Couldn't add — schedule still confirmed". |
| Insert API error (4xx/5xx) | "Couldn't add — schedule still confirmed [retry]". Retry button re-runs only step 2 (no schedule re-run). |
| Network error | Same as insert API error. |

The invariant: **a calendar failure never rolls back a schedule.** The poll's PDS state is the source of truth; the Google Calendar event is a courtesy artifact.

## Files affected (anticipated)

- `client/src/lib/googleCalendar.js` — add `requestEventsAccess()` (scope upgrade), `listWritableCalendars(token)`, `insertEvent(token, calendarId, eventBody)`.
- `client/src/pages/PollView.jsx` (or wherever the schedule-confirm UI lives) — add calendar dropdown to the confirmation step, wire up the post-schedule insert and `localStorage` default.
- No server-side changes. No lexicon changes. No `schedule` MCP tool changes.

## Future work (filed)

- Per-community calendar pre-config (option 2 from brainstorming): extend `scenius-digest`'s `groups.json` with `googleCalendarId`. Polls that are tied to a community at creation can default to it; for now defer until community-admin work.
- Update/cancel Google event on re-schedule. Requires persisting `googleEventId` and `googleCalendarId` on the poll record (lexicon change).
- Auto-attendees for use cases where the shared-calendar pattern doesn't apply (e.g., one-off polls with non-overlapping participant groups). Only revisit if there's user demand and the RSVP-scope question is reopened.
