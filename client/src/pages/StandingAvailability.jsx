import { useState, useEffect, useCallback } from 'react'
import AuthButton from '@/components/AuthButton'
import Logo from '@/components/Logo'
import WeeklyPatternGrid, { DAY_ORDER, DAY_LABELS } from '@/components/WeeklyPatternGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { getSession, getMyAvailability, getEventAvailabilityGrant, createAvailability, deleteAvailability } from '@/lib/api'
import { resolveList } from '@/lib/atproto'

const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const SIU_EVENT_DID = 'did:plc:mzvqnxye3oejamuwmfl4qvou'
const TIMEZONE_OPTIONS = (() => {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : null
  } catch {
    return null
  }
})()

function formatDateLocal(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultValidUntil() {
  const d = new Date()
  d.setDate(d.getDate() + 56) // 8 weeks
  return formatDateLocal(d)
}

// ISO datetime -> yyyy-mm-dd for the "Valid until" <input type="date">.
// Deliberately UTC, not local: the write path anchors validUntil at UTC
// midnight (`${form.validUntil}T00:00:00Z`, see handlePublish), so the read
// path must extract the date with the same UTC getters to round-trip
// cleanly. Using local getters here (like formatDateLocal, which is correct
// for genuinely local-calendar dates elsewhere in the app) would read back
// one day earlier for every UTC-negative timezone and re-save shifted on
// every edit — a cumulative drift bug, not a one-time cosmetic one.
function isoToDateInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Human-readable "until <date>" label for a published record. UTC for the same
// reason isoToDateInputValue is (see above): validUntil is anchored at UTC
// midnight, so formatting it in browser-local time renders the previous day for
// every UTC-negative timezone — the record would read "until Sep 10" to a US
// user when it expires on Sep 11. Locale-aware, calendar-date pinned to UTC.
function formatValidUntil(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function groupWeeklyByDay(weekly) {
  const byDay = new Map()
  for (const w of weekly) {
    if (!byDay.has(w.day)) byDay.set(w.day, [])
    byDay.get(w.day).push(`${w.startTime}–${w.endTime}`)
  }
  return DAY_ORDER.filter((d) => byDay.has(d)).map((d) => ({
    day: d,
    label: DAY_LABELS[d],
    ranges: byDay.get(d),
  }))
}

function shortenAtUri(uri) {
  // at://did:plc:xxxxxxxxxxxxxxxxxxxxxxxx/app.bsky.graph.list/rkey -> did:plc:xxxx…/rkey
  const m = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/)
  if (!m) return uri
  const [, authority, rkey] = m
  const shortAuthority = authority.length > 20 ? `${authority.slice(0, 16)}…` : authority
  return `${shortAuthority}/${rkey}`
}

function emptyFormState(eventDid = null) {
  return {
    editingRkey: null,
    // The scope.value the record had when Edit was clicked. Needed because
    // the server upserts by matching scope.value — if the user re-scopes to
    // a different list while editing, the create call below never touches
    // this original record, so it must be deleted explicitly (see #2 in the
    // fix-pass notes).
    editingOriginalScope: null,
    scopeInput: '',
    resolvedScope: eventDid ? { type: 'ca-event', uri: eventDid, name: 'Social Internet Unconference' } : null,
    weekly: [],
    timezone: BROWSER_TIMEZONE,
    trust: 'confirm',
    validUntil: defaultValidUntil(),
  }
}

export default function StandingAvailability() {
  const requestedEventDid = new URLSearchParams(window.location.search).get('event')
  const eventDid = requestedEventDid === SIU_EVENT_DID ? requestedEventDid : null
  const isEventMode = Boolean(eventDid)
  // All hooks declared unconditionally up top — no hooks after early returns
  // (React #310), matching the project's AvailGrid/SchedulingGrid convention.
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(false)

  const [form, setForm] = useState(() => emptyFormState(eventDid))
  const [eventGrant, setEventGrant] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [publishError, setPublishError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [cleanupWarning, setCleanupWarning] = useState(null)

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setSessionLoading(false))
  }, [])

  async function loadRecords() {
    setRecordsLoading(true)
    try {
      const data = await getMyAvailability()
      setRecords(data.records || [])
    } catch {
      setRecords([])
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    if (session?.did) loadRecords()
  }, [session?.did])

  useEffect(() => {
    if (!session?.did || !eventDid) return
    setEventGrant({ loading: true })
    getEventAvailabilityGrant(eventDid)
      .then((status) => setEventGrant(status))
      .catch((err) => setEventGrant({ active: false, unavailable: true, error: err.message }))
  }, [session?.did, eventDid])

  // Stable identity (setForm itself is guaranteed stable by React) so that
  // callbacks built on top of updateForm — like handleWeeklyChange below —
  // can themselves stay stable across renders. WeeklyPatternGrid's commitDrag
  // lists onChange as a dep and tears down/re-adds a document pointerup
  // listener whenever it changes, so an unstable onChange here would churn
  // that listener on every keystroke elsewhere in the form.
  const updateForm = useCallback((patch) => {
    setForm((f) => ({ ...f, ...patch }))
  }, [])

  const handleWeeklyChange = useCallback((weekly) => {
    updateForm({ weekly })
  }, [updateForm])

  function handleScopeInputChange(e) {
    const val = e.target.value
    // Editing the URL invalidates any prior confirmation — Publish must stay
    // gated until the (possibly new) value is re-checked against the AppView.
    updateForm({ scopeInput: val, resolvedScope: null })
    setResolveError(null)
  }

  async function handleCheckList(e) {
    e.preventDefault()
    if (!form.scopeInput.trim()) return
    setResolveError(null)
    setResolving(true)
    try {
      const result = await resolveList(form.scopeInput)
      updateForm({ resolvedScope: { uri: result.uri, name: result.name } })
    } catch (err) {
      updateForm({ resolvedScope: null })
      setResolveError(err.message || 'Could not resolve that list.')
    } finally {
      setResolving(false)
    }
  }

  function handleEdit(record) {
    setForm({
      editingRkey: record.rkey,
      editingOriginalScope: record.scope.value,
      scopeInput: record.scope.value,
      // Pre-filled directly from the published record without re-running
      // resolveList() — it was already validated at publish time, and if the
      // user changes the URL here, handleScopeInputChange clears this and
      // Check List gates Publish again as normal. Not re-verifying on every
      // edit-open avoids a network round trip for the common "just tweak the
      // grid" case.
      resolvedScope: { type: record.scope.type, uri: record.scope.value, name: record.scope.type === 'ca-event' ? 'Social Internet Unconference' : null },
      weekly: record.pattern.weekly,
      timezone: record.timezone,
      trust: record.trust,
      validUntil: isoToDateInputValue(record.validUntil),
    })
    setPublishError(null)
    setResolveError(null)
    setCleanupWarning(null)
    document.getElementById('standing-availability-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleCancelEdit() {
    setForm(emptyFormState(eventDid))
    setPublishError(null)
    setResolveError(null)
    // Cancelling abandons the edit that produced the warning, so it must go too
    // — otherwise a stale "couldn't clean up the old record" line hangs around
    // over an unrelated form.
    setCleanupWarning(null)
  }

  async function handlePublish(e) {
    e.preventDefault()
    setPublishError(null)
    setCleanupWarning(null)

    if (!form.resolvedScope) {
      setPublishError('Check the list before publishing.')
      return
    }
    if (form.weekly.length === 0) {
      setPublishError('Paint at least one weekly window on the grid.')
      return
    }
    if (!form.timezone.trim()) {
      setPublishError('Timezone is required.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        scope: { type: form.resolvedScope.type || 'atproto-list', value: form.resolvedScope.uri },
        pattern: { weekly: form.weekly },
        timezone: form.timezone,
        trust: form.trust,
        validUntil: form.validUntil
          ? new Date(`${form.validUntil}T00:00:00Z`).toISOString()
          : undefined,
      }
      await createAvailability(payload)

      // The server upserts by matching scope.value against the CALLER's
      // existing records. If we're editing and the scope was changed to a
      // DIFFERENT list, the call above creates a brand-new record and never
      // touches the original — it would otherwise stay live and public
      // under its old scope forever. Clean it up explicitly.
      //
      // Best-effort and non-fatal: the new record is already published, so a
      // cleanup failure here must not read as "publish failed" (same spirit
      // as Google Calendar insert/cancel never rolling back finalize — see
      // project CLAUDE.md). Surface it as a separate warning instead; the
      // stale record will also just show up in the reloaded list below,
      // where it can be deleted by hand.
      if (
        form.editingRkey &&
        form.editingOriginalScope &&
        form.editingOriginalScope !== form.resolvedScope.uri
      ) {
        try {
          await deleteAvailability(form.editingRkey)
        } catch (cleanupErr) {
          setCleanupWarning(
            `Saved availability for the new list, but couldn't remove the old public record for ${form.editingOriginalScope}. ` +
            `${cleanupErr.message || 'Delete it from the list below.'}`
          )
        }
      }

      setForm(emptyFormState(eventDid))
      await loadRecords()
    } catch (err) {
      setPublishError(err.message || 'Failed to publish.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAvailability(deleteTarget.rkey)
      setDeleteTarget(null)
      if (form.editingRkey === deleteTarget.rkey) setForm(emptyFormState(eventDid))
      await loadRecords()
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete.')
    } finally {
      setDeleting(false)
    }
  }

  const visibleRecords = records.filter((record) => isEventMode
    ? record.scope?.type === 'ca-event' && record.scope.value === eventDid
    : record.scope?.type !== 'ca-event')
  const canPublish = Boolean(form.resolvedScope) && form.weekly.length > 0 && !submitting
    && (!isEventMode || eventGrant?.active)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 shrink-0">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-foreground">Avails</span>
          </a>
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <a href="/" className="hidden sm:block text-base text-foreground-secondary hover:text-foreground transition-colors">
              My polls
            </a>
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {sessionLoading ? (
          <div className="flex justify-center py-32">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          </div>
        ) : !session?.did ? (
          <div className="py-16 max-w-lg space-y-6">
            <h1 className="font-semibold text-foreground tracking-tight">Standing availability</h1>
            <p className="text-lg text-foreground-secondary leading-relaxed">
               {isEventMode
                 ? 'Share the times you are usually free for the Social Internet Unconference. Sign in with Bluesky to continue.'
                  : "Publish the times you're usually free for a Bluesky list, once, instead of filling out a new poll every time. Sign in with Bluesky to set it up."}
            </p>
            <AuthButton />
          </div>
        ) : (
          <div className="space-y-12">
            <div>
              <h1 className="font-semibold text-foreground tracking-tight">Standing availability</h1>
              <p className="text-lg text-foreground-secondary mt-1">
                 {isEventMode
                   ? 'Set the times you are usually free for the Social Internet Unconference, once.'
                   : "Tell a group the times you're usually free, once, instead of answering a new poll every time."}
               </p>
             </div>

             {isEventMode && eventGrant && !eventGrant.loading && (
               <div className="rounded-sm border border-input bg-muted px-4 py-3">
                 <p className="font-medium text-foreground">
                   {eventGrant.active ? 'Your SIU participation is active' : 'SIU participation is not active'}
                 </p>
                 <p className="mt-1 text-sm text-foreground-secondary">
                   {eventGrant.active
                     ? 'Your availability can count toward finding a shared time for supported topics.'
                     : eventGrant.unavailable
                       ? 'We could not verify participation right now. Try again before publishing.'
                       : 'Follow the SIU Bluesky profile, then return here after verification refreshes.'}
                 </p>
               </div>
             )}

            {cleanupWarning && (
              <p className="text-sm text-destructive">{cleanupWarning}</p>
            )}

            {/* Published records */}
            {recordsLoading ? (
              <div className="flex items-center gap-2 text-base text-muted-foreground py-2">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Loading…
              </div>
            ) : visibleRecords.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-foreground tracking-tight">Published</h2>
                <div className="space-y-3">
                  {visibleRecords.map((record) => {
                    const groups = groupWeeklyByDay(record.pattern.weekly)
                    return (
                      <div
                        key={record.uri}
                        className="rounded-sm border border-border bg-card p-5 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm text-foreground break-all">
                                {shortenAtUri(record.scope.value)}
                              </span>
                              <Badge variant="outline" className="border-primary/30 text-primary">
                                Public on your PDS
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {record.timezone} &middot; {record.trust === 'auto' ? 'Auto-book' : 'Confirm before booking'}
                              {record.validUntil && (
                                <> &middot; until {formatValidUntil(record.validUntil)}</>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleEdit(record)}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-accent hover:text-destructive"
                              onClick={() => { setDeleteTarget(record); setDeleteError(null) }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-foreground-secondary">
                          {groups.map((g) => (
                            <span key={g.day}>
                              <span className="font-medium text-foreground">{g.label}</span> {g.ranges.join(', ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Publish / edit form */}
            <div id="standing-availability-form" className="space-y-8 scroll-mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-foreground tracking-tight">
                   {form.editingRkey ? 'Edit standing availability' : isEventMode ? 'Your SIU availability' : 'Add a list'}
                </h2>
                {form.editingRkey && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    Cancel edit
                  </button>
                )}
              </div>

              <form onSubmit={handlePublish} className="space-y-8">
                {/* Scope picker */}
                 {!isEventMode ? (
                   <div className="space-y-2">
                     <Label htmlFor="scope-input" className="text-base font-medium text-foreground">
                       Bluesky list <span className="text-destructive">*</span>
                     </Label>
                      <p className="text-sm text-foreground-secondary">
                        Paste a list URL (bsky.app/profile/…/lists/…) or an at:// list URI. The list identifies who this availability is for; it does not make the record private.
                     </p>
                     <div className="flex flex-col sm:flex-row gap-2">
                       <Input
                         id="scope-input"
                         placeholder="https://bsky.app/profile/yourhandle.bsky.social/lists/…"
                         value={form.scopeInput}
                         onChange={handleScopeInputChange}
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                             e.preventDefault()
                             handleCheckList(e)
                           }
                         }}
                         className="border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                       />
                       <Button
                         type="button"
                         variant="outline"
                         onClick={handleCheckList}
                         disabled={resolving || !form.scopeInput.trim()}
                         className="border-input text-foreground hover:bg-muted shrink-0 h-8 sm:h-auto"
                       >
                         {resolving ? 'Checking…' : 'Check list'}
                       </Button>
                     </div>
                     {form.resolvedScope && (
                       <p className="text-sm text-primary flex items-center gap-1.5">
                         <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                           <path d="M3 8.5L6.5 12L13 4" strokeLinecap="round" strokeLinejoin="round" />
                         </svg>
                         {form.resolvedScope.name
                           ? <>Verified: &ldquo;{form.resolvedScope.name}&rdquo;</>
                            : <>Availability is for this list</>}
                       </p>
                     )}
                     {resolveError && <p className="text-sm text-destructive">{resolveError}</p>}
                   </div>
                 ) : (
                   <div className="space-y-2">
                     <Label className="text-base font-medium text-foreground">Event</Label>
                     <p className="text-base text-foreground">Social Internet Unconference</p>
                     <p className="break-all text-sm text-muted-foreground">{eventDid}</p>
                   </div>
                 )}

                <div className="border-t border-border" />

                {/* Weekly pattern */}
                <div className="space-y-2">
                  <Label className="text-base font-medium text-foreground">
                    Weekly pattern <span className="text-destructive">*</span>
                  </Label>
                  <WeeklyPatternGrid value={form.weekly} onChange={handleWeeklyChange} />
                </div>

                <div className="border-t border-border" />

                {/* Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="timezone" className="text-base font-medium text-foreground">Timezone</Label>
                    {TIMEZONE_OPTIONS ? (
                      <select
                        id="timezone"
                        value={form.timezone}
                        onChange={(e) => updateForm({ timezone: e.target.value })}
                        className="h-8 w-full rounded-sm border border-input bg-card px-2.5 text-base text-foreground focus-visible:ring-3 focus-visible:ring-ring"
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id="timezone"
                        value={form.timezone}
                        onChange={(e) => updateForm({ timezone: e.target.value })}
                        placeholder="Europe/Berlin"
                        className="border-input bg-card text-foreground focus-visible:ring-ring"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="valid-until" className="text-base font-medium text-foreground">Valid until</Label>
                    <Input
                      id="valid-until"
                      type="date"
                      min={formatDateLocal(new Date())}
                      value={form.validUntil}
                      onChange={(e) => updateForm({ validUntil: e.target.value })}
                      className="border-input bg-card text-foreground focus-visible:ring-ring"
                    />
                  </div>
                </div>

                {/* Trust */}
                 {!isEventMode && <div className="space-y-3">
                  <Label className="text-base font-medium text-foreground">When someone wants this time</Label>
                  <RadioGroup
                    value={form.trust}
                    onValueChange={(v) => updateForm({ trust: v })}
                    className="gap-3"
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <RadioGroupItem value="confirm" id="trust-confirm" className="mt-1 border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
                      <span className="flex-1">
                        <span className="text-base font-medium text-foreground block">Ask me to confirm</span>
                        <span className="text-sm text-muted-foreground block mt-0.5">You'll be asked to confirm before anything is booked into these windows.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <RadioGroupItem value="auto" id="trust-auto" className="mt-1 border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
                      <span className="flex-1">
                        <span className="text-base font-medium text-foreground block">Book automatically</span>
                        <span className="text-sm text-muted-foreground block mt-0.5">Anything requested inside these windows can be booked without asking you first.</span>
                      </span>
                    </label>
                  </RadioGroup>
                 </div>}

                <div className="border-t border-border" />

                {/* Honest disclosure */}
                <p className="text-sm text-foreground-secondary leading-relaxed">
                  {isEventMode
                    ? 'Publishing saves a public availability record to your Bluesky account. Anyone can read it through AT Protocol. It is used to calculate aggregate SIU readiness and does not schedule or invite anyone. It remains public until you delete it, and copies may remain elsewhere afterward.'
                    : 'Publishing saves a public availability record to your Bluesky account. Anyone can read it through AT Protocol. The Bluesky list identifies who the availability is for; it does not restrict access. The record remains public until you delete it, and copies may remain elsewhere afterward.'}
                </p>

                {publishError && <p className="text-sm text-destructive">{publishError}</p>}

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={!canPublish}
                    className="bg-primary text-primary-foreground hover:bg-primary-hover text-lg px-6 py-4 rounded-sm h-auto font-semibold transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Publishing…' : form.editingRkey ? 'Save changes' : 'Publish availability'}
                  </Button>
                  {form.editingRkey && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleCancelEdit}
                      className="text-base text-foreground-secondary hover:text-foreground"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Delete confirmation */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null) } }}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete this standing availability?</DialogTitle>
          </DialogHeader>
          <p className="text-base text-foreground-secondary">
            This removes the record from your Bluesky account, so it will no longer be used for overlap checks. Copies already made elsewhere may remain.
          </p>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="border-input text-foreground-secondary hover:bg-muted hover:text-foreground text-base px-5 py-2 rounded-lg"
                disabled={deleting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-primary-foreground hover:bg-destructive/90 text-base px-6 py-3 rounded-lg transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
