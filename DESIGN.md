---
name: Avails
description: Open Index adapted to a communal time-finding tool; the grid is the working surface.
colors:
  page: "#F4F44D"
  surface: "#FFFFFF"
  task-ground: "#FFFDD4"
  action: "#2545EF"
  action-hover: "#1832CA"
  ink: "#14233A"
  secondary-ink: "#253749"
  muted-ink: "#3C4B5E"
  border: "#C8CE91"
  control-border: "#53667B"
  selected: "#E2E8FF"
  text-selection: "#FF744E"
  success: "#1E5B3F"
  success-surface: "#E2F1E9"
  success-border: "#3F7C5D"
  warning: "#714300"
  warning-surface: "#FFF1CF"
  warning-border: "#9C6800"
  danger: "#9A2831"
  danger-surface: "#FBE7E7"
  danger-border: "#BC4350"
  data-empty: "#FFFFFF"
  data-low: "#E2E8FF"
  data-mid: "#B3BEF9"
  data-high: "#2545EF"
typography:
  display:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 3vw, 4rem)"
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.25rem + 2vw, 3rem)"
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5
  body-phone:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
  grid-label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "0.15rem"
  md: "0.2rem"
  lg: "0.25rem"
  xl: "0.35rem"
  pill: "3.40282e38px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  compact: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "0.625rem 0.625rem"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-outline:
    backgroundColor: "{colors.task-ground}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "0.625rem 0.625rem"
  button-ghost:
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "0.5rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.25rem 0.625rem"
  navigation:
    backgroundColor: "{colors.page}"
    textColor: "{colors.secondary-ink}"
  status-tag:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.action}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.75rem"
  poll-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.25rem"
  scheduled-result:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
    padding: "1.5rem"
  avail-cell:
    backgroundColor: "{colors.data-empty}"
    height: "1.5rem"
  scheduled-stamp:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "2px 4px"
---

# Design System: Avails

## Overview

**Creative North Star: "Open Index"**

Avails uses the selected Citizen Infrastructure Open Index family: a yellow public-facing field, blue actions, Public Sans and calm, ruled task surfaces. It remains a plain, communal time-finding tool, not a marketing performance or an event-management dashboard. The anonymous responder on a phone sets the density requirement; the timetable gets the reading space.

The canonical foundation is [`Citizen-Infra/design-system`](https://github.com/Citizen-Infra/design-system/tree/6df5682711d11d1dde20453d0e06a78aca48b34f), revision `6df5682711d11d1dde20453d0e06a78aca48b34f` (`0.2.0-draft.1`), installed through immutable HTTPS Git. This supersedes Village Notice Board, Geist and the single-teal app palette. Product truth and plain language remain in [PRODUCT.md](PRODUCT.md). This record describes the implemented light-only frontend, not unused package themes or every package display minimum. Server email styling is outside this frontend system.

Source authority: [role adapter](client/src/styles/globals.css), [app geometry/type](client/src/styles/open-index.css), [grid states](client/src/styles/avail-grid.css) and [grid presentation helpers](client/src/lib/gridPresentation.js). Frontmatter records their resolved canonical values; implementation must keep consuming package roles rather than copying a second palette.

**Key Characteristics:**
- Yellow masthead and landing-route field; pale task ground; blue actions and footer.
- Public Sans, whole-word headings and task-specific phone density.
- Compact borderless dated poll grids; layered blue overlap, blue/white personal checks and neutral conflict marks. Recurring weekly grids retain their existing rules.
- Existing shadcn/Radix control owners and native mouse, touch and keyboard interactions.
- Availability counts and names recoverable through interaction and accessible labels, not resting in-cell numbers.

## Colors

Bright yellow/blue identity surrounds a quieter working surface. White is an intentional canonical surface; the old pure-white and cool-neutral prohibitions no longer apply.

### Primary
- **Index Yellow** (`page`): masthead and the `/` route's field, including signed-in creation, and inverse footer focus. Dated poll selections do not use yellow.
- **Action Blue** (`action`, `action-hover`): primary actions, links, footer, save surfaces, dense scheduled stamps and the grid's overlap axis. White provides inverse text; stamps retain their check and full time range.

### Secondary
- **Selection Pale Blue** (`selected`): open status tags and pending/finalized grid selection; component text uses its assigned action role.
- **Text-selection Coral** (`text-selection`): native text selection only. This is not a warm panel theme.

### Tertiary
- **Overlap scale** (`data-empty`, `data-low`, `data-mid`, `data-high`): scoped inside `.avail-cell`, remap to surface white, selection pale blue, a 35% action-blue/white mix and action blue respectively. Frontmatter records these grid-local resolved values, not changes to upstream package tokens. For poll-wide peak count `m`, each vote contributes opacity `1/m`; the composed blue weight for count `c` is `(1 − (1 − 1/m)^c) / (1 − (1 − 1/m)^m)`. Thus layers get lighter as the peak grows and the greatest overlap reaches 100% blue, whether unanimous or not. Compute the peak across all dates, not only the visible page. Zero overlap stays white. Low supplies the empty-cell hint; pending edits use canonical selected/white surfaces.
- **Success**, **Warning** and **Danger**: retain separate text/surface/border families for confirmed results, cleanup warnings, errors and deletion outside the grid. Calendar conflicts instead use sparse opaque ink/white hatching and an opaque white/ink title tag, not a danger wash.

### Neutral
- **Task Ground** (`task-ground`) and **Surface White** (`surface`): main poll ground and controls/cards/popovers respectively.
- **Ink**, **Secondary Ink** and **Muted Ink**: readable hierarchy; ink also supplies focus outlines.
- **Rule** (`border`) and **Control Rule** (`control-border`): light dividers versus input, outer-grid and hour-boundary definition.

**The Signal Separation Rule.** In dated polls, use blue intensity for overlap, a small blue/white check for ownership, neutral hatching for conflict, check/minus previews for pending edits and a check/time stamp for finalized time. No resting slot rules or yellow ownership edges. Never mix state fills into a third hue or rely on blue alone to identify scheduled time. Keep keyboard focus explicit.

## Typography

**Display / Body / Control Font:** Public Sans, with `ui-sans-serif, system-ui, sans-serif` fallback. Normal and italic variable files cover weights 400–700; fonts are bundled locally through the package font stylesheet imported by [main.jsx](client/src/main.jsx).

**Character:** Direct, public-facing sans typography with a substantial title and compact working labels. Weight and spacing carry hierarchy; no second display family is introduced.

### Hierarchy
- **Display:** the larger landing-route H1 applies to both signed-out introduction (700) and signed-in “New poll” (600), with an 18ch maximum measure.
- **Headline:** ordinary page/poll H1, usually 700; the page clamp is approximately 30–48px at the default root. Display is approximately 36–64px. These are responsive rem-based roles, not fixed pixel root sizing.
- **Title:** the common section role is 600 at 1.25rem; result text has its existing 1.25–1.5rem responsive assignment.
- **Body:** fallback body is 1.125rem on desktop, 1rem below 50rem, line-height 1.5. Explicit utility copy/control assignments often remain 1–1.25rem; not every desktop paragraph is 18px.
- **Control / Grid label:** ordinary controls use 1rem; grid labels and metadata use 0.875rem. Compact dated stamps use 0.75rem so a check and the complete range fit one 24px row on narrow dates. Grid dates use 1rem. Time-axis labels use line-height 1; stamp ranges use 1.2. Dates and times use tabular numerals.

**The Working Type Rule.** Proportionate phone density and whole-word headings take precedence over the shared package's display-sized floors. Keep the root resizable; never force a fixed root font or hyphenate ordinary heading words to fit.

## Layout

Retain the standard product layout: a compact masthead, title/actions/timezone, then the grid. Poll content uses a centered 64rem maximum; landing and creation use 56rem, with 1–1.5rem responsive horizontal gutters. At the existing 64rem large breakpoint the poll can use a 14rem response/save sidebar; below it the save strip is fixed to the bottom. Poll main content reserves 8rem bottom space when that strip exists.

The spacing rhythm is quarter-rem based. Working groups usually use 0.5–1.5rem gaps, cards 1–2rem padding and major groups 3rem separation. The masthead has intrinsic height with a 4rem minimum and wrapping controls, not a fixed clipping box.

Dated poll rows are 1.5rem (24px at the default root) tall, a dense two-dimensional painting exception to ordinary 44px controls. A 12-hour half-hour field is 576px instead of 1,056px. Separate dates with 0.25rem gutters, not cell borders. Scope the height to `.avails-dated-grid`; recurring weekly rows remain 2.75rem. Reserve a 4rem time axis and budget 6rem per date/day: capacity is `clamp(1, floor((width − 4 × rootSize) / (6 × rootSize)), 7)`. Both dated grids balance pages within that capacity; weekly pages use the same width budget. Keep selected slot keys across page/width changes instead of squeezing seven columns into a phone. Weekly phone grids scroll with the outer page and keep visible/sticky day headers; the first time label is not negatively shifted into the header.

## Elevation & Depth

Flat at rest: fields, poll cards, result panels and scheduled stamps use solid tones, not a hero gradient or shimmer. Dated grid selections use checks rather than inset edges; focus rings communicate keyboard position, not elevation. Existing Radix dialogs/menus retain their overlay behavior and utility shadows; the package's overlay-shadow token is not a new universal card style.

The empty-cell hint runs twice over 2s after a 1s delay, stops on selection and is removed under reduced motion. Cell background transitions use 0.1s ease; reduced motion removes them. Do not turn this small coaching cue into ambient animation.

## Shapes

Small, practical corners: the adapter's base control radius is 0.25rem; its small/medium/extra-large derivatives are recorded in frontmatter. Result sections use the small derivative, ordinary controls and poll cards the base, and status pills the full radius. Dated grid cells are square, borderless and contiguous within each date. Weekly grid rules retain their non-intercepting one-pixel overlays. Do not substitute unused larger package radii.

## Components

### Buttons
Existing shadcn buttons, not a replacement control framework. Primary actions use action blue on white with contextual action-hover; outline and ghost actions recede into the ground. Standard data-slot buttons have a 2.75rem minimum height, intrinsic height and wrapping text, with 0.625rem vertical padding. Icon actions have the same minimum width. Calendar day buttons deliberately retain their seven-column matrix with a 2rem minimum height: this is a dense two-dimensional exception, not an exact rendered height or a general action target.

Focus uses the canonical ink outline (3px, offset 3px), with existing shadcn rings where assigned. Enabled native actions retain the existing one-pixel active nudge. Destructive/error styling remains semantic; existing dialog/control owners remain authoritative.

### Inputs / Fields
White surfaces, control-border strokes and base-radius corners. Inputs retain 0.625rem horizontal / 0.25rem vertical padding and a 2.75rem minimum height. Placeholders use muted ink; focus uses ink/ring and invalid state uses danger. Dialog content scrolls within `100dvh − 2rem` rather than growing beyond the phone.

### Cards / Containers
Poll-list cards are white, ruled, unshadowed and base-radius, with 1rem vertical / 1.25rem horizontal padding; their border turns action blue on hover. Confirmed result panels use success text/surface/border, small corners and 1.5rem padding, increasing to 2rem at the small breakpoint. An explicit scheduled label and full result statement remain outside the dense stamp.

### Chips / Tags
Open status is a pale-blue pill with action text. Scheduled poll-list status uses the existing neutral treatment. Community tags are small-cornered, outlined metadata. Calendar tags stay compact with ink text and border on opaque white; full titles are recovered through the grid's accessible name, wrapping tooltip and native disclosure, not by shrinking the tag.

### Navigation
Yellow top bar, existing sixteen-cell blue/white logo and Avails wordmark; sparse familiar navigation, no new app-shell sidebar. The footer is blue with white copy and yellow inverse focus. The standalone SVG favicon reuses the same mark geometry and resolves the two roles from the pin; it is not new artwork.

### Availability grid
In dated polls the blue/white overlap base is unchanged by personal ownership: a small blue square with a white check marks personal slots; newly painted slots without saved overlap use selected pale blue. Busy cells retain sparse white/ink diagonal strokes and full-title recovery. Pending add uses pale blue with a check; removal previews white with a minus. Tentative organizer selection uses pale blue and a check, not the finalized time stamp. Hover is a faint blue wash with no outline. Only tapped read-only state and keyboard focus use inset outlines; white focus separation remains visible on solid blue. Preserve selection controllers, dates, timezone conversion, counts and accessible names. The 24px row and 0.25rem date gutter are scoped to these two poll grids, not weekly patterns.

Preserve drag painting, touch painting, roving focus and arrow/Space/Enter interactions. Organizer touch movement uses hit-testing within its own grid while retaining the single-date constraint. Counts/names remain available through existing tap/focus/hover and ARIA presentation; noninteractive tooltips must not intercept painting in nearby dense rows. Do not invent resting in-cell counts. In AvailGrid, the full existing local conflict title is included even when availability counts are absent. A native details/summary readout below and outside the paint container groups contiguous conflicts on visible dates and exposes date/start time/title without changing selection or calling a provider.

**Passive overlay hit-testing rule.** For portalled grid tooltips, disable pointer events on both the visible content and its positioning wrapper, scoped by `.avails-grid-tooltip`; disabling only the content leaves an invisible hit area. Verify the actual `elementFromPoint` target beneath an open, wrapped tooltip and repeat add/remove gestures without dismissing it first. Do not apply this policy to interactive popovers or unrelated tooltips.

**Roving-focus verification rule.** Keyboard navigation applies DOM focus on the next animation frame. Wait for the expected row/column to be the active, focus-visible, `tabIndex=0` cell before reading its outline; do not resolve an arbitrary `:focus-visible` cell and inspect it after focus may have moved away. Reset repeated scenarios through supported keyboard/pointer input or a fresh mount, not DOM `.focus()` alone: programmatic DOM focus does not update the grid's internal navigation coordinates. A failed test setup or unsynchronized sample alone is not evidence of a missing product focus ring.

### Scheduled stamp
Solid blue with a white check and complete unbroken time range at 0.75rem in dated polls, with no additional outline. It spans `rowCount × slotHeight − 2px`, using the same row variable as the grid. “Scheduled” is screen-reader-only inside this compact stamp; the result panel and cell accessible labels state it explicitly. Do not claim a visible word that is not painted.

## Do's and Don'ts

### Do:
- **Do** consume pinned canonical roles and separate grid meanings with intensity, edges, hatching and explicit stamps rather than unrelated hues.
- **Do** prioritize anonymous phone responders, proportional text, whole-word headings and user font resizing.
- **Do** preserve keyboard/touch behavior and non-color recovery of counts, names, conflicts and scheduled time.
- **Do** keep dated timetables compact and borderless, with checks/minus signs for selection/editing and explicit keyboard focus.
- **Do** retain the existing logo geometry and separate AGPL app, MIT shared-code and OFL font notices.

### Don't:
- **Don't** restore Geist/teal authority, fork a competing palette or treat unused package dark/warm/fresh themes as implemented product features.
- **Don't** squeeze seven dates into every viewport, fix the root font size or force shared display floors onto phone controls.
- **Don't** rely on color alone, hide full conflict titles behind clipped tags or insert counts into every resting cell.
- **Don't** add promotional eyebrows, gradient text, accent stripes, crypto styling, advertising or invented testimonials/user numbers.
- **Don't** treat a local visual review as WCAG certification, live integration verification or publication approval.
