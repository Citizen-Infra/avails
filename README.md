# avails

Open-source group scheduling on the AT Protocol. An alternative to [LettuceMeet](https://lettucemeet.com/) where your polls live in your Bluesky account — not a centralized database.

**Live at [avails.zhgnv.com](https://avails.zhgnv.com)**

## How it works

1. **Sign in with Bluesky** — your poll is stored as an ATProto record in your PDS
2. **Pick dates and times** — single-page creation, no multi-step wizard
3. **Share the link** — participants paint their availability on a drag-to-select grid. No account needed.
4. **Pick a time** — the heatmap shows where everyone overlaps. Finalize and calendar invites (.ics) are sent automatically.

## Why ATProto?

Most scheduling tools store your data on their servers. If the company shuts down, pivots, or gets acquired — your polls, your history, your community's scheduling patterns disappear with it.

Avails is built on the [AT Protocol](https://atproto.com/) (the open protocol behind [Bluesky](https://bsky.app)). This means:

- **You own your data.** When you create a poll, it's stored as a record in your Personal Data Server (PDS) — the same place your Bluesky posts live. It's your data, on your account, under your control.
- **No lock-in.** If avails disappears tomorrow, your polls are still in your PDS. Anyone can build another client that reads the same data using the same [open lexicon schema](lexicons/).
- **Portable identity.** You sign in with your Bluesky handle. No new account, no new password. Your identity works across every ATProto app.
- **Interoperable by design.** The poll and response formats are defined as [Lexicons](https://atproto.com/guides/lexicon) — open schemas that any developer can use. Other scheduling tools, community dashboards, or bots can read and create the same records.

You don't need to know or care about any of this to use avails. It works like any other scheduling tool. But under the hood, your data isn't trapped in someone else's database.

## Features

- **Drag-to-paint availability grid** — click and drag to mark when you're free, like LettuceMeet and When2Meet
- **No account to respond** — participants just open the link and paint. Optional email for calendar invites.
- **Calendar invites** — when a time is picked, everyone who left their email gets an `.ics` invite that shows up in Google Calendar, Outlook, Apple Calendar
- **Google Calendar overlay** — connect your calendar to see busy times on the grid before marking availability
- **Community-scoped** — tag polls to a community. They show up in [My Community](https://github.com/Citizen-Infra/my-community) and [Dear Neighbors](https://github.com/Citizen-Infra/dear-neighbors) dashboards.
- **Creator notifications** — get an email when enough people have responded
- **Schedule on the grid** — creator selects a time block directly on the heatmap, seeing everyone's availability while choosing
- **Edit and delete** — participants can edit or delete their availability after submitting
- **Mobile responsive** — grid adapts to small screens with horizontal scroll
- **OpenMeet integration** — publish scheduled meetings as [OpenMeet](https://platform.openmeet.net) events. Calendar availability from OpenMeet (in progress — [openmeet-api#573](https://github.com/OpenMeet-Team/openmeet-api/issues/573))

## Stack

| Layer | Tech |
|-------|------|
| Client | React 19, Vite, Tailwind CSS, shadcn/ui |
| Server | Express 4, Node.js (ES modules) |
| ATProto | `@atproto/lex` (custom lexicons + Client API), `@atproto/oauth-client-node` |
| Email | Resend + ical-generator |
| Deploy | Railway |

## Development

```bash
# Server (API + ATProto OAuth)
cd server && npm install && npm run dev

# Client (React SPA)
cd client && npm install && npm run dev
```

The client dev server proxies `/api` requests to the Express server on port 3000.

### Environment variables

Copy `server/.env.example` and fill in:

```
PORT=3000
CLIENT_URL=http://localhost:5173
ATPROTO_CLIENT_ID=https://avails.zhgnv.com/client-metadata.json
ATPROTO_REDIRECT_URI=https://avails.zhgnv.com/api/auth/callback
SESSION_SECRET=<random string>
RESEND_API_KEY=<from resend.com>
```

### Google Calendar integration (optional)

Participants can connect their Google Calendar to see busy times on the grid. To enable:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the **Google Calendar API** (APIs & Services > Library > search "Google Calendar API" > Enable)
4. Go to **APIs & Services > Credentials > Create Credentials > OAuth Client ID**
5. Application type: **Web application**
6. Authorized JavaScript origins: `https://avails.zhgnv.com` (and `http://localhost:5173` for local dev)
7. No redirect URI needed (uses Google Identity Services client-side flow)
8. Copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`)

Set it as an environment variable:

```
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

Note: `VITE_` prefix means it's baked into the client build — needs a redeploy after changing.

**Google OAuth consent screen requirements:**
- Set to "External" for public access
- Privacy policy URL: `https://avails.zhgnv.com/privacy`
- Terms URL: `https://avails.zhgnv.com/terms`
- Verify domain ownership via Google Search Console
- **To go to production:** the `calendar.readonly` scope requires a demo video showing how the app uses calendar data. Until approved, only manually added test users can connect their calendar. Record a screen capture of: open poll → click Connect Google Calendar → grant access → busy times appear on grid.

## ATProto Lexicons

Two custom record types in [`lexicons/`](lexicons/):

**`chat.avails.scheduling.poll`** — the scheduling poll (dates, time range, slot duration, community tag, notification preferences). Stored in the creator's PDS.

**`chat.avails.scheduling.response`** — a participant's availability (name, selected time slots, optional email). Stored in the creator's PDS on their behalf.

TypeScript types are generated with `npx @atproto/lex build`.

## API

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/auth/login?handle=` | — | ATProto OAuth flow |
| GET | `/api/auth/callback` | — | OAuth callback |
| GET | `/api/auth/session` | cookie | Current user |
| POST | `/api/polls` | ATProto | Create poll |
| GET | `/api/polls/:did/:rkey` | — | Get poll + responses |
| GET | `/api/polls?community=X` | — | List community polls |
| PUT | `/api/polls/:did/:rkey/finalize` | ATProto | Pick a time, send invites |
| POST | `/api/polls/:did/:rkey/responses` | — | Submit availability |
| GET | `/api/communities` | — | List communities |

## Part of Citizen Infrastructure

Avails is part of the [Citizen Infrastructure](https://github.com/Citizen-Infra) ecosystem — community tools built on open protocols.

- [my-community](https://github.com/Citizen-Infra/my-community) — online community dashboard as a new tab
- [dear-neighbors](https://github.com/Citizen-Infra/dear-neighbors) — neighborhood dashboard
- [community-admin](https://github.com/Citizen-Infra/community-admin) — admin platform for community organizers to manage participation opportunities
- [navidrome-jam](https://github.com/zhiganov/navidrome-jam) — synchronized music listening

### Roadmap

**Now — hardening:**
- [Server-side input validation](https://github.com/Citizen-Infra/avails/issues/27) for poll creation and responses
- [Health check with PDS verify](https://github.com/Citizen-Infra/avails/issues/25)

**Next — OpenMeet integration:**
- [OpenMeet as calendar layer](https://github.com/Citizen-Infra/avails/issues/32) — replace direct Google Calendar with OpenMeet's availability API (blocked by [openmeet-api#573](https://github.com/OpenMeet-Team/openmeet-api/issues/573))
- [OpenMeet event publishing](https://github.com/Citizen-Infra/avails/issues/31) — auto-create events on schedule
- [Server-side calendar OAuth](https://github.com/Citizen-Infra/avails/issues/6) as fallback for users without OpenMeet
- [Create calendar events directly](https://github.com/Citizen-Infra/avails/issues/7) via API on finalize (not just .ics email)

**Later — ecosystem:**
- [Telegram bot](https://github.com/Citizen-Infra/avails/issues/9) for reminders and invites (Railway service #2)
- [Video conferencing links](https://github.com/Citizen-Infra/avails/issues/19) — Zoom, Google Meet, Jitsi
- [Dear Neighbors integration](https://github.com/Citizen-Infra/avails/issues/10) — poll banners in DN participation feed

**Endgame — [instant scheduling from chat](https://github.com/Citizen-Infra/avails/issues/11):**

Team members connect their calendars once. Then anyone can run a command in Telegram or Discord:

```
@avails schedule @alice @bob @carol next week 1 hour
```

The bot queries everyone's calendars, finds the first open slot, and books it. No poll, no grid, no back-and-forth. This turns avails from an async scheduling tool into a real-time scheduling engine for teams that already share calendar access.

Requires: [#6](https://github.com/Citizen-Infra/avails/issues/6) (persistent calendar tokens) + [#9](https://github.com/Citizen-Infra/avails/issues/9) (Telegram bot) + identity linking.

**Vision — shared ATProto identity across the ecosystem:**

Today, My Community uses Bluesky app passwords for the Bluesky feed, and avails has its own ATProto OAuth login. These are separate auth sessions. When the ecosystem adopts ATProto OAuth as the shared identity layer, several things unlock:

- **Zero-friction scheduling from MC/DN.** Click an avails poll banner and go straight to painting availability — your identity is already known.
- **Create polls without leaving the dashboard.** Embed the poll creator directly in MC. Your OAuth session writes to your PDS.
- **Smarter banners.** MC shows "You haven't responded yet" vs "You responded (3 slots)" by checking responses against your DID.
- **One login for everything.** Sign into MC once, authenticated everywhere. ATProto DID as universal identity.

Identity and data as protocol primitives, not per-app silos.

## License

AGPL-3.0
