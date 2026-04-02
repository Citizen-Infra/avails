import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll, deleteResponse } from '@/lib/api'
import { isGoogleConfigured, requestGoogleAccess, fetchBusyTimes } from '@/lib/googleCalendar'
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

  const [busySlots, setBusySlots] = useState(new Set())
  const [slotEvents, setSlotEvents] = useState({})
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  async function connectCalendar() {
    setConnectingCalendar(true)
    try {
      const token = await requestGoogleAccess()
      const result = await fetchBusyTimes(token, poll?.dates || [], poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
      setBusySlots(result.busySlots)
      setSlotEvents(result.slotEvents)
      setCalendarConnected(true)
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
          setMySlots(new Set(myResponse.slots))
          setSubmitted(true)
        }
      }
    }
  }, [session, responses, participant, submitted])

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
      const result = await submitResponse(did, rkey, {
        name: info.name,
        email: info.email,
        slots: Array.from(mySlots),
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
      await updateResponse(did, rkey, responseRkey, {
        name: participant.name,
        email: participant.email,
        slots: Array.from(mySlots),
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
    // Load existing slots into the grid for editing
    if (participant?.name) {
      const existing = responses.find(r => r.name === participant.name)
      if (existing) {
        setMySlots(new Set(existing.slots))
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

  const gridProps = {
    dates: poll.dates || [],
    timeRange: poll.timeRange || (poll.earliestTime ? { start: poll.earliestTime, end: poll.latestTime } : { start: '09:00', end: '17:00' }),
    slotMinutes: poll.slotMinutes || poll.slotDuration || 30,
    responses,
    busySlots,
    slotEvents,
    highlightName,
  }

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.9"/>
                <rect x="9" y="2" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.6"/>
                <rect x="2" y="9" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.6"/>
                <rect x="9" y="9" width="5" height="5" rx="1" fill="#faf9f6" opacity="0.3"/>
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1a1a1a]">avails</span>
          </a>
          <nav className="flex items-center gap-6 text-base text-[#6b6560]">
            <a href="/about" className="hover:text-[#1a1a1a] transition-colors">About</a>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
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
          <div className="rounded-lg border border-[#c8dfc8] bg-[#f0f7f0] px-6 py-5">
            <p className="text-base font-medium text-[#3a6b3a]">
              Meeting scheduled:{' '}
              {new Date(poll.finalTime).toLocaleString(undefined, {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
              {poll.finalDuration && ` (${poll.finalDuration} min)`}
            </p>
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
                {isGoogleConfigured() && !calendarConnected && (
                  <button
                    onClick={connectCalendar}
                    disabled={connectingCalendar}
                    className="text-sm text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2"
                  >
                    {connectingCalendar ? 'Connecting...' : 'Connect Google Calendar'}
                  </button>
                )}
                {calendarConnected && (
                  <span className="text-sm text-[#0d9488]">Calendar connected</span>
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
