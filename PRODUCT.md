# Product

## Register

product

## Users

Community and civic organizers — fediverse / ATProto / Bluesky groups, co-ops, grassroots and public-interest collectives — coordinating a meeting time without handing a group's data to a corporate scheduler.

Two distinct roles, with sharply different contexts:

- **The creator/organizer** is motivated, often a repeat user, and signed in (ATProto). They create the poll, watch responses arrive, and pick the final time.
- **The responder** is the volume user and the one who matters most: often anonymous (no login), arriving from a shared link on whatever device they have, with mixed technical fluency. Every point of friction here costs the organizer a response.

## Product Purpose

avails finds a time a group can meet. It is an open-source, ATProto-backed alternative to LettuceMeet/Doodle: polls are stored in the creator's own PDS, responders mark availability on a grid, and the organizer schedules the winning slot (optionally pushing it to Google Calendar / OpenMeet).

Scope is deliberately narrow: **time-finding, not event management.** It is not an RSVP system, not a calendar app, not an events platform. Success = a group converges on a time with the fewest possible taps, and the responder never has to make an account.

## Brand Personality

Warm, human, communal. avails should feel like a tool a co-op made for its members, not a SaaS product trying to convert them. Voice is plain, friendly, and low-ceremony. The warmth comes from tone, color temperature, and generosity of language, not from decoration or mascots. Confident enough to stay quiet: it does one job and makes that job feel easy.

## Anti-references

- **Corporate SaaS / enterprise** (Calendly/Doodle busy dashboards, upsell banners, "Book a demo", gradient marketing heroes). This is precisely what the audience is trying to escape.
- **Crypto / web3 aesthetic** (neon-on-black, glassmorphism, decentralization hype). avails is ATProto-backed but must never wear the web3 costume; sovereignty is a quiet guarantee, not a flex.
- **Generic AI-template look** (purple gradients, identical card grids, hero-metric blocks, emoji-bullet feature lists). The "an AI made this" tells.
- **Sterile / clinical minimalism** (cold grey-on-white, zero warmth, Helvetica-and-whitespace austerity). Too cold for a communal tool.

## Design Principles

1. **The responder is the most important user.** They're anonymous, on a phone, with one shared link. Optimize for zero-friction participation above all else; no login, no setup, no confusion about what to tap.
2. **Get out of the way.** The availability grid is the hero. Chrome, copy, and controls should recede so the task is the only thing in focus.
3. **Warmth without noise.** Communal warmth lives in tone and color temperature, not in ornament. When in doubt, remove the decoration and keep the kindness.
4. **Sovereign, quietly.** Data lives in the user's own PDS. The design should convey trust and the absence of surveillance, never lecture about decentralization.
5. **Works for everyone in the group.** Mixed devices and abilities are the norm, not the edge case. Mobile-first, WCAG 2.1 AA, and an availability heatmap that never relies on color alone.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Keyboard operable, sufficient contrast, screen-reader labels on interactive grid cells and controls, visible focus states, and respect for `prefers-reduced-motion`. Because the core interaction is a color-coded availability heatmap, encode availability with a redundant non-color cue (numbers, patterns, or text) so it remains legible to colorblind users.
