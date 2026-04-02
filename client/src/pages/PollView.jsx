import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll } from '@/lib/api'
import { Button } from '@/components/ui/button'
import AvailGrid from '@/components/AvailGrid'
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
  const [schedulingError, setSchedulingError] = useState(null)
  const [schedulingLoading, setSchedulingLoading] = useState(false)
  const [showEditPoll, setShowEditPoll] = useState(false)
  const [showDeletePoll, setShowDeletePoll] = useState(false)

  const [busySlots, setBusySlots] = useState(new Set())

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
    fetchData()
  }, [fetchData])

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

  function handleScheduleSelect(slots) {
    setSchedulingSlots(slots)
  }

  async function handleScheduleConfirm() {
    if (schedulingSlots.length === 0) return
    setSchedulingLoading(true)
    setSchedulingError(null)
    try {
      const slotMinutes = poll.slotMinutes || poll.slotDuration || 30
      // First slot is the start time, duration = number of slots * slotMinutes
      const finalTime = new Date(schedulingSlots[0]).toISOString()
      const finalDuration = schedulingSlots.length * slotMinutes
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

  function handleScheduleCancel() {
    setSchedulingMode(false)
    setSchedulingSlots([])
    setSchedulingError(null)
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

  const slotMinutes = poll.slotMinutes || poll.slotDuration || 30

  // Compute scheduled slots from finalized time
  const scheduledSlots = useMemo(() => {
    if (!poll.finalTime || !poll.finalDuration) return new Set()
    const start = new Date(poll.finalTime)
    const totalSlots = Math.ceil(poll.finalDuration / slotMinutes)
    const slots = new Set()
    for (let i = 0; i < totalSlots; i++) {
      const slotTime = new Date(start.getTime() + i * slotMinutes * 60000)
      const date = slotTime.toISOString().slice(0, 10)
      const hh = String(slotTime.getHours()).padStart(2, '0')
      const mm = String(slotTime.getMinutes()).padStart(2, '0')
      slots.add(`${date}T${hh}:${mm}`)
    }
    return slots
  }, [poll.finalTime, poll.finalDuration, slotMinutes])

  // In scheduling mode, also show the pending selection as scheduledSlots for preview
  const activeScheduledSlots = useMemo(() => {
    if (schedulingMode && schedulingSlots.length > 0) {
      return new Set(schedulingSlots)
    }
    return scheduledSlots
  }, [schedulingMode, schedulingSlots, scheduledSlots])

  const gridMode = schedulingMode ? 'schedule' : (isOpen ? 'respond' : 'view')

  const gridProps = {
    dates: poll.dates || [],
    timeRange: poll.timeRange || (poll.earliestTime ? { start: poll.earliestTime, end: poll.latestTime } : { start: '09:00', end: '17:00' }),
    slotMinutes,
    responses,
    busySlots,
    highlightName,
  }

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center">
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
            {/* Name entry — only when poll is open and user hasn't set a name yet */}
            {isOpen && !participant && !submitted && (
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

            {/* Instruction after name entry, before submit */}
            {isOpen && participant && !submitted && (
              <p className="text-base text-[#8a8580]">
                Click or drag to mark when you are available. Selected slots are shown in green.
              </p>
            )}

            {/* Scheduling mode bar */}
            {schedulingMode && (
              <div className="flex items-center justify-between rounded-lg bg-[#0d9488] px-5 py-3 text-white">
                <span className="text-base font-medium">Select a time block on the grid</span>
                <div className="flex items-center gap-3">
                  {schedulingError && (
                    <span className="text-sm text-red-200">{schedulingError}</span>
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleScheduleCancel}
                    disabled={schedulingLoading}
                    className="text-white hover:bg-white/20 hover:text-white text-base px-4 py-2 rounded-lg"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleScheduleConfirm}
                    disabled={schedulingSlots.length === 0 || schedulingLoading}
                    className="bg-white text-[#0d9488] hover:bg-white/90 text-base px-5 py-2 rounded-lg font-medium"
                  >
                    {schedulingLoading ? 'Scheduling...' : 'Schedule'}
                  </Button>
                </div>
              </div>
            )}

            <AvailGrid
              {...gridProps}
              mySlots={mySlots}
              onSlotsChange={setMySlots}
              readOnly={readOnly(isOpen, participant, submitted, editing)}
              onHoverSlot={setHoverSlot}
              mode={gridMode}
              onScheduleSelect={handleScheduleSelect}
              scheduledSlots={activeScheduledSlots}
            />

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

            {/* Schedule meeting button for creator */}
            {isOpen && isCreator && !schedulingMode && (
              <Button onClick={() => setSchedulingMode(true)} className="bg-[#0d9488] text-white hover:bg-[#0f766e] text-base px-6 py-3 rounded-lg transition-colors">
                Schedule meeting
              </Button>
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
