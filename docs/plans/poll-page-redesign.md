# Poll Page Redesign — IA-Driven Design Pass

Design proposals addressing IA audit findings #62-#69. Each section shows the problem, the design direction, and implementation code.

## Design Principles

Stay within the existing warm-minimal language (off-white, teal, Geist). Don't redesign the brand — **redesign the information hierarchy**.

1. **State-first**: Each page state (open/painting/saved/finalized) should be instantly recognizable
2. **Action-near-context**: Buttons appear where the user's attention already is
3. **Progressive revelation**: Show what's needed now, offer what's needed next
4. **Mobile-native**: Design for 320px first, enhance for desktop

---

## 1. Poll Status — Visual Mode Shift (#62)

**Problem**: Small `text-sm` badge next to title. Status is the most important state.

**Direction**: Don't badge it — **color the entire header zone** based on state. Open polls get the warm white. Finalized polls get a distinct tinted background that wraps title + result, creating an instant visual mode shift.

### Open state (no change to title area)
```jsx
// PollHeader.jsx — open state stays warm
<div className="space-y-3">
  <div className="flex items-start gap-3">
    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#1a1a1a] flex-1 min-w-0">
      {poll.title}
    </h1>
    <span className="shrink-0 mt-1.5 text-sm px-3 py-1.5 rounded-full font-medium bg-[#ccfbf1] text-[#0d9488]">
      Open
    </span>
  </div>
  {poll.description && (
    <p className="text-lg text-[#6b6560] leading-relaxed">{poll.description}</p>
  )}
</div>
```

### Finalized state — result-first banner replaces header zone (#62 + #67)
```jsx
// When poll.finalTime exists, the header zone transforms into a result card
// This replaces both the old PollHeader badge AND the separate finalized banner
<div className="rounded-xl bg-gradient-to-br from-[#f0fdf4] to-[#ecfdf5] border border-[#bbf7d0] p-6 sm:p-8 space-y-4">
  {/* Result is the hero */}
  <div className="flex items-center gap-2 text-[#15803d]">
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <span className="text-sm font-semibold uppercase tracking-wide">Scheduled</span>
  </div>
  
  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">
    {poll.title}
  </h1>
  
  <p className="text-xl sm:text-2xl font-medium text-[#15803d]">
    {new Date(poll.finalTime).toLocaleString(undefined, {
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}
    {poll.finalDuration && <span className="text-[#6b6560] text-lg ml-2">({poll.finalDuration} min)</span>}
  </p>

  {/* Secondary actions */}
  <div className="flex items-center gap-3 pt-2">
    {isCreator && !openmeetUrl && (
      <Button variant="outline" size="sm" onClick={handlePublishToOpenMeet} disabled={publishingToOpenMeet}
        className="border-[#15803d] text-[#15803d] hover:bg-[#dcfce7]">
        {publishingToOpenMeet ? 'Publishing...' : 'Publish to OpenMeet'}
      </Button>
    )}
    <Button variant="outline" size="sm" onClick={copyLink} className="border-[#d8d4cf] text-[#6b6560]">
      {copied ? 'Copied!' : 'Copy link'}
    </Button>
  </div>
</div>

{/* Grid is now secondary — collapsed with toggle */}
<details className="group">
  <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[#6b6560] hover:text-[#1a1a1a] py-3">
    <svg className="w-4 h-4 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 4l4 4-4 4"/>
    </svg>
    See availability breakdown ({responses.length} responses)
  </summary>
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-6 pt-2 opacity-80">
    {/* Grid + ResponsePanel render here, slightly dimmed */}
  </div>
</details>
```

**Why this works**: The finalized state becomes a celebration — the result is large, green, and unmistakable. The grid drops to a detail view because its job is done. Users landing on a finalized poll immediately see "this meeting is scheduled for Thursday at 2pm" without parsing a grid.

---

## 2. Mobile Save — Sticky Bottom Bar (#63)

**Problem**: Save card is in the sidebar, below the fold on mobile.

**Direction**: On mobile, the save card becomes a **sticky bottom bar** anchored to the viewport. On desktop, it stays in the sidebar.

```jsx
// New component: SaveBar.jsx — renders in both positions
function SaveBar({ slotCount, onSave, onCancel, submitting, submitError, editing }) {
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      <p className="text-sm font-medium text-white/90">
        {slotCount} slot{slotCount !== 1 ? 's' : ''} selected
      </p>
      <div className="flex items-center gap-2">
        {editing && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}
            className="text-white/80 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
        )}
        <Button onClick={onSave} disabled={submitting}
          className="bg-white text-[#0d9488] font-semibold hover:bg-white/90">
          {submitting ? 'Saving...' : editing ? 'Save changes' : 'Save availability'}
        </Button>
      </div>
      {submitError && <p className="text-xs text-red-200 w-full">{submitError}</p>}
    </div>
  )
}

// In PollView.jsx — render in both locations:

{/* Desktop sidebar — existing position, hidden on mobile */}
{isOpen && !submitted && mySlots.size > 0 && (
  <div className="hidden lg:block rounded-lg bg-[#0d9488] p-4 text-white space-y-3">
    <SaveBar slotCount={mySlots.size} onSave={...} editing={editing} ... />
  </div>
)}

{/* Mobile sticky bar — only visible on small screens */}
{isOpen && !submitted && mySlots.size > 0 && (
  <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-[#0d9488] px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] safe-area-pb">
    <SaveBar slotCount={mySlots.size} onSave={...} editing={editing} ... />
  </div>
)}

// CSS for safe area (notch phones):
// .safe-area-pb { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
```

**Why this works**: The save button is always visible while painting on mobile. No scrolling to commit. The teal bar at the bottom creates urgency — "you've selected slots, now save them."

---

## 3. Onboarding — First Interaction Hint (#64)

**Problem**: No instruction for first-time participants on how to use the grid.

**Direction**: Don't add a tutorial or modal. Use **inline coaching that dissolves on first interaction**. A single line of microcopy above the grid + a subtle pulse animation on the first empty cell.

```jsx
// In PollView.jsx — replace the info bar with a coaching-aware version

{isOpen && !submitted && (
  <div className="space-y-2">
    {/* Identity line */}
    {session?.did ? (
      <p className="text-sm text-[#8a8580]">
        Signed in as <span className="text-[#1a1a1a] font-medium">@{session.handle}</span>
      </p>
    ) : null}
    
    {/* Coaching line — visible until first slot is painted */}
    {mySlots.size === 0 && (
      <p className="text-base text-[#6b6560] flex items-center gap-2">
        <span className="inline-block w-5 h-5 rounded bg-[rgba(34,197,94,0.5)] shrink-0" />
        <span>
          {session?.did 
            ? 'Tap or drag on the grid to mark times you're available'
            : 'Tap or drag to mark your availability, then save to share with the group'
          }
        </span>
      </p>
    )}
    
    {/* Calendar connection — moved below coaching, shown only after engagement */}
    {mySlots.size > 0 && !calendarConnected && (
      <div className="flex items-center gap-4 text-sm">
        {isGoogleConfigured() && (
          <button onClick={connectGoogleCalendar} disabled={connectingCalendar}
            className="text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2">
            {connectingCalendar ? 'Connecting...' : 'Overlay your Google Calendar'}
          </button>
        )}
      </div>
    )}
    
    {calendarConnected && (
      <p className="text-sm text-[#0d9488]">
        Calendar connected{calendarSource === 'openmeet' ? ' via OpenMeet' : ''} — busy times shown in pink
      </p>
    )}
  </div>
)}
```

```css
/* Subtle pulse on first cell to draw attention */
.avail-cell--empty:first-child {
  animation: cell-hint 2s ease-in-out 1s 2; /* 2 pulses after 1s delay */
}

@keyframes cell-hint {
  0%, 100% { background-color: #f5f3ef; }
  50% { background-color: rgba(34, 197, 94, 0.15); }
}

/* Stop animation once any cell is selected (add this class to grid container) */
.avail-grid--has-selection .avail-cell--empty:first-child {
  animation: none;
}
```

**Why this works**: 
- The green square swatch next to the text creates a visual link between the instruction and the grid color
- Coaching disappears the moment you start painting (no dismissal needed)
- Calendar connect is deferred until you're already engaged (progressive disclosure, #I)
- The cell pulse is subtle — it says "start here" without being annoying

---

## 4. Post-Save Selection Visibility (#66)

**Problem**: After saving, user's own slots disappear into the aggregated heatmap.

**Direction**: In read-only mode when the user has a saved response, render their slots with a **teal dot marker** in the corner of each cell. Doesn't obscure the heatmap but confirms "these are yours."

```css
/* avail-grid.css — new state for "my saved slot" in read-only view */
.avail-cell--mine-saved {
  position: relative;
}

.avail-cell--mine-saved::before {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #0d9488;
  z-index: 2;
  pointer-events: none;
}
```

```jsx
// In AvailGrid.jsx — when readOnly and user has a saved response, compute mySlots overlay
// PollView passes `mySavedSlots` prop (Set of slot keys from the saved response)

// In the cell className:
cn(
  'avail-cell h-8',
  // ... existing classes ...
  readOnly && mySavedSlots?.has(key) && 'avail-cell--mine-saved',
)
```

```jsx
// In PollView.jsx — compute saved slots for overlay
const mySavedSlots = useMemo(() => {
  if (!submitted || !participant?.name) return EMPTY_SET
  const myResponse = responses.find(r => r.name === participant.name)
  if (!myResponse) return EMPTY_SET
  return new Set(convertSlotsToViewer(myResponse.slots, poll?.timezone))
}, [submitted, participant, responses, poll?.timezone])

// Pass to AvailGrid:
<AvailGrid {...gridProps} mySavedSlots={mySavedSlots} ... />
```

**Why this works**: A small teal dot is unobtrusive — it doesn't fight with the heatmap colors but gives a clear "these are mine" signal. The teal matches the app's accent color, reinforcing "this is your contribution."

---

## 5. ResponsePanel Discoverability (#68)

**Problem**: Bidirectional highlight is powerful but invisible.

**Direction**: Add a hint line and make the interactive nature obvious with cursor and hover treatment.

```jsx
// ResponsePanel.jsx — updated
<div className="space-y-4">
  <div>
    <div className="w-8 h-1 bg-[#0d9488] rounded-full mb-2" />
    <div className="text-sm font-semibold text-[#1a1a1a] uppercase tracking-wide">
      {responses.length} {responses.length === 1 ? 'response' : 'responses'}
    </div>
    {responses.length > 0 && (
      <p className="text-xs text-[#a09a94] mt-1">Tap a name to see their availability</p>
    )}
  </div>
  <ul className="space-y-0.5">
    {responses.map((r) => {
      // ... existing logic ...
      return (
        <li key={r.name}>
          <button
            type="button"
            className={cn(
              'w-full text-left px-3 py-2.5 rounded-md text-base transition-all duration-150',
              'cursor-pointer',  /* explicit pointer cursor */
              'hover:bg-[#f0eeea]',
              isActive && 'bg-[#f0eeea] ring-1 ring-[#0d9488]/30',  /* ring shows "selected" */
              isAvailableAtHover && 'bg-[#f0fdf4]',
              isUnavailableAtHover && 'opacity-40'
            )}
            // ...
          >
            {/* ... */}
          </button>
        </li>
      )
    })}
  </ul>
</div>
```

---

## 6. PollHeader — Metadata/Actions Separation (#65)

**Direction**: Split into two rows. Metadata above, actions below with clear hierarchy.

```jsx
// PollHeader.jsx — restructured
<div className="space-y-4">
  {/* Title + status */}
  <div className="flex items-start gap-3">
    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#1a1a1a] flex-1 min-w-0">
      {poll.title}
    </h1>
    <span className={`shrink-0 mt-1.5 text-sm px-3 py-1.5 rounded-full font-medium ${
      isOpen ? 'bg-[#ccfbf1] text-[#0d9488]' : 'bg-[#f0eeea] text-[#8a8580]'
    }`}>
      {isOpen ? 'Open' : 'Scheduled'}
    </span>
  </div>

  {/* Description */}
  {poll.description && (
    <p className="text-lg text-[#6b6560] leading-relaxed">{poll.description}</p>
  )}

  {/* Metadata row — informational only */}
  <div className="flex items-center gap-3 flex-wrap text-sm text-[#a09a94]">
    {poll.timezone && (
      <span>
        {Intl.DateTimeFormat().resolvedOptions().timeZone === poll.timezone
          ? poll.timezone
          : `Showing times in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
      </span>
    )}
    {poll.community && (
      <span className="px-2.5 py-1 rounded-full border border-[#e8e5df] text-xs font-medium text-[#6b6560]">
        {poll.community}
      </span>
    )}
  </div>

  {/* Actions row — separated, with hierarchy */}
  <div className="flex items-center gap-2 flex-wrap">
    {isCreator && isOpen && onScheduleClick && !schedulingMode && (
      <Button onClick={onScheduleClick} className="bg-[#0d9488] text-white hover:bg-[#0f766e]">
        Schedule meeting
      </Button>
    )}
    <Button variant="outline" onClick={copyLink} className="border-[#d8d4cf] text-[#6b6560] hover:bg-[#f0eeea]">
      {copied ? 'Copied!' : 'Copy link'}
    </Button>
    {isCreator && isOpen && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="text-[#6b6560] hover:bg-[#f0eeea]">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEditClick && <DropdownMenuItem onClick={onEditClick}>Edit poll</DropdownMenuItem>}
          {onDeleteClick && (
            <DropdownMenuItem onClick={onDeleteClick} className="text-red-600">Delete poll</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
  </div>
</div>
```

**Why this works**: 
- Metadata (timezone, community) on its own line — read before acting
- Primary action (Schedule) is prominent; secondary (Copy) is outline; tertiary (Edit/Delete) behind a "..." menu
- The "..." menu solves the mobile button overflow (#52) naturally
- Requires installing `@shadcn/dropdown-menu` (DropdownMenu + lucide-react MoreHorizontal icon)

---

## Implementation Order

1. **SaveBar sticky mobile** (#63) — highest user impact, independent change
2. **PollHeader restructure** (#65) — prerequisite for status redesign
3. **Post-save dot markers** (#66) — small CSS-only change, high clarity gain
4. **Onboarding coaching** (#64) — copy + CSS, no structural change
5. **ResponsePanel hint** (#68) — one line of text + cursor fix
6. **Finalized state redesign** (#62 + #67) — largest change, do last

Each can be shipped independently as a PR.
