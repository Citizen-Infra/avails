# Standing-availability time confirmations

Implementation contract for #103; production acceptance remains pending until
the Avails and Community Admin PRs are reviewed, merged and deployed.

## Scope and direction contract

**Mode:** Operate. A participant follows a shared link on a phone to confirm one
selected time. This is not a new RSVP list, event page, or change to anonymous polls.

**Approved implementation boundary:** #103's private confirmation/ICS flow,
organizer handoff, truthful announcements, and focused tests. The user explicitly
approved the small CA booking-helper extraction for testability. This does not
authorize general app refactoring, poll/grid redesign, credential/config changes,
or release operations. The implementation stops at two PRs ready for review.

**THESIS:** One private decision about a fixed time; no roster or dashboard.
**OWN-WORLD:** Inherit Avails' paper ground, Geist, warmed neutrals, hairline
separators, and existing shadcn buttons. Teal identifies the primary decision.
**STORY:** Sign in as the DID whose standing availability was used, inspect the
local time, accept or decline, then download a calendar artifact after acceptance.
**FIRST VIEWPORT:** Minimal Avails header, one readable title and local-time
statement, the participant's own consent state, and full-size decision controls.
**FORM:** Precisely scoped extension of the established Avails world, approved
by the user; no concept-seed or visual-system replacement.
**FINISH:** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

No browser use is authorized for this task. Source/design-detector review is
possible; rendered desktop/mobile inspection must be disclosed as not performed.
No new raster assets or changes to DESIGN.md are needed.

## Private state and consent

`server/src/lib/callBookings.js` atomically stores private bookings in
`DATA_DIR/private-call-bookings.json`. It never writes a poll or PDS record and
stores no new credentials. The caller identity namespaces idempotency keys;
replay returns the original fixed slot and the current participant consent states.
Writes are serialized and committed before becoming visible in memory. This
uses the existing single-replica, durable-volume deployment assumption.

Each participant starts accepted only for an exact `trust: auto` grant; every
other trust value starts pending. An authenticated DID can decide only for itself.
Pending becomes accepted or declined. Repeating the same decision is idempotent;
changing a saved decision is refused in this initial slice. A participant can
remove an imported calendar entry manually; this is not a calendar-sync service.
No decision changes the selected time or somebody else's grant.

Records are retained for at least 30 days from creation and seven days after
the selected time ends. Expired records are pruned on subsequent creation.
Capacity exhaustion fails closed rather than evicting an active confirmation.
Legacy idempotency results are still honored for service callers but do not
gain an invented historical participant-confirmation lifecycle.

## Endpoints and UI

- `GET /api/calls/:id`: cookie-authenticated participant-only details; no roster.
- `POST /api/calls/:id/decision`: validated `{decision: 'accept' | 'decline'}`;
  never accepts a client-supplied DID or participant state.
- `GET /api/calls/:id/calendar.ics`: authenticated accepted participant only,
  stable booking UID, no participant roster in the artifact.
- `GET /api/calls/:id/handoff`: the existing Avails service credential, for
  service-created bookings only; live confirmed/pending/declined states for CA.
- `/calls/:id`: title, local time plus timezone, own consent state, decision and
  download controls. A validated OAuth application-state return preserves this
  route across sign-in; no arbitrary return URL is accepted.

The participant can switch accounts without leaving the booking route. After
an uncertain save, decision controls remain disabled until reload checks the
durable state. Primary controls use large bold text to meet AA contrast on the
existing Gather Teal, without changing the product palette.

All booking responses are private/no-store. Possession of a URL is not
authorization, and unauthorized DIDs receive the same 404 as unknown calls.
Existing anonymous poll participation stays unchanged.

## Community Admin handoff

CA persists the returned booking identifier/link and consent snapshot when it
records the proposal outcome. That handoff is excluded from member list output.
An authenticated community organizer can retrieve it through the proposal's
`booking` endpoint, which asks Avails for current state. An unreachable Avails
returns an explicitly stale stored snapshot, never a fabricated live result.

Organizers receive the participant link and an authenticated organizer-handoff
link to retrieve pending DIDs privately. Notices do not inline an unbounded roster.
Public replies identify the selected time and aggregate consent counts at time
selection; the participant URL has a link facet so it is tappable in Bluesky.
They include no roster and promise no email delivery. Calendar
download works independently of an email field on standing-availability records.

## Release and acceptance

Deploy Avails before the CA companion change. Older Avails responses remain
readable, but CA must not invent a booking URL or confirmation queue for them.
Focused tests cover private storage/reload, authorization, decisions, downloads,
replay and the actual CA-client → Avails booking → CA announcement contract.

After review and separately approved merge/deployment, choose a test community,
explicitly consenting participants, and a publication target. Verify a real CA
trigger, mixed/all-confirmation outcomes, accept/decline isolation, calendar
access, one announcement, and replay without duplicate delivery. No live
invitations, posts, production configuration changes or new credentials are
authorized by the implementation request alone.

## Implementation verification and finish verdict

Source review preserves the existing Operate visual world, shared shadcn
controls, visible labels, polite saved-state announcements, local time/zone,
mobile-stacked controls, and 44–48px touch targets. No new image assets.
**Verdict: source-ready for PR review; rendered verification pending.** No
browser run, production build, full local suite, or live acceptance was performed.

Local focused gates: nine private-store/consent/OAuth-return tests and five
cross-service contract scenarios, plus 43 CA service/announcement tests using
existing dependencies and a database-free focused configuration. Both changed
JSX files passed a syntax-only transform; the design detector returned no findings.
HTTP authorization and real ICS checks,
Community Admin database/migration regressions, client tests, and builds remain
CI gates because Avails dependencies are not installed locally. CA's contract CI
pins the companion Avails commit; it does not follow a mutable branch. A later
intentional contract change must update that pin and both sides' regressions.
