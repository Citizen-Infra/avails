# Avails — ATProto-Powered Group Scheduling

**Date**: 2026-04-02
**Status**: Design approved
**Repo**: `avails/` (new project in workspace)
**Domain**: avails.zhgnv.com
**Ecosystem**: Citizen Infrastructure (alongside MC, DN, community-admin, navidrome-jam, nsrt, scenius-digest)

## Overview

Open-source alternative to LettuceMeet, powered by ATProto. Polls are stored as records in the creator's PDS using custom lexicons via `@atproto/lex`. Community-scoped polls surface in MC/DN participation feeds.

**Key differentiators from LettuceMeet:**
- Data ownership via ATProto (polls live in creator's PDS, not a centralized database)
- Community-scoped (polls tagged to communities, discoverable in MC/DN)
- Single-page creation flow (fixing LettuceMeet's multi-page UX problem identified in UX Collective case study)
- Calendar invites (.ics) sent automatically when a time is finalized
- Telegram bot integration (future, service #2)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ATProto depth | Data on ATProto | Polls stored as records in creator's PDS via custom lexicons |
| Auth model | ATProto for creators, anonymous for participants | Scheduling tools die if anyone can't participate; creator owns the data |
| Core UX | Full half-hour grid with click-and-drag | The grid is the whole point — no watered-down day-level or block-level alternatives |
| Architecture | Split: web app + separate Telegram bot | Matches ecosystem patterns (navidrome-jam + scenius-digest bot). ATProto PDS is shared state. |
| Stack | Vite + React + shadcn/ui + Tailwind + Express | Modern, matches LettuceMeet's polish. shadcn for components, custom AvailGrid. |
| Deployment | Railway, avails.zhgnv.com | Single service (API + static). Telegram bot = future service #2. |
| Email | Resend + ical-generator | .ics calendar invites on finalize. No invite-to-fill emails. |
| Community integration | Banners in MC/DN (navidrome-jam pattern) | store/avails.js + AvailsBanner.jsx, poll /api/polls?community=X |

## Lexicon Design

Namespace: `chat.avails.scheduling`

### chat.avails.scheduling.poll

Created by the organizer, stored in their PDS.

```json
{
  "$type": "chat.avails.scheduling.poll",
  "title": "Team standup",
  "description": "Finding a weekly slot",
  "dates": ["2026-04-07", "2026-04-08", "2026-04-09"],
  "timeRange": { "start": "09:00", "end": "17:00" },
  "slotMinutes": 30,
  "timezone": "Europe/Belgrade",
  "community": "scenius",
  "status": "open",
  "finalTime": null,
  "finalDuration": null,
  "notifyAfter": 5,
  "notifyVia": "email",
  "notifyEmail": "artem@example.com",
  "notifyTelegram": null,
  "createdAt": "2026-04-02T12:00:00Z"
}
```

### chat.avails.scheduling.response

Each participant's availability. Stored in the creator's PDS (server writes on behalf of anonymous participants using creator's OAuth session).

```json
{
  "$type": "chat.avails.scheduling.response",
  "poll": "at://did:plc:creator/chat.avails.scheduling.poll/abc123",
  "name": "Maria",
  "did": "did:plc:maria",
  "email": "maria@example.com",
  "slots": ["2026-04-07T09:00", "2026-04-07T09:30", "2026-04-08T14:00"],
  "createdAt": "2026-04-02T14:00:00Z"
}
```

**Key decisions:**
- `slots` is a flat array of ISO datetime strings (start of each selected half-hour). Simple to merge, sort, count overlaps.
- `community` field enables filtering for MC/DN integration.
- `response` records reference the poll via AT URI.
- `did` and `email` are both optional on responses — anonymous participants provide neither or just email.
- Anonymous responses written by the server using creator's stored OAuth session.

## Architecture

```
┌─────────────────────────────────────────────┐
│                 avails.zhgnv.com             │
│                                             │
│  ┌──────────┐     ┌──────────────────────┐  │
│  │ React SPA│────▶│  API Server (Express) │  │
│  │ (Vite)   │     │                       │  │
│  │          │     │  /api/auth/atproto    │  │
│  │ - Grid UI│     │  /api/polls           │  │
│  │ - Poll   │     │  /api/responses       │  │
│  │   view   │     │  /api/calendar/google │  │
│  └──────────┘     └──────────┬───────────┘  │
│                              │               │
│                    Railway Service #1         │
└──────────────────────────────┼───────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Creator's PDS│ │ Google Cal   │ │  MC/DN       │
     │              │ │ API          │ │  (polls via  │
     │ poll records │ │ (read-only)  │ │  PDS or API) │
     │ response     │ │              │ │              │
     │ records      │ │              │ │              │
     └──────────────┘ └──────────────┘ └──────────────┘

┌─────────────────────────────────────────────┐
│         Telegram Bot (future)               │
│                                             │
│  - Reminders to fill availability           │
│  - Notification when time is picked         │
│  - Creator threshold notifications          │
│                                             │
│                Railway Service #2            │
└─────────────────────────────────────────────┘
```

**Data flow:**

1. **Create poll**: Creator signs in via ATProto OAuth → server writes `poll` record to their PDS → returns shareable link (`avails.zhgnv.com/p/{did}/{rkey}`)
2. **Add availability**: Participant opens link → enters name → optionally connects Google Calendar → paints grid → server writes `response` to creator's PDS
3. **Creator notification**: On each new response, server checks count against `notifyAfter` threshold → sends email or Telegram notification
4. **View results**: Anyone with the link sees the heatmap overlay of all responses, color-coded by overlap count
5. **Finalize**: Creator picks a time → server updates poll record with `finalTime` + `finalDuration` → generates .ics → emails all participants who left their email
6. **Google Calendar**: Participant optionally connects Google → client-side OAuth → busy times overlaid on grid as dimmed cells (read-only, never stored)
7. **MC/DN integration**: Polls with a `community` field discoverable via `GET /api/polls?community=X`

## Server API

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/auth/login` | — | Initiates ATProto OAuth flow |
| GET | `/api/auth/callback` | — | OAuth callback, stores session |
| GET | `/api/auth/session` | cookie | Returns current user (DID, handle, avatar) |
| POST | `/api/auth/logout` | cookie | Clears session |
| POST | `/api/polls` | ATProto | Creates poll record in creator's PDS |
| GET | `/api/polls/:did/:rkey` | — | Reads poll + all responses from creator's PDS |
| GET | `/api/polls?community=X&status=open` | — | Lists active polls for a community (for MC/DN) |
| PUT | `/api/polls/:did/:rkey/finalize` | ATProto | Sets finalTime, sends .ics emails |
| DELETE | `/api/polls/:did/:rkey` | ATProto | Deletes poll (creator only) |
| POST | `/api/polls/:did/:rkey/responses` | — | Submits availability (anonymous or ATProto) |
| PUT | `/api/polls/:did/:rkey/responses/:responseRkey` | — | Edits existing response |
| POST | `/api/calendar/google` | — | Google OAuth token exchange proxy |
| GET | `/api/communities` | — | Proxies scenius-digest `/api/groups` |

**Session storage**: Creator's ATProto OAuth session stored server-side (encrypted, in-memory with Redis fallback). Needed to write anonymous responses to creator's PDS.

## UX Flow

### Poll Creation (single page)

One page, stacked vertically — fixing LettuceMeet's multi-page problem:

1. Title + description
2. Date picker — calendar widget, click/drag to select date range
3. Time range — two dropdowns (earliest/latest), slot size toggle (30min default)
4. Community — optional dropdown (from scenius-digest /api/groups)
5. Notifications — threshold count + email/Telegram
6. "Create poll" → generates shareable link

ATProto sign-in required before this page (one-time).

### Adding Availability (name first, then paint)

1. Participant opens poll link → sees poll header
2. **First**: enters name (or signs in with ATProto)
3. **Optional**: "Connect Google Calendar" → busy times dimmed on grid
4. **Then**: paints availability on the grid (click-and-drag)
5. **Optional**: "Get a calendar invite when a time is picked?" → enters email
6. **Submit**

### Grid Interaction

- **Columns** = selected dates (with day-of-week headers)
- **Rows** = half-hour time slots within poll's time range
- **Paint mode**: click-and-drag to select contiguous green cells. Click again to deselect.
- **Calendar underlay**: Google Calendar busy times shown as hatched/dimmed cells (can override)
- **Mobile**: tap individual cells, or tap-and-swipe for contiguous selection

### Results View (default when responses exist)

- **Heatmap**: color intensity = overlap count (1 = lightest, all = darkest green). No availability = white/grey.
- **Hover tooltip**: "3/5 available — Alice, Bob, Carol"
- **Sidebar**: participant list with colored dots. Hover name → their slots highlight. Click to toggle visibility.
- **Best time badge**: contiguous block with maximum overlap gets a subtle highlight
- **"Pick this time" button**: creator clicks on the best slot → finalize dialog → sends .ics to all opted-in emails

## Pages and Components

### Pages (React Router)

| Route | Page | Description |
|-------|------|-------------|
| `/` | Landing | Create a new poll (auth required) |
| `/p/:did/:rkey` | Poll view | Grid, responses, results |
| `/auth/callback` | OAuth callback | ATProto OAuth redirect handler |

### Components

| Component | Purpose |
|-----------|---------|
| `PollCreator` | Single-page creation form (shadcn Calendar, Input, Button, Select) |
| `AvailGrid` | Custom — paint, heatmap, hover, calendar underlay. Tailwind + shadcn color tokens. |
| `NameEntry` | Name input + optional ATProto sign-in + optional Google Calendar connect |
| `ResponsePanel` | Sidebar: participant list, toggle visibility (shadcn Card, Badge) |
| `PollHeader` | Title, creator handle/avatar, timezone, share link, status badge |
| `HoverTooltip` | Who's available on cell hover (shadcn Tooltip) |
| `AuthButton` | "Sign in with Bluesky" for poll creators |
| `CalendarOverlay` | Google Calendar busy times as hatched cells on grid |
| `FinalizeDialog` | Creator picks a time, confirms, triggers .ics emails (shadcn Dialog) |

## Project Structure

```
avails/
├── client/
│   ├── src/
│   │   ├── components/        # All components above
│   │   │   └── ui/            # shadcn components
│   │   ├── pages/             # Landing, PollView, AuthCallback
│   │   ├── lib/               # ATProto auth, Google Calendar, utils
│   │   ├── styles/            # Tailwind config, global styles
│   │   └── main.jsx
│   ├── index.html
│   ├── tailwind.config.js
│   ├── components.json        # shadcn config
│   └── vite.config.js
├── server/
│   ├── src/
│   │   ├── routes/            # auth, polls, responses, calendar, communities
│   │   ├── lib/
│   │   │   ├── atproto.js     # PDS record operations via @atproto/lex Client
│   │   │   ├── ical.js        # .ics generation
│   │   │   ├── email.js       # Resend integration
│   │   │   └── session.js     # OAuth session storage (encrypted)
│   │   └── index.js           # Express app
│   └── package.json
├── lexicons/                  # Custom ATProto lexicon definitions
│   └── chat/avails/scheduling/
│       ├── poll.json
│       └── response.json
├── generated/                 # Output of `lex build`
├── package.json
├── CLAUDE.md
└── README.md
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@atproto/lex` | Lexicon codegen, typed Client API, validation |
| `@atproto/oauth-client-node` | Server-side ATProto OAuth |
| `express` | API server |
| `resend` | Email with .ics attachments |
| `ical-generator` | .ics file creation |
| `react` + `react-dom` | UI |
| `react-router` | Client routing |
| `vite` | Build tool |
| `tailwindcss` | Utility-first CSS |
| `shadcn/ui` | Component library (via MCP) |

## MC/DN Integration

**Discovery mechanism**: The server maintains a lightweight index of active polls (DID + rkey + community + status + response count). This index is updated on poll creation and response submission. It's ephemeral — rebuilt from PDS reads on server restart. This avoids needing a database while enabling the community listing endpoint.

Same pattern as navidrome-jam:

- `store/avails.js` — polls `GET /api/polls?community=X&status=open`, 5-min interval
- `AvailsBanner.jsx` — shown in SessionsPanel, poll title + response count + "Add your availability →" link
- `avails.css` — banner styling
- `manifest.json` — add `https://avails.zhgnv.com/*` to permissions

DN integration deferred — same pattern when DN has a participation feed.

## Email Flow

1. Participant submits availability with optional email
2. Creator finalizes a time via FinalizeDialog
3. Server updates poll record: `finalTime` + `finalDuration`
4. Server reads all responses, filters those with emails
5. Generates .ics (iCalendar) with poll title, description, time, timezone, location (if any)
6. Sends via Resend to each email with .ics attachment
7. Recipients' email clients prompt "Add to calendar?"

## Creator Notifications

1. Creator sets threshold during poll creation: `notifyAfter: 5`, `notifyVia: "email"`
2. On each new response, server checks count
3. When threshold reached → email: "5 people have filled in availability for 'Team standup'. Pick a time →"
4. Implementation: simple counter check in POST /responses handler, no cron needed

## References

- [LettuceMeet](https://lettucemeet.com/) — the product we're building an alternative to
- [When2Meet vs LettuceMeet UX case study](https://uxdesign.cc/when2meet-vs-lettucemeet-a-case-study-in-ui-and-aesthetics-9d80402eee54) — key UX lessons (single-page creation, name-first flow)
- [@atproto/lex README](https://github.com/bluesky-social/atproto/tree/main/packages/lex/lex) — custom lexicons, Client API, lex build codegen
- [navidrome-jam](../../../navidrome-jam/) — reference for community integration pattern (banners in MC)
- [community-admin](../../../community-admin/) — reference for Resend magic link auth pattern
