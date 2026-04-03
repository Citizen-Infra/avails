import Logo from '@/components/Logo'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll, deleteResponse, publishToOpenMeet, getOpenMeetAvailability } from '@/lib/api'
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

export default function PollView() {
  const { did, rkey } = useParams()

  const [poll, setPoll] = useState(null)
  const [responses, setResponses] = useState([])
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [participant, setParticipant] = useState(null) // { name, email }
  const [mySlots, setMySlots] = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [responseRkey, setResponseRkey] = useState(() => {
    // Restore saved response rkey from localStorage on mount
    try {
      const saved = localStorage.getItem(`avails:response:${window.location.pathname}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.responseRkey || null
      }
    } catch {}
    return null
  })

  const [highlightName, setHighlightName] = useState(null)
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

  const fetchData = useCallback(async () => {
    try {
      const [pollData, sessionData] = await Promise.all([
        getPoll(did, rkey),
        getSession().catch(() => null),
      ])
      setPoll(pollData.poll)
      setResponses(pollData.responses || [])
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

  // Auto-fetch calendar from OpenMeet for signed-in users
  useEffect(() => {
    if (session?.did && poll?.dates && !calendarConnected) {
      tryOpenMeetCalendar(poll.dates)
    }
  }, [session?.did, poll?.dates, calendarConnected])

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
      })
      if (result.responseRkey) {
        setResponseRkey(result.responseRkey)
        try {
          localStorage.setItem(
            `avails:response:${window.location.pathname}`,
            JSON.stringify({ responseRkey: result.responseRkey })
          )
        } catch {}
      }
      setSubmitted(true)
      // Refresh responses
      const updated = await getPoll(did, rkey)
      setResponses(updated.responses || [])
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
      })
      setEditing(false)
      setSubmitted(true)
      // Refresh responses
      const updated = await getPoll(did, rkey)
      setResponses(updated.responses || [])
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleStartEdit() {
    // Load existing slots into the grid for editing (convert from creator's TZ to viewer's TZ)
    if (participant?.name) {
      const existing = responses.find(r => r.name === participant.name)
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
      setResponses(updated.responses || [])
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
      await finalizePoll(did, rkey, finalTime, finalDuration)
      setSchedulingMode(false)
      setSchedulingSlots([])
      fetchData()
    } catch (err) {
      setSchedulingError(err.message)
    } finally {
      setSchedulingLoading(false)
    }
  }

  async function handlePublishToOpenMeet() {
    if (!poll?.finalTime) return
    setPublishingToOpenMeet(true)
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
      })
      if (result.eventUrl) {
        setOpenmeetUrl(result.eventUrl)
      }
    } catch (err) {
      console.error('OpenMeet publish error:', err)
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

  const gridProps = {
    dates: converted.dates,
    timeRange: converted.timeRange,
    slotMinutes: poll.slotMinutes || poll.slotDuration || 30,
    responses: viewerResponses,
    busySlots,
    slotEvents,
    highlightName,
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
          schedulingMode={schedulingMode}
        />

        {/* Finalized meeting banner */}
        {poll.finalTime && (
          <div className="rounded-lg border border-[#c8dfc8] bg-[#f0f7f0] px-6 py-5 space-y-3">
            <p className="text-base font-medium text-[#3a6b3a]">
              Meeting scheduled:{' '}
              {new Date(poll.finalTime).toLocaleString(undefined, {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
              {poll.finalDuration && ` (${poll.finalDuration} min)`}
            </p>
            {isCreator && !openmeetUrl && (
              <button
                onClick={handlePublishToOpenMeet}
                disabled={publishingToOpenMeet}
                className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2"
              >
                {publishingToOpenMeet ? 'Publishing...' : 'Publish to OpenMeet'}
              </button>
            )}
            {openmeetUrl && (
              <a
                href={openmeetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2"
              >
                View on OpenMeet
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-6">
          {/* Main grid area */}
          <div className="space-y-4">
            {/* Info bar above grid — identity + calendar connect */}
            {isOpen && !submitted && (
              <div className="flex items-center gap-4 flex-wrap text-base">
                {session?.did ? (
                  <span className="text-[#8a8580]">
                    Signed in as <span className="text-[#1a1a1a] font-medium">@{session.handle}</span>
                  </span>
                ) : (
                  <span className="text-[#8a8580]">Mark your availability below</span>
                )}
                {calendarConnected ? (
                  <span className="text-sm text-[#0d9488]">
                    Calendar connected{calendarSource === 'openmeet' ? ' via OpenMeet' : ''}
                  </span>
                ) : (
                  <>
                    {isGoogleConfigured() && (
                      <button
                        onClick={connectGoogleCalendar}
                        disabled={connectingCalendar}
                        className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2"
                      >
                        {connectingCalendar ? 'Connecting...' : 'Connect Google Calendar'}
                      </button>
                    )}
                    {session?.did && (
                      <a
                        href="https://platform.openmeet.net"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#6b6560] hover:text-[#1a1a1a] underline underline-offset-2"
                      >
                        Or connect via OpenMeet
                      </a>
                    )}
                  </>
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
            {/* Save card — appears when slots are painted */}
            {isOpen && !submitted && !editing && mySlots.size > 0 && (
              <div className="rounded-lg bg-[#0d9488] p-4 text-white space-y-3">
                <p className="text-sm font-medium">{mySlots.size} slot{mySlots.size !== 1 ? 's' : ''} selected</p>
                <button
                  onClick={() => participant ? handleSubmit() : setShowGuestModal(true)}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-white text-[#0d9488] font-semibold text-base hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save availability'}
                </button>
                {submitError && <p className="text-xs text-red-200">{submitError}</p>}
              </div>
            )}

            {/* Save card — editing */}
            {isOpen && !submitted && editing && mySlots.size > 0 && (
              <div className="rounded-lg bg-[#0d9488] p-4 text-white space-y-3">
                <p className="text-sm font-medium">{mySlots.size} slot{mySlots.size !== 1 ? 's' : ''} selected</p>
                <button
                  onClick={handleUpdate}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-white text-[#0d9488] font-semibold text-base hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save changes'}
                </button>
                <button
                  onClick={() => { setEditing(false); setSubmitted(true) }}
                  disabled={submitting}
                  className="w-full text-sm text-white/80 hover:text-white underline underline-offset-2"
                >
                  Cancel
                </button>
                {submitError && <p className="text-xs text-red-200">{submitError}</p>}
              </div>
            )}

            {/* Post-save */}
            {submitted && (
              <div className="rounded-lg border border-[#e8e5df] bg-white p-4 space-y-2">
                <p className="text-sm text-[#6b6560]">Availability saved</p>
                {isOpen && responseRkey && (
                  <div className="flex items-center gap-3">
                    <button onClick={handleStartEdit} className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2">
                      Edit
                    </button>
                    <button onClick={handleDeleteResponse} className="text-sm text-red-500 hover:text-red-600 underline underline-offset-2">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}

            <ResponsePanel
              responses={responses}
              highlightName={highlightName}
              onHighlight={setHighlightName}
              hoverSlot={hoverSlot}
            />
          </aside>
        </div>
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
    </div>
  )
}

function readOnly(isOpen, submitted, editing) {
  if (!isOpen) return true
  if (editing) return false
  if (submitted) return true
  return false
}
