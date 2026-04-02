import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import AvailGrid from '@/components/AvailGrid'
import NameEntry from '@/components/NameEntry'
import PollHeader from '@/components/PollHeader'
import ResponsePanel from '@/components/ResponsePanel'
import FinalizeDialog from '@/components/FinalizeDialog'

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

  const [highlightName, setHighlightName] = useState(null)
  const [showFinalize, setShowFinalize] = useState(false)

  // Task 11 placeholder
  const busySlots = new Set()

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
      await submitResponse(did, rkey, {
        name: participant.name,
        email: participant.email,
        slots: Array.from(mySlots),
      })
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

  function handleFinalized() {
    fetchData()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!poll) return null

  const isOpen = !poll.finalTime
  const isCreator = session?.did === did

  const gridProps = {
    dates: poll.dates || [],
    timeRange: poll.timeRange || { start: '09:00', end: '17:00' },
    slotMinutes: poll.slotMinutes || 30,
    responses,
    busySlots,
    highlightName,
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center">
          <a href="/" className="text-lg font-semibold tracking-tight">avails</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <PollHeader poll={poll} did={did} rkey={rkey} />

        {/* Finalized meeting banner */}
        {poll.finalTime && (
          <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CardContent className="py-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Meeting scheduled:{' '}
                {new Date(poll.finalTime).toLocaleString(undefined, {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
                {poll.finalDuration && ` (${poll.finalDuration} min)`}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-6">
          {/* Main grid area */}
          <div className="space-y-4">
            {/* Name entry — only when poll is open and user hasn't set a name yet */}
            {isOpen && !participant && !submitted && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enter your name to mark your availability:
                </p>
                <NameEntry onSubmit={setParticipant} />
              </div>
            )}

            {/* Instruction after name entry, before submit */}
            {isOpen && participant && !submitted && (
              <p className="text-sm text-muted-foreground">
                Click or drag to mark when you are available. Selected slots are shown in green.
              </p>
            )}

            <AvailGrid
              {...gridProps}
              mySlots={mySlots}
              onSlotsChange={setMySlots}
              readOnly={readOnly(isOpen, participant, submitted)}
            />

            {/* Submit area */}
            {isOpen && participant && !submitted && (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || mySlots.size === 0}
                >
                  {submitting
                    ? 'Submitting...'
                    : `Submit availability (${mySlots.size} slot${mySlots.size !== 1 ? 's' : ''})`}
                </Button>
                {submitError && (
                  <p className="text-sm text-destructive">{submitError}</p>
                )}
              </div>
            )}

            {/* Post-submit confirmation */}
            {submitted && (
              <p className="text-sm text-muted-foreground">
                Your availability has been submitted.
              </p>
            )}

            {/* Finalize button for creator */}
            {isOpen && isCreator && (
              <Button variant="outline" onClick={() => setShowFinalize(true)}>
                Pick a time
              </Button>
            )}
          </div>

          {/* Sidebar */}
          <aside>
            <ResponsePanel
              responses={responses}
              highlightName={highlightName}
              onHighlight={setHighlightName}
            />
          </aside>
        </div>
      </main>

      <FinalizeDialog
        open={showFinalize}
        onOpenChange={setShowFinalize}
        poll={poll}
        did={did}
        rkey={rkey}
        onFinalized={handleFinalized}
      />
    </div>
  )
}

function readOnly(isOpen, participant, submitted) {
  if (!isOpen) return true
  if (!participant) return true
  if (submitted) return true
  return false
}
