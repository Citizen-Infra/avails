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

Optional: set `VITE_GOOGLE_CLIENT_ID` in client env for Google Calendar integration.

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

- [my-community](https://github.com/Citizen-Infra/my-community) — Chrome extension dashboard (shows avails poll banners)
- [dear-neighbors](https://github.com/Citizen-Infra/dear-neighbors) — neighborhood dashboard
- [community-admin](https://github.com/Citizen-Infra/community-admin) — shared admin platform
- [navidrome-jam](https://github.com/zhiganov/navidrome-jam) — synchronized music listening

## License

AGPL-3.0
