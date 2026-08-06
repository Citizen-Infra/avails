# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Community and civic organizers — fediverse / ATProto / Bluesky groups, co-ops, grassroots and public-interest collectives — coordinating a meeting time without handing a group's data to a corporate scheduler.

Two distinct roles, with sharply different contexts:

- **The creator/organizer** is motivated, often a repeat user, and signed in (ATProto). They create the poll, watch responses arrive, and pick the final time.
- **The responder** is the volume user and the one who matters most: often anonymous (no login), arriving from a shared link on whatever device they have, with mixed technical fluency. Every point of friction here costs the organizer a response.

## Product Purpose

Avails finds a time a group can meet. It is an open-source, ATProto-backed alternative to LettuceMeet/Doodle: polls are stored in the creator's own PDS, responders mark availability on a grid, and the organizer schedules the winning slot (optionally pushing it to Google Calendar / OpenMeet).

Scope is deliberately narrow: **time-finding, not event management.** It is not an RSVP system, not a calendar app, not an events platform. Success = a group converges on a time with the fewest possible taps, and the responder never has to make an account.

## Positioning

**Your polls live in your own account, and anyone can build another client that reads them.**

Most scheduling tools keep your data on their servers; if the company shuts down or pivots, the polls and the group's scheduling history go with it. Avails stores each poll as a record in the creator's Personal Data Server — the same place their Bluesky posts live — under an open lexicon (`chat.avails.scheduling.*`). Two consequences a neighboring product cannot truthfully copy without rebuilding on the same protocol:

- **No lock-in that depends on our goodwill.** If Avails disappears, the records remain in users' PDSs and are readable by any other client.
- **Interoperable by construction.** The poll, response, and standing-availability schemas are public. Other schedulers, community dashboards, and bots read and write the same records — which is how My Community and Dear Neighbors surface Avails polls without an integration contract.

Sovereignty is the mechanism, never the pitch. A user does not need to know any of this for the product to work.

## Operating Context

- A poll's life is a **shared link**. The organizer creates, pastes the URL into a group chat, and responders arrive cold from that one link, usually on a phone, often without ever visiting the site again.
- Groups are **cross-timezone by default**. The grid renders in each viewer's local time.
- The organizer's downstream tools are where the answer has to land: an `.ics` in email, Google Calendar, OpenMeet, a Telegram channel, or a community dashboard.
- Avails is one tool in the **Citizen Infrastructure** ecosystem and is read by its siblings — My Community and Dear Neighbors surface community-scoped polls; community-admin gates community membership; agents drive it through an MCP endpoint.
- **Adoption is the live constraint, not capability.** Features ship to a small real user base, so a new capability's usage data does not exist until someone tells people it is there.

## Capabilities and Constraints

**Confirmed capabilities.** Drag-to-paint availability grid (mouse, touch, keyboard); anonymous responding with no account; heatmap overlap ranking; finalize with `.ics` invites by email; Google Calendar busy-time overlay and event insert/cancel; OpenMeet publish and availability; community-scoped polls and a community feed; creator notification thresholds; standing availability (participant-owned records, per group, so a call can be booked with no poll at all); meeting links on a scheduled poll; an MCP endpoint exposing eleven tools for agent-driven use.

**Constraints.**

- **No database.** ATProto PDS is the data store. Anything that would need a global index across users' repos is not directly possible — there is no way to ask ATProto for "every availability record scoped to this group" without first knowing the repos.
- **Records are world-readable.** Nothing secret may be stored in a PDS record, ever.
- **The responder must never be required to sign in.** This is a hard product constraint, not a default.
- **AGPL-3.0**, so a hosted derivative owes its source back.
- **Self-hosting is real but undocumented.** The stack runs standalone; nobody has written the guide. Future work may say it is self-hostable and must not imply that doing so is currently easy or supported.

**Terminology.** A *poll* finds a time. A *response* is one person's availability on one poll. *Standing availability* is a person's general availability for a group, published once, independent of any poll. *Finalize* / *schedule* means picking the winning slot; *unschedule* reverses it.

## Brand Personality

Warm, human, communal. Avails should feel like a tool a co-op made for its members, not a SaaS product trying to convert them. Voice is plain, friendly, and low-ceremony. The warmth comes from tone, color temperature, and generosity of language, not from decoration or mascots. Confident enough to stay quiet: it does one job and makes that job feel easy.

## Anti-references

- **Corporate SaaS / enterprise** (Calendly/Doodle busy dashboards, upsell banners, "Book a demo", gradient marketing heroes). This is precisely what the audience is trying to escape.
- **Crypto / web3 aesthetic** (neon-on-black, glassmorphism, decentralization hype). Avails is ATProto-backed but must never wear the web3 costume; sovereignty is a quiet guarantee, not a flex.
- **Generic AI-template look** (purple gradients, identical card grids, hero-metric blocks, emoji-bullet feature lists). The "an AI made this" tells.
- **Sterile / clinical minimalism** (cold grey-on-white, zero warmth, Helvetica-and-whitespace austerity). Too cold for a communal tool.

## Brand Commitments

- **The name is "Avails" in anything user-facing** — headings, docs, comms, marketing. Lowercase `avails` is the repo, the package, and code identifiers only.
- **License: AGPL-3.0.** Stewarded by the **Citizen Infrastructure Builders Club (CIBC)**, not owned by a company.
- **Live at `avails.citizeninfra.org`.** `avails.zhgnv.com` permanently redirects there as of 2026-08-04; sign-in and MCP answer on the new host only.
- No advertising, no upsell, no "Book a demo", and no telemetry that would undercut the sovereignty claim.

## Evidence on Hand

- **Real deployment.** Live and in use at `avails.citizeninfra.org`.
- **Real use.** CIBC uses it, and there is some genuine use beyond CIBC. **No outside community may be named** in any copy until someone confirms which ones are citable.
- **Public code and schemas.** The repo, the lexicons under `lexicons/`, and a documented API are all real and linkable.
- **Deliberate absences — future work must not fabricate these.** There are no testimonials, no user counts, no case studies, no press, no benchmarks, and no logo wall. The README's screenshot is still a TODO, so there is no canonical product image either. Nothing may be invented to fill any of these.

## Product Principles

1. **The responder is the most important user.** They're anonymous, on a phone, with one shared link. Optimize for zero-friction participation above all else; no login, no setup, no confusion about what to tap.
2. **Get out of the way.** The availability grid is the hero. Chrome, copy, and controls should recede so the task is the only thing in focus.
3. **Warmth without noise.** Communal warmth lives in tone and color temperature, not in ornament. When in doubt, remove the decoration and keep the kindness.
4. **Sovereign, quietly.** Data lives in the user's own PDS. The design should convey trust and the absence of surveillance, never lecture about decentralization.
5. **Works for everyone in the group.** Mixed devices and abilities are the norm, not the edge case. Mobile-first, WCAG 2.1 AA, and an availability heatmap that never relies on color alone.
6. **Time-finding is the whole job.** Confirmed 2026-08-06 against the pressure from standing availability and meeting links: both stay in scope because they make finding a time faster, not because they add a new job. A capability that answers a *different* question — RSVPs, agendas, attendance, event pages — is out, however adjacent it looks.
7. **Interoperability is the durable claim.** Open lexicons are the reason a sibling tool can read Avails data without an integration. Prefer a change that keeps records readable by other clients over one that only this client understands.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Keyboard operable, sufficient contrast, screen-reader labels on interactive grid cells and controls, visible focus states, and respect for `prefers-reduced-motion`. Because the core interaction is a color-coded availability heatmap, encode availability with a redundant non-color cue (numbers, patterns, or text) so it remains legible to colorblind users.
