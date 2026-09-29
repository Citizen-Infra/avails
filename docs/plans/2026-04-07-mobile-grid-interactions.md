# Mobile Grid Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two mobile UX issues: (1) finger drag to paint multiple slots, (2) tap a slot to see who's available.

**Architecture:** Both fixes are in AvailGrid.jsx. Touch drag adds a `pointermove` document listener that uses `elementFromPoint()` to find cells under the finger. Tap-to-highlight adds an `activeSlot` state that's set on tap in read-only mode, replacing hover-only tooltip behavior. ResponsePanel already dims unavailable names via `hoverSlot` — we reuse that by having taps set it. Use `frontend-design` skill for visual polish.

**Tech Stack:** React 19, Pointer Events API, existing shadcn/ui components, existing CSS in `avail-grid.css`

---

### Task 1: Touch drag painting

**Files:**
- Modify: `client/src/components/AvailGrid.jsx:168-220` (pointer handlers + document listener)

The current drag relies on `pointerenter` which fires when the pointer moves from one element to another. On touch, the finger stays on the originating element — `pointerenter` never fires on neighboring cells. Fix: add a `pointermove` document listener during drag that uses `elementFromPoint()` to find the cell under the finger.

- [ ] **Step 1: Add data attributes to cells for identification**

In the cell `<div>` (around line 321), add `data-row` and `data-col` attributes so `elementFromPoint` can identify which cell the finger is over:

```jsx
<div
  key={key}
  data-row={rowIdx}
  data-col={colIdx}
  className={cn(
    // ... existing classes unchanged
  )}
```

- [ ] **Step 2: Add pointermove handler**

Add a `handlePointerMove` callback after the existing `handlePointerEnter` (around line 195). This uses `elementFromPoint` to find the cell under the touch point:

```jsx
const handlePointerMove = useCallback(
  (e) => {
    if (!downCell.current) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-row]')
    if (!cell) return
    const row = parseInt(cell.dataset.row, 10)
    const col = parseInt(cell.dataset.col, 10)
    if (isNaN(row) || isNaN(col)) return
    // Skip if same cell as current
    if (curCell.current && curCell.current.row === row && curCell.current.col === col) return
    curCell.current = { row, col }
    const pending = computePendingKeys(downCell.current, { row, col })
    setDragState({ pending, removing: downCellWasSelected.current })
  },
  [computePendingKeys]
)
```

- [ ] **Step 3: Add pointermove document listener alongside pointerup**

Replace the existing `useEffect` for the document-level `pointerup` listener (lines 217-220) to also attach `pointermove`:

```jsx
useEffect(() => {
  document.addEventListener('pointerup', commitDrag)
  document.addEventListener('pointermove', handlePointerMove)
  return () => {
    document.removeEventListener('pointerup', commitDrag)
    document.removeEventListener('pointermove', handlePointerMove)
  }
}, [commitDrag, handlePointerMove])
```

- [ ] **Step 4: Test touch drag on mobile**

Open the app on a mobile device or Chrome DevTools device emulation. Verify:
- Finger drag across cells selects a rectangle of slots (green preview)
- Lifting finger commits the selection
- Drag on already-selected cells removes them (red preview)
- No page scrolling during grid interaction (touch-action: none is already set)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AvailGrid.jsx
git commit -m "fix: enable touch drag painting on mobile grid"
```

### Task 2: Tap-to-highlight slot (who's available)

**Files:**
- Modify: `client/src/components/AvailGrid.jsx` (add `activeSlot` state, tap handler, visual indicator)
- Modify: `client/src/pages/PollView.jsx:523` (pass `setHoverSlot` for tap)
- Modify: `client/src/components/ResponsePanel.jsx` (visual styling for available/unavailable on tap)
- Modify: `client/src/styles/avail-grid.css` (active slot visual)

Currently, hovering a slot sets `hoverSlot` via `onHoverSlot` in `handlePointerEnter`. On mobile there's no hover. Fix: in read-only mode, tapping a cell sets `onHoverSlot` to that slot key (toggle — tap again to clear). Add a visible ring on the active slot so users know which slot they tapped.

- [ ] **Step 1: Add activeSlot state to AvailGrid**

Add state and a new prop for tap-to-select behavior. After the `dragState` state declaration (line 99):

```jsx
const [activeSlot, setActiveSlot] = useState(null) // slot key tapped in read-only mode
```

- [ ] **Step 2: Handle tap in read-only mode**

Modify `handlePointerDown` to track potential taps, and update `commitDrag` (the `pointerup` handler) to detect taps in read-only mode. A "tap" is a `pointerdown` + `pointerup` on the same cell with no drag.

Add a ref to track if we're in a potential tap (after `downCellWasSelected` ref):

```jsx
const tapTarget = useRef(null) // { row, col, key } for detecting taps in read-only mode
```

At the start of `handlePointerDown`, before the `if (readOnly) return`, capture the tap target:

```jsx
const handlePointerDown = useCallback(
  (e, row, col) => {
    const key = `${visibleDates[col]}T${times[row]}`
    if (readOnly) {
      e.preventDefault()
      tapTarget.current = { row, col, key }
      return
    }
    e.preventDefault()
    // ... rest of existing handler unchanged
  },
  [readOnly, mySlots, visibleDates, times]
)
```

Update `commitDrag` to handle taps. Wrap the existing body in an else branch:

```jsx
const commitDrag = useCallback(() => {
  // Handle read-only tap
  if (tapTarget.current) {
    const key = tapTarget.current.key
    tapTarget.current = null
    const newActive = activeSlot === key ? null : key
    setActiveSlot(newActive)
    onHoverSlot?.(newActive)
    return
  }

  if (!downCell.current) return
  // ... rest of existing commitDrag unchanged
}, [mySlots, onSlotsChange, computePendingKeys, activeSlot, onHoverSlot])
```

- [ ] **Step 3: Clear activeSlot when entering edit mode**

When the grid switches from read-only to editable, clear the active slot. After the `activeSlot` state declaration:

```jsx
useEffect(() => {
  if (!readOnly) {
    setActiveSlot(null)
    onHoverSlot?.(null)
  }
}, [readOnly])
```

Note: `onHoverSlot` is stable (`setHoverSlot` from PollView) so it won't cause re-render loops.

- [ ] **Step 4: Invoke `frontend-design` skill for active slot + ResponsePanel visual treatment**

Use the `frontend-design` skill to design:
1. Active slot visual indicator in the grid (the tapped cell needs a visible ring/outline so user knows which slot they selected)
2. ResponsePanel styling for available vs unavailable names when a slot is active (currently just `opacity-40` — could be improved with checkmarks, color, or other treatment)

The designs should respect the existing design system: teal `#0d9488`, warm grays, Geist font. Mobile-first.

- [ ] **Step 5: Apply active slot CSS class to the tapped cell**

In the cell's className computation (around line 323), add the active slot class. After the existing class conditions:

```jsx
activeSlot === key && 'avail-cell--active',
```

Add the CSS for this class in `avail-grid.css` (use the design from Step 4).

- [ ] **Step 6: Apply ResponsePanel visual treatment**

Update `ResponsePanel.jsx` styling based on the frontend-design output from Step 4. The current `isUnavailableAtHover` logic (line 36) already handles dimming — enhance the visual treatment for both available and unavailable states.

- [ ] **Step 7: Test tap-to-highlight on mobile**

Open the app on mobile. Verify:
- Tapping a heatmap slot (in read-only/viewing mode) highlights the tapped cell
- ResponsePanel shows which names are available/unavailable for that slot
- Tapping the same slot again clears the selection
- Tapping a different slot switches to that slot
- Starting to edit (clicking Edit) clears the active slot
- On desktop, hover still works as before (hover and tap coexist)

- [ ] **Step 8: Commit**

```bash
git add client/src/components/AvailGrid.jsx client/src/pages/PollView.jsx client/src/components/ResponsePanel.jsx client/src/styles/avail-grid.css
git commit -m "feat: tap-to-highlight slot on mobile shows who's available"
```

### Task 3: Final push and deploy verification

- [ ] **Step 1: Build client**

```bash
cd client && npx vite build
```

Expected: builds successfully with no errors.

- [ ] **Step 2: Run server tests**

```bash
cd server && npm test
```

Expected: all 33 tests pass (validation + route tests unaffected by client changes).

- [ ] **Step 3: Push and verify Railway deploy**

```bash
git push
```

Verify Railway deploys successfully at avails.zhgnv.com.

- [ ] **Step 4: Test on the CIBC Town Hall poll on actual mobile device**

1. Open the poll on phone
2. Verify touch drag painting works
3. Verify tapping a heatmap slot highlights available names in ResponsePanel
4. Submit a test response with drag-painted slots
