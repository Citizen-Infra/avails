# Google Calendar event creation on schedule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the creator clicks "Schedule" on a poll, also insert a Google Calendar event into a shared calendar of their choice — picked from a dropdown of their writable calendars.

**Architecture:** Pure client-side. Reuse the existing Google Identity Services (GIS) OAuth plumbing in `client/src/lib/googleCalendar.js` (used today for the busy-time overlay). Extend it with three new helpers (request scope upgrade, list writable calendars, insert event). Wire the picker UI into `SchedulingGrid`'s toolbar. Make the calendar insert run *after* `finalizePoll` succeeds, so a calendar failure never rolls back a schedule. No server changes. No lexicon changes. No new dependencies.

**Tech Stack:** React 19, Vite 7, Google Calendar API v3, Google Identity Services (GIS) `accounts.oauth2` browser SDK (already loaded in `index.html`).

**Spec:** `docs/superpowers/specs/2026-05-06-google-calendar-event-creation-design.md`

**Testing convention:** The avails client has no test runner (`client/package.json` has no `test` script — only `dev`/`build`/`preview`). All tests in this repo are server-side (`server/test/*.test.js` via `node:test`). This plan does **not** add a client test setup — that's a separate scope decision and out of scope here. Verification is via manual smoke testing in the dev server. If you reach for client tests later, do it in a dedicated PR that adds Vitest.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `client/src/lib/googleCalendar.js` | modify | Existing: `isGoogleConfigured`, `requestGoogleAccess`, `fetchBusyTimes`. Add: scope constant for events, parameterise `requestGoogleAccess`, `listWritableCalendars`, `insertEvent`. |
| `client/src/components/SchedulingGrid.jsx` | modify | Existing: pick-time toolbar + grid. Add: "Add to" control inside the toolbar, accepting new props. |
| `client/src/pages/PollView.jsx` | modify | Existing: orchestrates poll display, scheduling state, OAuth flow for busy-time overlay. Add: writable-calendars state, chosen-calendar state, `localStorage` default, post-schedule insert, success/error link. |

`client/src/components/FinalizeDialog.jsx` is dead code with no callers — ignore it.

---

## Task 1: Extend `googleCalendar.js` with write helpers

**Files:**
- Modify: `client/src/lib/googleCalendar.js`

This task adds three pure functions and parameterises one existing one. All client-side, no UI changes yet. No tests (no client test runner — see "Testing convention" above).

- [ ] **Step 1: Read the current file**

Read `client/src/lib/googleCalendar.js` end-to-end so you know what you're extending. Keep its style: plain ES modules, no TS, `async`/`await`, `console.warn` on per-calendar errors, no throws inside loops.

- [ ] **Step 2: Add the events scope constant**

Open `client/src/lib/googleCalendar.js`. Below the existing `SCOPES` constant on line 2, add a new constant:

```js
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPES_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
```

Rename the old `SCOPES` to `SCOPES_READONLY` so the names are self-documenting. Update the one usage of `SCOPES` inside `requestGoogleAccess` accordingly.

- [ ] **Step 3: Parameterise `requestGoogleAccess` to accept a scope**

Replace the existing `requestGoogleAccess` (lines 8–24) with:

```js
export function requestGoogleAccess(scope = SCOPES_READONLY) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      callback: (response) => {
        if (response.error) reject(new Error(response.error));
        else resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export const GOOGLE_SCOPES = { READONLY: SCOPES_READONLY, EVENTS: SCOPES_EVENTS };
```

`GOOGLE_SCOPES` is exported so callers in `PollView.jsx` can pass the right scope without re-declaring URLs.

- [ ] **Step 4: Add `listWritableCalendars`**

Append below `fetchBusyTimes` in the same file:

```js
/**
 * Fetch the user's calendar list and return only those they can write events to.
 * Filters by accessRole === 'owner' | 'writer'. Excludes hidden/deleted entries.
 * Returns: [{ id, summary, accessRole, primary }]
 */
export async function listWritableCalendars(accessToken) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`calendarList failed: ${res.status}`);
  }
  const data = await res.json();
  return (data.items || [])
    .filter(c => !c.deleted && !c.hidden)
    .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map(c => ({
      id: c.id,
      summary: c.summary || c.id,
      accessRole: c.accessRole,
      primary: !!c.primary,
    }));
}
```

- [ ] **Step 5: Add `insertEvent`**

Append below `listWritableCalendars`:

```js
/**
 * Insert a single event into a Google Calendar.
 * eventBody must conform to https://developers.google.com/calendar/api/v3/reference/events#resource
 * Returns the created event resource (so callers can use { htmlLink, id }).
 */
export async function insertEvent(accessToken, calendarId, eventBody) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`insertEvent failed: ${res.status} ${text}`);
  }
  return res.json();
}
```

- [ ] **Step 6: Sanity check — lint and import-resolve**

Run from the `avails/` root:

```bash
cd client && npx vite build
```

Expected: build succeeds. If any unresolved imports or syntax errors, fix them. (No type checker — Vite parses JSX and ES modules; that's the available signal.)

- [ ] **Step 7: Commit**

```bash
git -C "C:\Users\temaz\claude-project\avails" add client/src/lib/googleCalendar.js
git -C "C:\Users\temaz\claude-project\avails" commit -m "feat(google-cal): add listWritableCalendars and insertEvent helpers"
```

---

## Task 2: Add the "Add to" control in `SchedulingGrid` toolbar

**Files:**
- Modify: `client/src/components/SchedulingGrid.jsx`

This task only adds UI surface in the existing toolbar. No data wiring yet — we add new props but `PollView` will populate them in Task 3.

- [ ] **Step 1: Add new props to the component signature**

Open `client/src/components/SchedulingGrid.jsx`. The current props (line 57–68) are:

```js
export default function SchedulingGrid({
  dates,
  timeRange,
  slotMinutes,
  responses,
  onSelect,
  onCancel,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  error,
}) {
```

Add new props (after `error`):

```js
export default function SchedulingGrid({
  dates,
  timeRange,
  slotMinutes,
  responses,
  onSelect,
  onCancel,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  error,
  // New: calendar picker
  googleConnected,            // boolean — has the creator OAuth'd Google?
  writableCalendars,          // array of { id, summary, primary } | null
  chosenCalendarId,           // string | 'none'
  onChooseCalendar,           // (id: string | 'none') => void
  onConnectGoogle,            // () => void — opens OAuth with events scope
}) {
```

- [ ] **Step 2: Replace the toolbar's right-hand button group with a layout that includes the picker**

The current toolbar (lines 132–151) is:

```jsx
<div className="rounded-lg bg-[#0d9488] text-white px-6 py-4 flex items-center justify-between">
  <p className="text-base font-medium">Select a time block on the grid</p>
  <div className="flex items-center gap-3">
    <button onClick={onCancel} ...>Cancel</button>
    <button onClick={onConfirm} ...>Schedule</button>
  </div>
</div>
```

Replace with a two-row layout that fits the picker on small screens and stays one row on wide screens:

```jsx
<div className="rounded-lg bg-[#0d9488] text-white px-6 py-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
  <p className="text-base font-medium">Select a time block on the grid</p>

  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
    {/* Add-to-calendar picker */}
    {googleConnected && writableCalendars && writableCalendars.length > 0 ? (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-white/90">Add to:</span>
        <select
          value={chosenCalendarId}
          onChange={(e) => onChooseCalendar(e.target.value)}
          className="rounded-md bg-white text-[#1a1a1a] px-2 py-1.5 text-sm border-0 focus:ring-2 focus:ring-white"
        >
          <option value="none">Don't add</option>
          {writableCalendars.map((c) => (
            <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)' : ''}</option>
          ))}
        </select>
      </label>
    ) : (
      <button
        type="button"
        onClick={onConnectGoogle}
        className="text-sm underline underline-offset-2 hover:text-white/80"
      >
        Connect Google Calendar to add event
      </button>
    )}

    <div className="flex items-center gap-3">
      <button
        onClick={onCancel}
        className="text-base px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        className="text-base px-4 py-2 rounded-lg bg-white text-[#0d9488] font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
      >
        {confirmLoading ? 'Scheduling...' : 'Schedule'}
      </button>
    </div>
  </div>
</div>
```

Notes:
- The picker shows when Google is connected *and* we have ≥1 writable calendar. Otherwise the connect link.
- "Don't add" is always option zero.
- `(primary)` suffix helps users distinguish their own primary calendar from shared ones in the dropdown.

- [ ] **Step 3: Build and visually verify**

```bash
cd client && npm run dev
```

Open `http://localhost:5173`, navigate to any poll where you're the creator, click into scheduling mode. The "Add to" picker won't appear yet (we haven't passed props from `PollView`), but the existing Cancel/Schedule buttons should still render and the layout should not be broken. If there's no scheduling-mode poll, edit the JSX harness as needed or skip to manual verification in Task 5.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git -C "C:\Users\temaz\claude-project\avails" add client/src/components/SchedulingGrid.jsx
git -C "C:\Users\temaz\claude-project\avails" commit -m "feat(scheduling-grid): add 'Add to calendar' control in toolbar"
```

---

## Task 3: Wire picker data in `PollView.jsx`

**Files:**
- Modify: `client/src/pages/PollView.jsx`

This task makes the picker actually work: stores the Google access token, fetches writable calendars, manages the chosen-calendar state, persists the choice in `localStorage`, and passes the props into `SchedulingGrid`.

- [ ] **Step 1: Add new imports**

At the top of `client/src/pages/PollView.jsx`, modify the existing import from `@/lib/googleCalendar` (line 5) to include the new helpers:

```js
import {
  isGoogleConfigured,
  requestGoogleAccess,
  fetchBusyTimes,
  listWritableCalendars,
  insertEvent,
  GOOGLE_SCOPES,
} from '@/lib/googleCalendar'
```

- [ ] **Step 2: Add new state hooks**

Inside the `PollView` component, near the existing busy-time state (around line 66–70), add these new state hooks:

```js
const [busySlots, setBusySlots] = useState(new Set())
const [slotEvents, setSlotEvents] = useState({})
const [calendarConnected, setCalendarConnected] = useState(false)
const [calendarSource, setCalendarSource] = useState(null)
const [connectingCalendar, setConnectingCalendar] = useState(false)

// New: calendar-write feature
const [googleToken, setGoogleToken] = useState(null)
const [writableCalendars, setWritableCalendars] = useState(null)  // null = not yet fetched, [] = none
const [chosenCalendarId, setChosenCalendarId] = useState('none')
const [googleEventLink, setGoogleEventLink] = useState(null)      // set on successful insert
const [calendarInsertError, setCalendarInsertError] = useState(null)
```

The `localStorage` key is per-user (`avails:lastCalendarId`), not per-poll.

- [ ] **Step 3: Modify `connectGoogleCalendar` to keep the token and fetch writable calendars**

Find `connectGoogleCalendar` (line 125). Replace its body with:

```js
async function connectGoogleCalendar({ forEvent = false } = {}) {
  setConnectingCalendar(true)
  try {
    const scope = forEvent ? GOOGLE_SCOPES.EVENTS : GOOGLE_SCOPES.READONLY
    const token = await requestGoogleAccess(scope)
    setGoogleToken(token)
    const result = await fetchBusyTimes(token, poll?.dates || [], poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    setBusySlots(result.busySlots)
    setSlotEvents(result.slotEvents)
    setCalendarConnected(true)
    setCalendarSource('google')
    // Fetch writable calendars for the picker
    try {
      const cals = await listWritableCalendars(token)
      setWritableCalendars(cals)
      // Restore last-used choice from localStorage if it's still in the list
      const lastId = localStorage.getItem('avails:lastCalendarId')
      if (lastId && lastId !== 'none' && cals.some(c => c.id === lastId)) {
        setChosenCalendarId(lastId)
      } else {
        setChosenCalendarId('none')
      }
    } catch (err) {
      console.warn('[avails] listWritableCalendars failed:', err)
      setWritableCalendars([])
    }
  } catch (err) {
    console.error('Google Calendar error:', err)
  } finally {
    setConnectingCalendar(false)
  }
}
```

The `forEvent` flag determines which scope to ask for. The default (no arg) preserves the existing busy-time-only call site.

- [ ] **Step 4: Add `handleConnectForEvent` and pass props to `SchedulingGrid`**

Above the JSX return (around line 470, before the `return`), add a small helper:

```js
const handleConnectForEvent = useCallback(() => {
  return connectGoogleCalendar({ forEvent: true })
}, [poll])
```

Find the `<SchedulingGrid ... />` JSX (lines 622–634) and add the new props:

```jsx
<SchedulingGrid
  dates={gridProps.dates}
  timeRange={gridProps.timeRange}
  slotMinutes={gridProps.slotMinutes}
  responses={responses}
  onSelect={setSchedulingSlots}
  onCancel={() => { setSchedulingMode(false); setSchedulingSlots([]) }}
  onConfirm={handleScheduleConfirm}
  confirmDisabled={schedulingSlots.length === 0}
  confirmLoading={schedulingLoading}
  error={schedulingError}
  googleConnected={!!googleToken}
  writableCalendars={writableCalendars}
  chosenCalendarId={chosenCalendarId}
  onChooseCalendar={setChosenCalendarId}
  onConnectGoogle={handleConnectForEvent}
/>
```

- [ ] **Step 5: Build to verify**

```bash
cd client && npx vite build
```

Expected: build succeeds. Fix any import or syntax errors.

- [ ] **Step 6: Commit**

```bash
git -C "C:\Users\temaz\claude-project\avails" add client/src/pages/PollView.jsx
git -C "C:\Users\temaz\claude-project\avails" commit -m "feat(poll-view): wire writable-calendars state and picker props"
```

---

## Task 4: Insert event after schedule succeeds

**Files:**
- Modify: `client/src/pages/PollView.jsx`

This task changes `handleScheduleConfirm` to call `insertEvent` after `finalizePoll` succeeds, persists the chosen calendar to `localStorage` on success, surfaces the inserted event link in the success view, and surfaces a retry-able error when the calendar insert fails after a successful schedule.

- [ ] **Step 1: Replace `handleScheduleConfirm` with the new flow**

Find `handleScheduleConfirm` (line 360). Replace its body with:

```js
async function handleScheduleConfirm() {
  if (schedulingSlots.length === 0) return
  setSchedulingLoading(true)
  setSchedulingError(null)
  setCalendarInsertError(null)
  try {
    const mins = poll.slotMinutes || poll.slotDuration || 30
    const finalTime = new Date(schedulingSlots[0]).toISOString()
    const finalDuration = schedulingSlots.length * mins
    const notifyEmails = [...new Set(responses.filter(r => r.email).map(r => r.email))]

    // 1) PDS finalize + .ics emails. Source of truth.
    await finalizePoll(did, rkey, finalTime, finalDuration, notifyEmails)
    setSchedulingMode(false)
    setSchedulingSlots([])

    // 2) Optional Google Calendar insert. Independent — never rolls back the schedule.
    if (chosenCalendarId !== 'none' && googleToken) {
      await insertGoogleEvent({ finalTime, finalDuration })
    }

    fetchData()
  } catch (err) {
    setSchedulingError(err.message)
  } finally {
    setSchedulingLoading(false)
  }
}
```

- [ ] **Step 2: Add `insertGoogleEvent` helper**

Add this function above `handleScheduleConfirm`:

```js
async function insertGoogleEvent({ finalTime, finalDuration }) {
  const tz = poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const startDt = new Date(finalTime)
  const endDt = new Date(startDt.getTime() + finalDuration * 60 * 1000)
  const pollUrl = `${window.location.origin}/p/${did}/${rkey}`

  const eventBody = {
    summary: poll.title,
    description: [poll.description, `View poll: ${pollUrl}`].filter(Boolean).join('\n\n'),
    start: { dateTime: startDt.toISOString(), timeZone: tz },
    end: { dateTime: endDt.toISOString(), timeZone: tz },
    source: { url: pollUrl, title: 'View poll' },
  }

  try {
    const created = await insertEvent(googleToken, chosenCalendarId, eventBody)
    setGoogleEventLink({ url: created.htmlLink, calendarSummary: writableCalendars?.find(c => c.id === chosenCalendarId)?.summary || 'calendar' })
    localStorage.setItem('avails:lastCalendarId', chosenCalendarId)
  } catch (err) {
    console.error('[avails] insertEvent failed:', err)
    setCalendarInsertError(err.message || 'Could not add to calendar')
  }
}
```

- [ ] **Step 3: Add a retry-only handler for calendar failures**

Add this function near `insertGoogleEvent`:

```js
async function retryCalendarInsert() {
  if (!poll?.finalTime || !poll?.finalDuration) return
  if (chosenCalendarId === 'none' || !googleToken) return
  setCalendarInsertError(null)
  await insertGoogleEvent({ finalTime: poll.finalTime, finalDuration: poll.finalDuration })
}
```

This re-runs only the calendar insert against the already-finalized poll — never re-runs `finalizePoll`.

- [ ] **Step 4: Render success and error states**

Find the existing "Scheduled" badge in the JSX (the one near line 521 that shows `<span>Scheduled</span>`). Just below the existing scheduled-state UI, add this block:

```jsx
{googleEventLink && (
  <p className="text-sm text-[#0d9488]">
    Added to {googleEventLink.calendarSummary} —{' '}
    <a href={googleEventLink.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      view event
    </a>
  </p>
)}
{calendarInsertError && (
  <div className="text-sm text-red-700 flex items-center gap-2">
    <span>Couldn't add to calendar — schedule still confirmed.</span>
    <button
      onClick={retryCalendarInsert}
      className="underline underline-offset-2 hover:text-red-900"
    >
      Retry
    </button>
  </div>
)}
```

(Place it inside the same panel that holds the `<span>Scheduled</span>` element. If unsure where, the visual goal is: directly below the "Scheduled" header line, in the same card, before any "Unschedule" button.)

- [ ] **Step 5: Build to verify**

```bash
cd client && npx vite build
```

Expected: build succeeds. Fix any errors.

- [ ] **Step 6: Commit**

```bash
git -C "C:\Users\temaz\claude-project\avails" add client/src/pages/PollView.jsx
git -C "C:\Users\temaz\claude-project\avails" commit -m "feat(schedule): insert google calendar event after finalize"
```

---

## Task 5: Manual end-to-end smoke test

**Files:** none modified — verification only.

This is the only verification gate. Walk every path that the design promises before declaring done.

- [ ] **Step 1: Start the dev environment**

```bash
cd "C:\Users\temaz\claude-project\avails\server" && npm run dev
```

In another terminal:

```bash
cd "C:\Users\temaz\claude-project\avails\client" && npm run dev
```

Wait for both to be ready (server on `:3000`, client on `:5173`).

- [ ] **Step 2: Verify `VITE_GOOGLE_CLIENT_ID` is set in client env**

The client picks up `VITE_GOOGLE_CLIENT_ID` at build time. Check `client/.env` exists with this var. If not, copy from production env:

```bash
cd client && cat .env  # confirm VITE_GOOGLE_CLIENT_ID=...
```

If missing, pull from Railway production with `railway variables` (logged into the avails project) and create `client/.env`.

Restart `npm run dev` after creating `.env` so Vite picks it up.

- [ ] **Step 3: Happy path — Sensemaking Scenius calendar**

1. Sign in as a creator with write access to a shared calendar (your account that's a member of `sensemakingscenius@gmail.com`).
2. Create a new poll with two or three candidate days.
3. Submit availability as a participant.
4. Click "Schedule" to enter scheduling mode.
5. Click "Connect Google Calendar to add event" (the link inside the teal toolbar) → consent dialog should appear once requesting `calendar.events`.
6. After consent, the link should be replaced by an "Add to: [▾]" dropdown populated with your writable calendars including "Sensemaking Scenius".
7. Pick "Sensemaking Scenius".
8. Drag-select a slot, click "Schedule".
9. Expected: poll flips to scheduled state, success view shows "Added to Sensemaking Scenius — view event". Click the link.
10. Verify the event exists in the shared calendar with correct title, time, timezone, and description containing the poll URL.

- [ ] **Step 4: Don't-add path**

1. From the poll list, create another poll.
2. Enter scheduling mode. The dropdown should default to "Don't add" (since localStorage still has the prior choice but we've confirmed it works — flip it manually to "Don't add" if needed).
3. Schedule the poll.
4. Expected: poll is scheduled, no Google Calendar event created, no "Added to ..." line in the success view.

- [ ] **Step 5: localStorage persistence**

1. Reload the app (full page reload, not just the React route).
2. Re-enter scheduling mode after re-connecting Google.
3. Expected: dropdown defaults to your last-used calendar (Sensemaking Scenius from step 3).

- [ ] **Step 6: OAuth refused**

1. In a fresh browser profile (or revoke Avails' Google access from `myaccount.google.com/permissions`), enter scheduling mode and click "Connect Google Calendar to add event".
2. On the consent dialog, click "Cancel" (deny).
3. Expected: link remains, no token stored, you can still proceed by clicking "Schedule" without selecting a calendar — the schedule succeeds without a calendar event.

- [ ] **Step 7: Calendar insert failure**

Hard to provoke organically. Optional: temporarily edit `insertEvent` in `googleCalendar.js` to `throw new Error('synthetic')` near the top, rebuild, run through the happy path. Verify:
- Schedule still succeeds (poll is finalized).
- Error UI appears: "Couldn't add to calendar — schedule still confirmed [Retry]".
- Click Retry: it re-runs `insertEvent` only, no second `finalizePoll` call.

Revert the synthetic throw before continuing.

- [ ] **Step 8: Re-schedule (orphan event verification)**

1. After scheduling a poll into the shared calendar, click "Unschedule" on the poll.
2. Re-enter scheduling mode, pick a different time, click Schedule (with the same calendar selected).
3. Expected: a *new* event appears in the shared calendar at the new time. The previous event is **still there** (orphan — by design for v1; documented in spec).
4. Manually delete the orphan from the shared calendar to clean up.

This is expected v1 behavior — auto-cancel of the old event is deferred behind a lexicon change for `googleEventId` persistence.

- [ ] **Step 9: Stop the dev servers and write a brief verification note**

Stop both `npm run dev` processes. Append a verification entry to `docs/process-notes.md` under today's date:

```
## 2026-05-06 — Google Calendar event creation v1
Smoke-tested all paths from plan Task 5. Happy path, don't-add, localStorage default,
OAuth refused, retry, and re-schedule orphan all behave per spec. Ready to merge / deploy.
```

- [ ] **Step 10: Commit verification note**

```bash
git -C "C:\Users\temaz\claude-project\avails" add docs/process-notes.md
git -C "C:\Users\temaz\claude-project\avails" commit -m "docs: smoke-test verification for google calendar event creation"
```

---

## Definition of Done

Per workspace `CLAUDE.md`:

1. ✅ Written (Tasks 1–4)
2. ✅ Committed (each task ends with a commit)
3. ⏳ Pushed (`git push origin main` — do this when you're confident with the plan complete)
4. ⏳ Deployed (Railway redeploys from `main` per its `watchPatterns` — verify the new build picks up `client/src/lib/googleCalendar.js` changes; client is bundled into the server's static output)
5. ⏳ Task list updated (close any related GitHub issues; reference [community-admin#12](https://github.com/Citizen-Infra/community-admin/issues/12) for the deferred per-community config follow-up)
6. ⏳ Production verified — open the live site, repeat the happy path from Task 5 step 3 against your real shared community calendar

---

## Out of scope reminders (do not implement)

- ❌ Service-account flow / `google-auth-library` server-side OAuth.
- ❌ Per-community calendar config (filed as [community-admin#12](https://github.com/Citizen-Infra/community-admin/issues/12)).
- ❌ Adding participants as event attendees.
- ❌ Auto-cancel/update of the Google event on unschedule/re-schedule (would require lexicon change for `googleEventId`).
- ❌ Adding a client-side test runner (Vitest) — separate scope.
