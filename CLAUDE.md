# CLAUDE.md

## Project Overview

**Avails** — open-source ATProto-powered group scheduling tool (LettuceMeet alternative). Polls stored as records in creator's PDS via custom lexicons. Part of the Citizen Infrastructure ecosystem.

## Architecture

- **Server** (`server/`): Express 4, ES modules. ATProto OAuth + PDS record operations via `@atproto/lex`. Email via Resend.
- **Client** (`client/`): React 19 + Vite + Tailwind + shadcn/ui. Availability grid with drag-to-paint.
- **Lexicons** (`lexicons/`): Custom ATProto record types — `chat.avails.scheduling.poll` and `chat.avails.scheduling.response`.

## Skills

Always use `frontend-design` skill for visual/UI tasks. Always query shadcn MCP before hand-rolling component CSS.

## Commands

```bash
# Server
cd server && npm install && npm run dev    # Dev with hot-reload
cd server && npm start                      # Production

# Client
cd client && npm install && npm run dev    # Vite dev server (localhost:5173)
cd client && npm run build                 # Production build -> dist/
```

## Deployment

Railway (single service): Express serves API + client static files.
Domain: avails.zhgnv.com

## Related Projects

- **my-community** (`../my-community/`) — consumes `/api/polls?community=X` for participation feed
- **navidrome-jam** (`../navidrome-jam/`) — reference for Express + Railway + Resend patterns
- **community-admin** (`../community-admin/`) — parent ecosystem
