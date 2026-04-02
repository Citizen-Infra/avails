# avails

Open-source group scheduling on the AT Protocol. An alternative to [LettuceMeet](https://lettucemeet.com/) where your polls live in your Bluesky account — not a centralized database.

**Live at [avails.zhgnv.com](https://avails.zhgnv.com)**

## How it works

1. **Sign in with Bluesky** — your poll is stored as an ATProto record in your PDS
2. **Pick dates and times** — single-page creation, no multi-step wizard
3. **Share the link** — participants paint their availability on a drag-to-select grid. No account needed.
4. **Pick a time** — the heatmap shows where everyone overlaps. Finalize and calendar invites (.ics) are sent automatically.

## What makes this different

- **Your data, your PDS.** Polls are ATProto records ([`chat.avails.scheduling.poll`](lexicons/chat/avails/scheduling/poll.json)), stored in the creator's Personal Data Server. No vendor lock-in.
- **No account to respond.** Participants just open the link and paint their availability. Optional email for calendar invites.
- **Community-scoped.** Polls can be tagged to a community and discovered in [My Community](https://github.com/Citizen-Infra/my-community) and [Dear Neighbors](https://github.com/Citizen-Infra/dear-neighbors) dashboards.
- **Calendar invites.** When a time is picked, everyone who left their email gets an `.ics` invite — it shows up in Google Calendar, Outlook, Apple Calendar.
- **Google Calendar overlay.** Participants can connect their Google Calendar to see busy times on the grid before marking availability.

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
