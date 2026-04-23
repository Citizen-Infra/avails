import Logo from '@/components/Logo'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll, unfinalizePoll, deleteResponse, publishToOpenMeet, getOpenMeetAvailability } from '@/lib/api'
import { isGoogleConfigured, requestGoogleAccess, fetchBusyTimes } from '@/lib/googleCalendar'
import { convertPollTimesToViewer, convertSlotsToViewer, convertSlotsToCreator, getViewerTimezone, needsConversion } from '@/lib/timezone'
import { Button } from '@/components/ui/button'
import AvailGrid from '@/components/AvailGrid'
import SchedulingGrid from '@/components/SchedulingGrid'
import NameEntry from '@/components/NameEntry'
import PollHeader from '@/components/PollHeader'
import ResponsePanel from '@/components/ResponsePanel'
import EditPollDialog from '@/components/EditPollDialog'
import DeletePollDialog from '@/components/DeletePollDialog'
import GuestModal from '@/components/GuestModal'

const EMPTY_SET = new Set()

export default function PollView() {
  const { did, rkey } = useParams()

  const [poll, setPoll] = useState(null)
  const [responses, setResponses] = useState([])
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Restore prior-submission identity from localStorage so guests can
  // edit/delete their response after a refresh. Signed-in users match by
  // DID in a later effect; this is the fallback for anonymous responders.
  const savedResponse = (() => {
    try {
      const raw = localStorage.getItem(`avails:response:${window.location.pathname}`)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })()

  const [participant, setParticipant] = useState(
    savedResponse?.name
      ? { name: savedResponse.name, email: savedResponse.email || '', did: savedResponse.did }
      : null
  )
  const [mySlots, setMySlots] = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [responseRkey, setResponseRkey] = useState(savedResponse?.responseRkey || null)

  const [focusedName, setFocusedName] = useState(null)
  const [hoverSlot, setHoverSlot] = useState(null)
  const [schedulingMode, setSchedulingMode] = useState(false)
  const [schedulingSlots, setSchedulingSlots] = useState([])
  const [schedulingLoading, setSchedulingLoading] = useState(false)
  const [schedulingError, setSchedulingError] = useState(null)
  const [showEditPoll, setShowEditPoll] = useState(false)
  const [showDeletePoll, setShowDeletePoll] = useState(false)
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [openmeetUrl, setOpenmeetUrl] = useState(null)
  const [publishingToOpenMeet, setPublishingToOpenMeet] = useState(false)
  const [openmeetError, setOpenmeetError] = useState(null)
  const [showBreakdown, setShowBreakdown] = useState(false)

  const [busySlots, setBusySlots] = useState(new Set())
  const [slotEvents, setSlotEvents] = useState({})
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarSource, setCalendarSource] = useState(null) // 'openmeet' | 'google' | null
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  // Convert OpenMeet events to busySlots + slotEvents format
  function processCalendarEvents(events) {
    const busy = new Set()
    const slots = {}
    for (const event of events) {
      const start = new Date(event.start)
      const end = new Date(event.end)
      let current = new Date(start)
      const name = event.summary || 'Busy'
      let isFirst = true
      while (current < end) {
        const year = current.getFullYear()
        const month = String(current.getMonth() + 1).padStart(2, '0')
        const day = String(current.getDate()).padStart(2, '0')
        const hours = String(current.getHours()).padStart(2, '0')
        const mins = String(current.getMinutes()).padStart(2, '0')
        const key = `${year}-${month}-${day}T${hours}:${mins}`
        busy.add(key)
        if (!slots[key]) slots[key] = name
        current = new Date(current.getTime() + 30 * 60 * 1000)
      }
    }
    return { busySlots: busy, slotEvents: slots }
  }

  // Try OpenMeet calendar for signed-in users
  async function tryOpenMeetCalendar(dates) {
    try {
      const sortedDates = [...dates].sort()
      const startTime = new Date(`${sortedDates[0]}T00:00:00`).toISOString()
      const endTime = new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59`).toISOString()
      const result = await getOpenMeetAvailability(startTime, endTime)
      if (result.available && result.events.length > 0) {
        const { busySlots: busy, slotEvents: slots } = processCalendarEvents(result.events)
        setBusySlots(busy)
        setSlotEvents(slots)
        setCalendarConnected(true)
        setCalendarSource('openmeet')
        return true
      }
      // available=true but no events — calendar connected but no conflicts
      if (result.available) {
        setCalendarConnected(true)
        setCalendarSource('openmeet')
        return true
      }
      return false // no OpenMeet account or no calendar
    } catch {
      return false
    }
  }

  // Fallback: Google Calendar
  async function connectGoogleCalendar() {
    setConnectingCalendar(true)
    try {
      const token = await requestGoogleAccess()
      const result = await fetchBusyTimes(token, poll?.dates || [], poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
      setBusySlots(result.busySlots)
      setSlotEvents(result.slotEvents)
      setCalendarConnected(true)
      setCalendarSource('google')
    } catch (err) {
      console.error('Google Calendar error:', err)
    } finally {
      setConnectingCalendar(false)
    }
  }

  // Normalize responses — corrupted PDS records may be missing slots/name
  function normalizeResponses(responses) {
    return (responses || []).map(r => ({
      ...r,
      slots: Array.isArray(r.slots) ? r.slots : [],
      name: r.name || 'Unknown',
    }))
  }

  const fetchData = useCallback(async () => {
    try {
      const [pollData, sessionData] = await Promise.all([
        getPoll(did, rkey),
        getSession().catch(() => null),
      ])
      setPoll(pollData.poll)
      setResponses(normalizeResponses(pollData.responses))
      setSession(sessionData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [did, rkey])

  useEffect(() => {
    fetchData().then(() => {
      // Auto-set participant for signed-in users — skip name entry
    })
  }, [fetchData])

  // When session + responses load, auto-populate participant and find existing response
  useEffect(() => {
    if (session?.did && session?.handle && !participant && !submitted) {
      setParticipant({
        name: session.handle,
        email: '',
        did: session.did,
      })

      // Find existing response by this user (match by DID or name/handle)
      const myResponse = responses.find(r =>
        r.did === session.did ||
        r.name === session.handle ||
        r.name === session.did
      )
      if (myResponse) {
        const rk = myResponse.uri?.split('/').pop()
        if (rk) {
          setResponseRkey(rk)
          const viewerSlots = convertSlotsToViewer(myResponse.slots, poll?.timezone)
          setMySlots(new Set(viewerSlots))
          setSubmitted(true)
        }
      }
    }
  }, [session, responses, participant, submitted])

  // Restore prior submission (guest OR signed-in) by matching the localStorage
  // rkey against the loaded responses. This is authoritative — if the rkey
  // matches a response, it is definitely the viewer's. Signed-in users hit
  // this path alongside the DID-based effect above; whichever finds first wins.
  useEffect(() => {
    if (!responseRkey || submitted || responses.length === 0) return
    const mine = responses.find(r => r.uri?.split('/').pop() === responseRkey)
    if (mine) {
      const viewerSlots = convertSlotsToViewer(mine.slots, poll?.timezone)
      setMySlots(new Set(viewerSlots))
      setSubmitted(true)
      if (!participant) {
        setParticipant({ name: mine.name, email: '', did: mine.did })
      }
    } else {
      // Stale rkey — response was deleted server-side or the PDS lost it.
      // Clear local state so the user can re-submit without confusion.
      localStorage.removeItem(`avails:response:${window.location.pathname}`)
      setResponseRkey(null)
    }
  }, [responseRkey, responses, submitted, participant, poll?.timezone])

  // Auto-fetch calendar from OpenMeet for signed-in users
  useEffect(() => {
    if (session?.did && poll?.dates && !calendarConnected) {
      tryOpenMeetCalendar(poll.dates)
    }
  }, [session?.did, poll?.dates, calendarConnected])

  // Compute which grid slots fall within the scheduled time
  // Must be before early returns to maintain stable hook order
  const scheduledSlots = useMemo(() => {
    if (!poll?.finalTime || !poll?.finalDuration) return EMPTY_SET
    const slotMins = poll.slotMinutes || poll.slotDuration || 30
    const start = new Date(poll.finalTime)
    const end = new Date(start.getTime() + poll.finalDuration * 60 * 1000)
    const slots = new Set()
    let cursor = new Date(start)
    while (cursor < end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      const hh = String(cursor.getHours()).padStart(2, '0')
      const mm = String(cursor.getMinutes()).padStart(2, '0')
      slots.add(`${y}-${m}-${d}T${hh}:${mm}`)
      cursor = new Date(cursor.getTime() + slotMins * 60 * 1000)
    }
    return slots
  }, [poll?.finalTime, poll?.finalDuration, poll?.slotMinutes, poll?.slotDuration])

  async function handleGuestSubmit(guestInfo) {
    setParticipant(guestInfo)
    setShowGuestModal(false)
    await doSubmit(guestInfo)
  }

  async function handleSubmit() {
    if (!participant || mySlots.size === 0) return
    await doSubmit(participant)
  }

  async function doSubmit(info) {
    if (!info || mySlots.size === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Convert viewer's local slot keys to creator's timezone for storage
      const creatorSlots = convertSlotsToCreator(mySlots, poll?.timezone)
      const result = await submitResponse(did, rkey, {
        name: info.name,
        email: info.email,
        slots: creatorSlots,
        ...(info.did && { did: info.did }),
      })
      if (result.responseRkey) {
        setResponseRkey(result.responseRkey)
        try {
          localStorage.setItem(
            `avails:response:${window.location.pathname}`,
            JSON.stringify({
              responseRkey: result.responseRkey,
              name: info.name,
              email: info.email || '',
              did: info.did,
            })
          )
        } catch {}
      }
      setSubmitted(true)
      // Refresh responses
      const updated = await getPoll(did, rkey)
      setResponses(normalizeResponses(updated.responses))
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdate() {
    if (!participant || mySlots.size === 0 || !responseRkey) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const creatorSlots = convertSlotsToCreator(mySlots, poll?.timezone)
      await updateResponse(did, rkey, responseRkey, {
        name: participant.name,
        email: participant.email,
        slots: creatorSlots,
        ...(participant.did && { did: participant.did }),
      })
      setEditing(false)
      setSubmitted(true)
      // Refresh responses
      const updated = await getPoll(did, rkey)
      setResponses(normalizeResponses(updated.responses))
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleStartEdit() {
    // Load existing slots into the grid for editing (convert from creator's TZ to viewer's TZ).
    // Match by DID first (robust to handle changes), then fall back to name.
    if (participant) {
      const existing = responses.find(r =>
        (participant.did && r.did === participant.did) ||
        r.name === participant.name
      )
      if (existing) {
        const viewerSlots = convertSlotsToViewer(existing.slots, poll?.timezone)
        setMySlots(new Set(viewerSlots))
      }
    }
    setEditing(true)
    setSubmitted(false)
  }

  async function handleDeleteResponse() {
    if (!responseRkey) return
    if (!confirm('Delete your availability?')) return
    try {
      await deleteResponse(did, rkey, responseRkey)
      setResponseRkey(null)
      setMySlots(new Set())
      setSubmitted(false)
      setParticipant(null)
      localStorage.removeItem(`avails:response:${window.location.pathname}`)
      const updated = await getPoll(did, rkey)
      setResponses(normalizeResponses(updated.responses))
    } catch (err) {
      setSubmitError(err.message)
    }
  }

  async function handleScheduleConfirm() {
    if (schedulingSlots.length === 0) return
    setSchedulingLoading(true)
    setSchedulingError(null)
    try {
      const mins = poll.slotMinutes || poll.slotDuration || 30
      const finalTime = new Date(schedulingSlots[0]).toISOString()
      const finalDuration = schedulingSlots.length * mins
      const notifyEmails = [...new Set(responses.filter(r => r.email).map(r => r.email))]
      await finalizePoll(did, rkey, finalTime, finalDuration, notifyEmails)
      setSchedulingMode(false)
      setSchedulingSlots([])
      fetchData()
    } catch (err) {
      setSchedulingError(err.message)
    } finally {
      setSchedulingLoading(false)
    }
  }

  async function handleUnschedule() {
    const published = !!poll?.openmeetEventSlug || !!openmeetUrl
    const parts = [
      'Unschedule this meeting?',
      '',
      'Participants with emails will get a calendar-cancel message so the event disappears from their calendars.',
    ]
    if (published) parts.push('The OpenMeet event will also be deleted.')
    parts.push('', 'The poll will reopen and you can pick a different time.')
    if (!confirm(parts.join('\n'))) return
    try {
      await unfinalizePoll(did, rkey)
      setOpenmeetUrl(null)
      setOpenmeetError(null)
      fetchData()
    } catch (err) {
      alert(`Could not unschedule: ${err.message}`)
    }
  }

  async function handlePublishToOpenMeet() {
    if (!poll?.finalTime) return
    setPublishingToOpenMeet(true)
    setOpenmeetError(null)
    try {
      const endDate = poll.finalDuration
        ? new Date(new Date(poll.finalTime).getTime() + poll.finalDuration * 60 * 1000).toISOString()
        : undefined
      const pollUrl = `${window.location.origin}/p/${did}/${rkey}`
      const result = await publishToOpenMeet({
        title: poll.title,
        description: poll.description,
        startDate: poll.finalTime,
        endDate,
        timezone: poll.timezone,
        pollUrl,
        did,
        rkey,
      })
      if (result.eventUrl) {
        setOpenmeetUrl(result.eventUrl)
      }
    } catch (err) {
      console.error('OpenMeet publish error:', err)
      setOpenmeetError(err.message || 'Failed to publish to OpenMeet')
    } finally {
      setPublishingToOpenMeet(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#1a1a1a] border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center">
        <p className="text-[#8a8580]">{error}</p>
      </div>
    )
  }

  if (!poll) return null

  const isOpen = !poll.finalTime
  const isCreator = session?.did === did
  const creatorTz = poll.timezone
  const showTzNotice = needsConversion(creatorTz)

  // Convert poll times and responses to viewer's timezone
  const rawTimeRange = poll.timeRange || (poll.earliestTime ? { start: poll.earliestTime, end: poll.latestTime } : { start: '09:00', end: '17:00' })
  const converted = convertPollTimesToViewer(poll.dates || [], rawTimeRange, creatorTz)

  // Convert response slot keys to viewer's timezone
  const viewerResponses = responses.map(r => ({
    ...r,
    slots: convertSlotsToViewer(r.slots, creatorTz),
  }))

  // Hide others' responses from the grid until the viewer submits their own,
  // if the creator opted in. Applies only while poll is open and viewer hasn't submitted.
  const hideOthers = poll.hideResponsesUntilSubmit && isOpen && !submitted && !isCreator
  const gridResponses = hideOthers ? [] : viewerResponses

  const gridProps = {
    dates: converted.dates,
    timeRange: converted.timeRange,
    slotMinutes: poll.slotMinutes || poll.slotDuration || 30,
    responses: gridResponses,
    busySlots,
    slotEvents,
    focusedName,
    scheduledSlots,
  }

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-[#1a1a1a]">avails</span>
          </a>
          <nav className="flex items-center gap-6 text-base text-[#6b6560]">
            <a href="/about" className="hover:text-[#1a1a1a] transition-colors">About</a>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <PollHeader
          poll={poll}
          did={did}
          rkey={rkey}
          isCreator={isCreator}
          onEditClick={() => setShowEditPoll(true)}
          onDeleteClick={() => setShowDeletePoll(true)}
          onScheduleClick={() => setSchedulingMode(true)}
          onUnscheduleClick={!isOpen ? handleUnschedule : undefined}
          schedulingMode={schedulingMode}
          submitted={submitted}
          responseRkey={responseRkey}
          onEditResponse={handleStartEdit}
          onDeleteResponse={handleDeleteResponse}
          showCalendarConnect={isOpen && !submitted && !calendarConnected && isGoogleConfigured()}
          onConnectGoogleCalendar={connectGoogleCalendar}
          connectingCalendar={connectingCalendar}
        />

        {/* Finalized result card */}
        {poll.finalTime && (
          <div className="rounded-xl bg-gradient-to-br from-[#f0fdf4] to-[#ecfdf5] border border-[#bbf7d0] p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2 text-[#15803d]">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-sm font-semibold uppercase tracking-wide">Scheduled</span>
            </div>

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

            <div className="flex items-center gap-3 pt-2 flex-wrap">
              {isCreator && !openmeetUrl && (
                <Button variant="outline" size="sm" onClick={handlePublishToOpenMeet} disabled={publishingToOpenMeet}
                  className="border-[#15803d] text-[#15803d] hover:bg-[#dcfce7]">
                  {publishingToOpenMeet ? 'Publishing...' : 'Publish to OpenMeet'}
                </Button>
              )}
              {openmeetUrl && (
                <a
                  href={openmeetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#15803d] hover:text-[#166534] underline underline-offset-2"
                >
                  View on OpenMeet
                </a>
              )}
              {openmeetError && (
                <p className="text-sm text-red-600">{openmeetError}</p>
              )}
            </div>
          </div>
        )}

        {/* Grid toggle for finalized polls */}
        {poll.finalTime && (
          <button
            onClick={() => setShowBreakdown(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[#6b6560] hover:text-[#1a1a1a] py-3"
          >
            <svg className={`w-4 h-4 transition-transform ${showBreakdown ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 4l4 4-4 4"/>
            </svg>
            {showBreakdown ? 'Hide' : 'See'} availability breakdown ({responses.length} {responses.length === 1 ? 'response' : 'responses'})
          </button>
        )}

        {(!poll.finalTime || showBreakdown) && (
        <div className={`grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-6${poll.finalTime ? ' opacity-80' : ''}`}>
          {/* Main grid area */}
          <div className="space-y-4">
            {/* Info bar — identity, coaching, calendar */}
            {isOpen && !submitted && (
              <div className="space-y-2">
                {/* Identity line */}
                {session?.did && (
                  <p className="text-sm text-[#8a8580]">
                    Signed in as <span className="text-[#1a1a1a] font-medium">@{session.handle}</span>
                  </p>
                )}

                {/* Coaching — dissolves on first paint */}
                {mySlots.size === 0 && (
                  <p className="text-base text-[#6b6560] flex items-center gap-2">
                    <span
                      className="inline-block w-5 h-5 rounded bg-[#f5f3ef] shrink-0"
                      style={{ backgroundImage: 'linear-gradient(rgba(13,148,136,0.45), rgba(13,148,136,0.45))' }}
                    />
                    <span>
                      {session?.did
                        ? 'Tap or drag on the grid to mark times you\u2019re available'
                        : 'Tap or drag to mark your availability, then save to share with the group'
                      }
                    </span>
                  </p>
                )}

                {/* OpenMeet fallback link for signed-in users who haven't connected a calendar */}
                {mySlots.size > 0 && !calendarConnected && session?.did && (
                  <a
                    href="https://platform.openmeet.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#6b6560] hover:text-[#1a1a1a] underline underline-offset-2"
                  >
                    Or connect via OpenMeet
                  </a>
                )}

                {calendarConnected && (
                  <p className="text-sm text-[#0d9488]">
                    Calendar connected{calendarSource === 'openmeet' ? ' via OpenMeet' : ''} — busy times shown in pink
                  </p>
                )}
              </div>
            )}

            {schedulingMode ? (
              <SchedulingGrid
                dates={gridProps.dates}
                timeRange={gridProps.timeRange}
                slotMinutes={gridProps.slotMinutes}
                responses={responses}
                onSelect={setSchedulingSlots}
                onCancel={() => { setSchedulingMode(false); setSchedulingSlots([]) }}
                onConfirm={handleScheduleConfirm}
                confirmDisabled={schedulingSlots.length === 0}
                confirmLoading={schedulingLoading}
                error={schedulingError}
              />
            ) : (
              <AvailGrid
                {...gridProps}
                mySlots={mySlots}
                onSlotsChange={setMySlots}
                readOnly={readOnly(isOpen, submitted, editing)}
                onHoverSlot={setHoverSlot}
              />
            )}


          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Save card — desktop only (mobile gets sticky bar below) */}
            {isOpen && !submitted && mySlots.size > 0 && (
              <div className="hidden lg:block rounded-lg bg-[#0d9488] p-4 text-white space-y-3">
                <p className="text-sm font-medium">{mySlots.size} slot{mySlots.size !== 1 ? 's' : ''} selected</p>
                <Button
                  onClick={editing ? handleUpdate : (participant ? handleSubmit : () => setShowGuestModal(true))}
                  disabled={submitting}
                  className="w-full py-2.5 bg-white text-[#0d9488] font-semibold text-base hover:bg-white/90"
                >
                  {submitting ? 'Saving...' : editing ? 'Save changes' : 'Save availability'}
                </Button>
                {editing && (
                  <button
                    onClick={() => { setEditing(false); setSubmitted(true) }}
                    disabled={submitting}
                    className="w-full text-sm text-white/80 hover:text-white underline underline-offset-2"
                  >
                    Cancel
                  </button>
                )}
                {submitError && <p className="text-xs text-red-200">{submitError}</p>}
              </div>
            )}

            <ResponsePanel
              responses={hideOthers ? [] : viewerResponses}
              focusedName={focusedName}
              onFocus={setFocusedName}
              hoverSlot={hoverSlot}
              hiddenUntilSubmit={hideOthers}
            />
          </aside>
        </div>
        )}
      </main>

      {showEditPoll && (
        <EditPollDialog
          open={showEditPoll}
          onOpenChange={setShowEditPoll}
          poll={poll}
          did={did}
          rkey={rkey}
          onSaved={fetchData}
        />
      )}

      <DeletePollDialog
        open={showDeletePoll}
        onOpenChange={setShowDeletePoll}
        did={did}
        rkey={rkey}
      />

      <GuestModal
        open={showGuestModal}
        onOpenChange={setShowGuestModal}
        onSubmit={handleGuestSubmit}
        submitting={submitting}
      />

      {/* Mobile sticky save bar */}
      {isOpen && !submitted && mySlots.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-[#0d9488] px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white/90">
              {mySlots.size} slot{mySlots.size !== 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center gap-2">
              {editing && (
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setSubmitted(true) }} disabled={submitting}
                  className="text-white/80 hover:text-white hover:bg-white/10">
                  Cancel
                </Button>
              )}
              <Button
                onClick={editing ? handleUpdate : (participant ? handleSubmit : () => setShowGuestModal(true))}
                disabled={submitting}
                className="bg-white text-[#0d9488] font-semibold hover:bg-white/90"
              >
                {submitting ? 'Saving...' : editing ? 'Save changes' : 'Save'}
              </Button>
            </div>
          </div>
          {submitError && <p className="text-xs text-red-200 mt-1">{submitError}</p>}
        </div>
      )}
    </div>
  )
}

function readOnly(isOpen, submitted, editing) {
  if (!isOpen) return true
  if (editing) return false
  if (submitted) return true
  return false
}
