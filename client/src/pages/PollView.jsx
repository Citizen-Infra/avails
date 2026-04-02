import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll } from '@/lib/api'
import { isGoogleConfigured, requestGoogleAccess, fetchBusyTimes } from '@/lib/googleCalendar'
import { Button } from '@/components/ui/button'
import AvailGrid from '@/components/AvailGrid'
import SchedulingGrid from '@/components/SchedulingGrid'
import NameEntry from '@/components/NameEntry'
import PollHeader from '@/components/PollHeader'
import ResponsePanel from '@/components/ResponsePanel'
import EditPollDialog from '@/components/EditPollDialog'
import DeletePollDialog from '@/components/DeletePollDialog'

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

  const [busySlots, setBusySlots] = useState(new Set())
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  async function connectCalendar() {
    setConnectingCalendar(true)
    try {
      const token = await requestGoogleAccess()
      const busy = await fetchBusyTimes(token, poll?.dates || [], poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
      setBusySlots(busy)
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

  // When session loads, auto-populate participant from ATProto identity
  useEffect(() => {
    if (session?.did && session?.handle && !participant && !submitted) {
      setParticipant({
        name: session.handle,
        email: '', // ATProto doesn't expose email
        did: session.did,
      })
    }
  }, [session, participant, submitted])

  async function handleSubmit() {
    if (!participant || mySlots.size === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await submitResponse(did, rkey, {
        name: participant.name,
        email: participant.email,
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
    setEditing(true)
    setSubmitted(false)
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
            {/* Name entry — only for unauthenticated users who haven't entered their name */}
            {isOpen && !participant && !submitted && !session?.did && (
              <div className="rounded-lg border-l-4 border-l-[#0d9488] border border-[#e8e5df] bg-white p-6 space-y-4">
                <p className="text-base text-[#6b6560]">
                  Enter your name to mark your availability:
                </p>
                <NameEntry
                  onSubmit={setParticipant}
                  dates={poll.dates}
                  timezone={poll.timezone}
                  onBusySlots={setBusySlots}
                />
              </div>
            )}

            {/* Signed-in user — greeting + optional calendar connect */}
            {isOpen && participant && !submitted && session?.did && (
              <div className="flex items-center gap-4 flex-wrap">
                <p className="text-base text-[#8a8580]">
                  Signed in as <span className="text-[#1a1a1a] font-medium">@{session.handle}</span> — click or drag to mark your availability.
                </p>
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

            {/* Instruction after name entry (anonymous users), before submit */}
            {isOpen && participant && !submitted && !session?.did && (
              <p className="text-base text-[#8a8580]">
                Click or drag to mark when you are available. Selected slots are shown in green.
              </p>
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
                readOnly={readOnly(isOpen, participant, submitted, editing)}
                onHoverSlot={setHoverSlot}
              />
            )}

            {/* Submit area — initial submission */}
            {isOpen && participant && !submitted && !editing && (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || mySlots.size === 0}
                  className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-6 py-3 rounded-lg transition-colors"
                >
                  {submitting
                    ? 'Submitting...'
                    : `Submit availability (${mySlots.size} slot${mySlots.size !== 1 ? 's' : ''})`}
                </Button>
                {submitError && (
                  <p className="text-sm text-red-600">{submitError}</p>
                )}
              </div>
            )}

            {/* Submit area — editing an existing response */}
            {isOpen && participant && !submitted && editing && (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleUpdate}
                  disabled={submitting || mySlots.size === 0}
                  className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-6 py-3 rounded-lg transition-colors"
                >
                  {submitting
                    ? 'Saving...'
                    : `Save changes (${mySlots.size} slot${mySlots.size !== 1 ? 's' : ''})`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setEditing(false); setSubmitted(true) }}
                  disabled={submitting}
                  className="text-base text-[#8a8580] hover:text-[#6b6560] hover:bg-[#f0eeea]"
                >
                  Cancel
                </Button>
                {submitError && (
                  <p className="text-sm text-red-600">{submitError}</p>
                )}
              </div>
            )}

            {/* Post-submit confirmation */}
            {submitted && (
              <div className="flex items-center gap-3 rounded-lg border border-[#e8e5df] bg-white px-5 py-4">
                <p className="text-base text-[#6b6560]">
                  Your availability has been submitted.
                </p>
                {isOpen && responseRkey && (
                  <Button variant="outline" onClick={handleStartEdit} className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] text-base px-5 py-2 rounded-lg">
                    Edit my availability
                  </Button>
                )}
              </div>
            )}

          </div>

          {/* Sidebar */}
          <aside>
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
    </div>
  )
}

function readOnly(isOpen, participant, submitted, editing) {
  if (!isOpen) return true
  if (!participant) return true
  if (editing) return false
  if (submitted) return true
  return false
}
