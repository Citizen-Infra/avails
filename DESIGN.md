---
name: avails
description: Warm, communal group scheduling — a shared surface for a group to converge on a time.
colors:
  paper-cream: "#faf9f6"
  gather-teal: "#0d9488"
  deep-teal: "#0f766e"
  warm-ink: "#1a1a1a"
  stone: "#6b6560"
  ash: "#8a8580"
  mist: "#a09a94"
  linen-border: "#d8d4cf"
  hairline: "#e8e5df"
  oat: "#f5f3ef"
  consensus-green: "#22c55e"
  conflict-rose: "#f87171"
  confirmed-green: "#15803d"
  confirmed-bg: "#f0fdf4"
  destructive: "#dc2626"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 5vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.1em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.gather-teal}"
    textColor: "{colors.paper-cream}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  button-outline:
    backgroundColor: "{colors.paper-cream}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.lg}"
  avail-cell:
    backgroundColor: "{colors.oat}"
    height: "32px"
  scheduled-card:
    backgroundColor: "{colors.gather-teal}"
    textColor: "{colors.paper-cream}"
    rounded: "{rounded.md}"
---

# Design System: avails

## 1. Overview

**Creative North Star: "The Village Notice Board"**

avails is a shared surface a group gathers around to converge on a time, not a product trying to convert them. The feel is a warm public board in a co-op hallway: paper-toned, unhurried, legible to anyone who walks up, with no gate to pass and no one selling anything. Warmth is structural here, carried by a cream-paper ground and a hand-warmed neutral scale, never by ornament. The single teal accent behaves like a marker pen on that board: it means "available", "selected", "this is the action", and nothing else.

The system explicitly rejects four things, in line with the product's anti-references: the **corporate-SaaS** busy-dashboard with its upsell banners and "Book a demo"; the **crypto/web3** neon-on-black costume (avails is ATProto-backed, but sovereignty is a quiet guarantee, never a flex); the **generic AI-template** look of purple gradients, identical card grids and hero-metric blocks; and **clinical minimalism**, the cold grey-on-white austerity that would make a communal tool feel like a tax form. The warmth is the differentiator. When in doubt, the move is to remove decoration and keep the kindness.

Density is low and the grid is the protagonist. Chrome recedes; the availability heatmap is the one thing in focus.

**Key Characteristics:**
- Warm paper ground (`#faf9f6`), never pure white, never cold grey.
- One accent — Gather Teal — used sparingly and meaningfully.
- Flat by default; a single elevated hero (the scheduled-time card).
- Mobile-first, because the highest-volume user is an anonymous responder on a phone.
- Availability legible without color via interaction (tap-to-reveal who's free) plus aria-label counts, not green saturation alone.

## 2. Colors

A warm, paper-based neutral field with one teal accent and a two-color data semantic (green = consensus, rose = conflict).

### Primary
- **Gather Teal** (`#0d9488`): the only brand color. Marks the user's own availability (translucent wash over cells), the primary action buttons, selection/scheduling state, and the finalized-time card. Its scarcity is what gives it meaning.
- **Deep Teal** (`#0f766e`): companion only, used as the gradient terminus on the scheduled-time card. Never appears alone.

### Tertiary (data semantics)
- **Consensus Green** (`#22c55e`): the availability heatmap. Opacity scales 0.2 → 0.9 with the share of respondents available in a slot. Quantity of agreement, rendered as saturation.
- **Conflict Rose** (`#f87171`): calendar busy-times overlaid on the grid (translucent, so the heatmap reads underneath).
- **Confirmed Green** (`#15803d` on `#f0fdf4`): the "Scheduled" success card after finalize.

### Neutral (the warm scale — this is the soul of the system)
- **Paper Cream** (`#faf9f6`): the page ground everywhere. The single most important color in the system.
- **Warm Ink** (`#1a1a1a`): primary text. A warm near-black, never `#000`.
- **Stone** (`#6b6560`) / **Ash** (`#8a8580`) / **Mist** (`#a09a94`): the secondary-to-tertiary text ramp.
- **Linen Border** (`#d8d4cf`) / **Hairline** (`#e8e5df`) / **Oat** (`#f5f3ef`): borders, dividers, and the warm tint of an empty grid cell (never a white void).

### Named Rules
**The Single Voice Rule.** Gather Teal is the only brand hue. If a second accent color is entering a screen, it is a mistake; reach for weight, size, or a neutral instead.

**The Email Link Exception (2026-08-02).** Deep Teal (`#0f766e`) is permitted **alone**, for body-size link text in transactional email only. Gather Teal on Paper Cream measures **3.56:1**, which clears AA for large text and UI but falls under the 4.5:1 required for normal text, and an email body link is normal text. Deep Teal measures **5.28:1**. This is the single carve-out from the companion-only rule above; it does not extend to the app, where teal appears at larger sizes or as a UI surface rather than as body-size text. See `server/src/lib/email-template.js`.

**The No Cold Grey Rule.** Every neutral is warmed toward paper. Pure greys are forbidden on brand surfaces. (Note: the shadcn base layer in `globals.css` ships cold `oklch(... 0 0)` neutrals with chroma 0; those leak coldness into any unstyled shadcn component and must be overridden, not inherited.)

## 3. Typography

**Display / Body / Label Font:** Geist Variable (with `ui-sans-serif, system-ui, sans-serif` fallback).

**Character:** One typeface does everything. Geist is a clean, slightly technical humanist sans; warmth comes from the cream ground and generous spacing, not from a decorative display face. The restraint is intentional and on-brand.

### Hierarchy
- **Display** (700, `clamp(1.875rem, 5vw, 3rem)`, line-height 1.1, `-0.02em`): page and poll titles.
- **Title** (600, 1.25rem): section headers, the finalized-time statement.
- **Body** (400, 1rem, line-height 1.5): descriptions, coaching copy. Cap measure at 65–75ch.
- **Label** (500, 0.6875rem, `0.1em`, uppercase): day-of-week column headers, status eyebrows ("SCHEDULED"). `tabular-nums` on all times and dates.

### Named Rules
**The One Typeface Rule.** Geist carries the entire system. No serif display, no second family. Hierarchy is weight and scale only.

## 4. Elevation

Flat by default, with exactly one deliberately elevated element. Surfaces sit directly on the paper ground separated by hairline borders and warm tonal tints, not shadows. Depth is tonal, not cast.

The single exception is the **scheduled-time card**, which floats over the grid with a teal gradient and a real shadow (`0 2px 8px rgba(13,148,136,0.3)` plus an inset highlight) and a slow shimmer. This is the peak-end moment — the group found its time — and it is the only place the system raises its voice.

### Named Rules
**The Flat-With-One-Hero Rule.** Surfaces are flat. The only earned shadow in the system is the scheduled-time card. If a new shadow is being added anywhere else, tonal layering is the answer instead.

## 5. Components

### Buttons
- **Shape:** gently rounded (`rounded-lg`, 10px). shadcn/ui `cva` base.
- **Primary:** in-app primary actions are Gather Teal on cream (the save card, schedule confirm). Note: the shadcn `default` variant is Warm-Ink-on-light; brand-primary teal is applied contextually, not as the token default (see Don'ts).
- **Hover / Focus:** subtle background shift; `focus-visible` ring (3px, `ring/50`). `active` nudges 1px down — a small tactile confirmation.
- **Outline / Ghost / Destructive:** outline on cream for secondary; destructive is a restrained tinted style (`destructive/10` bg, red text), not a loud solid red.

### Cards / Containers
- **Corner Style:** `rounded-xl` (14px) for result cards, `rounded-lg` for the grid container.
- **Background:** cream or a soft tinted gradient (the green `#f0fdf4 → #ecfdf5` confirmation card).
- **Border:** hairline (`#e8e5df` / `#bbf7d0`). Flat — no shadow except the scheduled hero.
- **Internal Padding:** 24–32px (`p-6 sm:p-8`).

### The Availability Cell (signature component)
- 32px-tall (`h-8`) grid cells. Empty = warm Oat (`#f5f3ef`), never white.
- Three composited layers: heatmap base (inline green), the user's "mine" teal wash on top, and a rose busy wash — stacked via `background-image` linear-gradients so all three signals read at once.
- Hairline grid lines via `::after` at `z-index:-1`; hour boundaries get a stronger line for vertical scanning.
- Drag-select with a dashed hover outline; a first-cell pulse animation coaches the empty state.

### Navigation
- Minimal top bar: logo + wordmark left, sparse text links right (`#6b6560`, hover to Warm Ink). No app-shell sidebar.

## 6. Do's and Don'ts

### Do:
- **Do** ground every screen on Paper Cream (`#faf9f6`). It is the system.
- **Do** reserve Gather Teal (`#0d9488`) for availability, selection, and the primary action only. Scarcity is the point.
- **Do** keep surfaces flat; convey depth with warm tints and hairline borders.
- **Do** keep the availability heatmap legible without color via **interaction**: tapping a cell (or a name) reveals who is actually available, plus per-cell `aria-label` counts and a hover tooltip. Don't rely on green saturation alone, and don't clutter every cell with a resting number. (WCAG 1.4.1 / 2.1 AA.)
- **Do** design the phone first; the highest-volume user is an anonymous responder on mobile.
- **Do** override shadcn's cold base neutrals with the warm scale.

### Don't:
- **Don't** ship the **corporate-SaaS** look: no upsell banners, no "Book a demo", no busy dashboards, no gradient marketing heroes.
- **Don't** wear the **crypto/web3** costume: no neon-on-black, no glassmorphism, no decentralization hype. Sovereignty is quiet.
- **Don't** produce the **generic AI-template** look: no purple gradients, no identical card grids, no hero-metric blocks, no emoji-bullet feature lists.
- **Don't** fall into **clinical minimalism**: no cold grey-on-white, no pure `#000`/`#fff`, no austere whitespace-and-Helvetica.
- **Don't** introduce a second brand accent. One voice.
- **Don't** add shadows outside the single scheduled-time hero card.
- **Don't** use `border-left`/`border-right` colored stripes as accents, or gradient text.
