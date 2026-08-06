import Logo from '@/components/Logo'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router'
import { getPoll, getSession, submitResponse, updateResponse, finalizePoll, unfinalizePoll, deleteResponse, publishToOpenMeet, publishToCommunityFeed, getOpenMeetAvailability, setGoogleCalendarEvent, getCommunities, updatePoll, setMeetingLink } from '@/lib/api'
import {
  isGoogleConfigured,
  requestGoogleAccess,
  fetchBusyTimes,
  listWritableCalendars,
  insertEvent,
  deleteEvent,
  GOOGLE_SCOPES,
} from '@/lib/googleCalendar'
import { convertPollTimesToViewer, convertSlotsToViewer, convertSlotsToCreator, getViewerTimezone, needsConversion } from '@/lib/timezone'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AvailGrid from '@/components/AvailGrid'
import SchedulingGrid from '@/components/SchedulingGrid'
import NameEntry from '@/components/NameEntry'
import PollHeader from '@/components/PollHeader'
import ResponsePanel from '@/components/ResponsePanel'
import EditPollDialog from '@/components/EditPollDialog'
import DeletePollDialog from '@/components/DeletePollDialog'
import DeleteResponseDialog from '@/components/DeleteResponseDialog'
import UnscheduleDialog from '@/components/UnscheduleDialog'
import GuestModal from '@/components/GuestModal'
import MeetingLinkField, { jitsiSuggestionFor } from '@/components/MeetingLinkField'

const EMPTY_SET = new Set()

// The host of a meeting link, for display beside "Join the call". A Zoom link
// carrying a passcode query string is unreadable in full; the anchor keeps the
// whole URL. Falls back to the raw value if it will not parse — the server
// validated it, so an unparseable one reaching here means something is wrong,
// and hiding it would be worse than showing it.
function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

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
  const [showDeleteResponse, setShowDeleteResponse] = useState(false)
  const [showUnschedule, setShowUnschedule] = useState(false)
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false) // transient post-submit confirmation
  const [calendarCleanupWarning, setCalendarCleanupWarning] = useState(null) // best-effort google-delete notice
  // Meeting link (#19). `draft` is what the field holds in either place;
  // `editing` is only the result card's inline editor being open.
  const [meetingUrlDraft, setMeetingUrlDraft] = useState('')
  const [editingMeetingUrl, setEditingMeetingUrl] = useState(false)
  const [meetingUrlSaving, setMeetingUrlSaving] = useState(false)
  const [meetingUrlError, setMeetingUrlError] = useState(null)
  const [openmeetUrl, setOpenmeetUrl] = useState(null)
  const [publishingToOpenMeet, setPublishingToOpenMeet] = useState(false)
  const [openmeetError, setOpenmeetError] = useState(null)
  // Community-feed publish (#5 sub-project F). feedPublished starts null and
  // derives from the loaded record; a toggle sets it explicitly.
  const [publishingToFeed, setPublishingToFeed] = useState(false)
  const [feedError, setFeedError] = useState(null)
  const [feedPublished, setFeedPublished] = useState(null)
  // Community linking (#138): the creator can set/change/clear the poll's community.
  const [communities, setCommunities] = useState([])
  const [savingCommunity, setSavingCommunity] = useState(false)
  const [communityError, setCommunityError] = useState(null)
  const [showBreakdown, setShowBreakdown] = useState(false)

  useEffect(() => {
    getCommunities().then(setCommunities).catch(() => setCommunities([]))
  }, [])

  const [busySlots, setBusySlots] = useState(new Set())
  const [slotEvents, setSlotEvents] = useState({})
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarSource, setCalendarSource] = useState(null) // 'openmeet' | 'google' | null
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  // New: calendar-write feature
  const [googleToken, setGoogleToken] = useState(null)
  const [writableCalendars, setWritableCalendars] = useState(null)  // null = not yet fetched, [] = none
  const [chosenCalendarId, setChosenCalendarId] = useState('none')
  const [googleEventLink, setGoogleEventLink] = useState(null)      // set on successful insert (used by Task 4)
  const [calendarInsertError, setCalendarInsertError] = useState(null)
  const [retryingCalendar, setRetryingCalendar] = useState(false)

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
  async function connectGoogleCalendar({ forEvent = false } = {}) {
    setConnectingCalendar(true)
    try {
      const scope = forEvent ? GOOGLE_SCOPES.EVENTS : GOOGLE_SCOPES.READONLY
      const token = await requestGoogleAccess(scope)
      setGoogleToken(token)
      const result = await fetchBusyTimes(token, poll?.dates || [], poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
      setBusySlots(result.busySlots)
      setSlotEvents(result.slotEvents)
      setCalendarConnected(true)
      setCalendarSource('google')
      // Fetch writable calendars for the picker
      try {
        const cals = await listWritableCalendars(token)
        setWritableCalendars(cals)
        // Restore last-used choice from localStorage if it's still in the list
        const lastId = localStorage.getItem('avails:lastCalendarId')
        if (lastId && lastId !== 'none' && cals.some(c => c.id === lastId)) {
          setChosenCalendarId(lastId)
        } else {
          setChosenCalendarId('none')
        }
      } catch (err) {
        console.warn('[avails] listWritableCalendars failed:', err)
        setWritableCalendars([])
      }
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
  //
  // Must NOT run while `editing` is true — otherwise clicking Edit (which
  // flips submitted=false) re-triggers the effect, restores the stored
  // slots, and snaps submitted back to true, cancelling the edit silently.
  useEffect(() => {
    if (!responseRkey || submitted || editing || responses.length === 0) return
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
  }, [responseRkey, responses, submitted, editing, participant, poll?.timezone])

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

  // Auto-dismiss the post-submit confirmation after a few seconds
  useEffect(() => {
    if (!justSubmitted) return
    const t = setTimeout(() => setJustSubmitted(false), 4500)
    return () => clearTimeout(t)
  }, [justSubmitted])

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
      setJustSubmitted(true)
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

  function handleDeleteResponse() {
    if (!responseRkey) return
    setShowDeleteResponse(true)
  }

  // Actual deletion — runs from the dialog's confirm. Throwing surfaces the
  // error inline in the dialog rather than leaving it silent.
  async function confirmDeleteResponse() {
    await deleteResponse(did, rkey, responseRkey)
    setResponseRkey(null)
    setMySlots(new Set())
    setSubmitted(false)
    setParticipant(null)
    localStorage.removeItem(`avails:response:${window.location.pathname}`)
    const updated = await getPoll(did, rkey)
    setResponses(normalizeResponses(updated.responses))
  }

  async function insertGoogleEvent({ finalTime, finalDuration, tokenOverride }) {
    const tz = poll?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    const startDt = new Date(finalTime)
    const endDt = new Date(startDt.getTime() + finalDuration * 60 * 1000)
    const pollUrl = `${window.location.origin}/p/${did}/${rkey}`

    const eventBody = {
      summary: poll.title,
      description: [poll.description, `View poll: ${pollUrl}`].filter(Boolean).join('\n\n'),
      start: { dateTime: startDt.toISOString(), timeZone: tz },
      end: { dateTime: endDt.toISOString(), timeZone: tz },
      source: { url: pollUrl, title: 'View poll' },
    }

    const token = tokenOverride || googleToken
    try {
      const created = await insertEvent(token, chosenCalendarId, eventBody)
      setGoogleEventLink({
        url: created.htmlLink,
        calendarSummary: writableCalendars?.find(c => c.id === chosenCalendarId)?.summary || 'calendar',
      })
      localStorage.setItem('avails:lastCalendarId', chosenCalendarId)
      // Persist event id + calendar id on the poll record so unschedule can auto-cancel.
      // Best-effort — failure leaves the event untracked but in place.
      try {
        await setGoogleCalendarEvent(did, rkey, created.id, chosenCalendarId)
      } catch (err) {
        console.warn('[avails] setGoogleCalendarEvent failed (event created but not tracked):', err)
      }
    } catch (err) {
      console.error('[avails] insertEvent failed:', err)
      setCalendarInsertError(err.message || 'Could not add to calendar')
    }
  }

  async function handleScheduleConfirm() {
    if (schedulingSlots.length === 0) return
    setSchedulingLoading(true)
    setSchedulingError(null)
    setCalendarInsertError(null)
    try {
      const mins = poll.slotMinutes || poll.slotDuration || 30
      const finalTime = new Date(schedulingSlots[0]).toISOString()
      const finalDuration = schedulingSlots.length * mins
      const notifyEmails = [...new Set(responses.filter(r => r.email).map(r => r.email))]

      // 1) PDS finalize + .ics emails. Source of truth. The meeting link rides
      // along so the FIRST invite already carries it — adding one afterwards
      // costs everyone a second email.
      const link = meetingUrlDraft.trim()
      await finalizePoll(did, rkey, finalTime, finalDuration, notifyEmails, link || undefined)
      setSchedulingMode(false)
      setSchedulingSlots([])
      setMeetingUrlDraft('')

      // 2) Optional Google Calendar insert. Independent — never rolls back the schedule.
      if (chosenCalendarId !== 'none' && googleToken) {
        await insertGoogleEvent({ finalTime, finalDuration })
      }

      fetchData()
    } catch (err) {
      setSchedulingError(err.message)
    } finally {
      setSchedulingLoading(false)
    }
  }

  // Save a link on an ALREADY scheduled poll. Separate from finalize because
  // the server sends a different message for it: "the link changed", not "the
  // meeting is booked". An unchanged value is a no-op there, so opening the
  // editor and closing it again mails nobody.
  async function handleSaveMeetingLink() {
    if (meetingUrlSaving) return
    setMeetingUrlSaving(true)
    setMeetingUrlError(null)
    try {
      await setMeetingLink(did, rkey, meetingUrlDraft.trim())
      setEditingMeetingUrl(false)
      fetchData()
    } catch (err) {
      // The server owns what counts as a valid link, so show its wording.
      setMeetingUrlError(err.message || 'Could not save the meeting link')
    } finally {
      setMeetingUrlSaving(false)
    }
  }

  function openMeetingLinkEditor() {
    setMeetingUrlDraft(poll?.meetingUrl || '')
    setMeetingUrlError(null)
    setEditingMeetingUrl(true)
  }

  async function retryCalendarInsert() {
    if (!poll?.finalTime || !poll?.finalDuration) return
    if (chosenCalendarId === 'none') return
    if (retryingCalendar) return
    setCalendarInsertError(null)
    setRetryingCalendar(true)
    try {
      // Refresh token first — expired GIS tokens are the most common retry-failure cause.
      let token = googleToken
      try {
        token = await requestGoogleAccess(GOOGLE_SCOPES.EVENTS)
        setGoogleToken(token)
      } catch (err) {
        console.warn('[avails] token refresh on retry failed, falling back to existing token:', err)
      }
      if (!token) {
        setCalendarInsertError('Connect Google Calendar to retry')
        return
      }
      await insertGoogleEvent({ finalTime: poll.finalTime, finalDuration: poll.finalDuration, tokenOverride: token })
    } finally {
      setRetryingCalendar(false)
    }
  }

  function handleUnschedule() {
    setShowUnschedule(true)
  }

  // Actual unschedule — runs from the dialog's confirm. unfinalizePoll throwing
  // surfaces inline in the dialog; the Google deletion below stays best-effort
  // (must never roll back the unschedule — see CLAUDE.md).
  async function confirmUnschedule() {
    // Capture before unfinalize strips them from the record
    const googleEventId = poll?.googleEventId
    const googleCalendarId = poll?.googleCalendarId

    await unfinalizePoll(did, rkey)
    setOpenmeetUrl(null)
    setOpenmeetError(null)

    // Best-effort: remove the Google Calendar event. Failure here doesn't roll back the unschedule.
    if (googleEventId && googleCalendarId) {
      try {
        let token = googleToken
        try {
          token = await requestGoogleAccess(GOOGLE_SCOPES.EVENTS)
          setGoogleToken(token)
        } catch (err) {
          console.warn('[avails] token request for unschedule failed:', err)
        }
        if (!token) throw new Error('No Google token')
        await deleteEvent(token, googleCalendarId, googleEventId)
      } catch (err) {
        console.warn('[avails] deleteEvent on unschedule failed:', err)
        setCalendarCleanupWarning("Meeting unscheduled. We couldn't remove the event from Google Calendar automatically. Please delete it there manually.")
      }
    }

    fetchData()
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

  async function handlePublishToCommunityFeed(next) {
    setPublishingToFeed(true)
    setFeedError(null)
    try {
      const result = await publishToCommunityFeed(did, rkey, next)
      setFeedPublished(result.published)
    } catch (err) {
      console.error('Community feed publish error:', err)
      setFeedError(err.message || 'Failed to update the community feed')
    } finally {
      setPublishingToFeed(false)
    }
  }

  // Link / relink / unlink the poll's community. `next` is a community id, or ''
  // to unlink. Optimistically reflects the change so the feed control appears.
  async function handleSetCommunity(next) {
    setSavingCommunity(true)
    setCommunityError(null)
    try {
      await updatePoll(did, rkey, { community: next })
      setPoll(prev => ({ ...prev, community: next }))
    } catch (err) {
      console.error('Set community error:', err)
      setCommunityError(err.message || 'Failed to update the community')
    } finally {
      setSavingCommunity(false)
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
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center px-4">
        <div className="max-w-sm w-full rounded-xl border border-[#e8e5df] bg-[#faf9f6] p-8 text-center space-y-4">
          <p className="text-lg font-medium text-[#1a1a1a]">Couldn't load this poll</p>
          <p className="text-sm text-[#8a8580]">{error}</p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <Button
              onClick={() => { setError(null); setLoading(true); fetchData() }}
              className="bg-[#0d9488] text-white hover:bg-[#0f766e] rounded-lg"
            >
              Try again
            </Button>
            <a href="/" className="text-sm text-[#6b6560] hover:text-[#1a1a1a] underline underline-offset-2">
              Go home
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (!poll) return null

  const isOpen = !poll.finalTime
  const isCreator = session?.did === did
  const feedIsPublished = feedPublished === null ? !!poll.communityFeedPublishedAt : feedPublished
  const communityName = communities.find(c => c.id === poll.community)?.name || poll.community
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
          onConnectGoogleCalendar={() => connectGoogleCalendar()}
          connectingCalendar={connectingCalendar}
        />

        {/* Transient post-submit confirmation for the responder */}
        {justSubmitted && (
          <div className="rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] px-4 py-3 text-[#15803d] flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-base font-medium">
              You're in{participant?.name ? `, ${participant.name}` : ''}. The organizer will pick a time soon.
            </span>
          </div>
        )}

        {/* Best-effort calendar-cleanup notice (replaces a raw alert) */}
        {calendarCleanupWarning && (
          <div className="rounded-lg bg-[#fef9c3] border border-[#fde68a] px-4 py-3 text-[#854d0e] flex items-start justify-between gap-3">
            <span className="text-sm">{calendarCleanupWarning}</span>
            <button
              type="button"
              onClick={() => setCalendarCleanupWarning(null)}
              className="text-sm font-medium text-[#854d0e]/70 hover:text-[#854d0e] shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

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

            {/* Join, directly under the time. It is the one line someone opens
                this page to find five minutes before the call, so it sits above
                the calendar and OpenMeet rows rather than among them.
                Confirmed Green, not Gather Teal: teal inside this green card
                would put two brand voices in one component. */}
            {poll.meetingUrl && !editingMeetingUrl && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={poll.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-baseline gap-2 text-lg font-semibold text-[#15803d] hover:text-[#166534] no-underline"
                >
                  <span className="underline underline-offset-4 decoration-2">Join the call</span>
                  {/* The host alone, because a Zoom link carrying a passcode
                      query string is unreadable; the anchor keeps all of it.
                      Explicitly not underlined — inside the anchor it would
                      inherit one and read as a second, competing link. */}
                  <span className="text-sm font-normal text-[#6b6560] no-underline break-all">
                    {hostOf(poll.meetingUrl)}
                  </span>
                </a>
                {isCreator && (
                  <button
                    onClick={openMeetingLinkEditor}
                    className="text-sm text-[#6b6560] hover:text-[#1a1a1a] underline underline-offset-2 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}

            {isCreator && !poll.meetingUrl && !editingMeetingUrl && (
              <button
                onClick={openMeetingLinkEditor}
                className="text-sm font-medium text-[#15803d] hover:text-[#166534] underline underline-offset-2 transition-colors"
              >
                Add a meeting link
              </button>
            )}

            {isCreator && editingMeetingUrl && (
              <div className="space-y-3 max-w-md">
                <MeetingLinkField
                  value={meetingUrlDraft}
                  onChange={setMeetingUrlDraft}
                  suggestion={jitsiSuggestionFor(rkey)}
                  error={meetingUrlError}
                  disabled={meetingUrlSaving}
                  autoFocus
                />
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={handleSaveMeetingLink}
                    disabled={meetingUrlSaving}
                    className="bg-[#15803d] text-white hover:bg-[#166534]"
                  >
                    {meetingUrlSaving ? 'Saving…' : 'Save link'}
                  </Button>
                  <button
                    onClick={() => { setEditingMeetingUrl(false); setMeetingUrlError(null) }}
                    disabled={meetingUrlSaving}
                    className="text-sm text-[#6b6560] hover:text-[#1a1a1a] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-sm text-[#6b6560]">
                  Everyone who answered gets an updated invite. The time does not change.
                </p>
              </div>
            )}

            {googleEventLink && (
              <p className="text-sm text-[#0d9488]">
                Added to {googleEventLink.calendarSummary} —{' '}
                <a href={googleEventLink.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  view event
                </a>
              </p>
            )}
            {calendarInsertError && (
              <div className="text-sm text-red-700 flex items-center gap-2">
                <span>Couldn't add to calendar — schedule still confirmed.</span>
                <button
                  onClick={retryCalendarInsert}
                  disabled={retryingCalendar}
                  className="underline underline-offset-2 hover:text-red-900 disabled:opacity-60 disabled:no-underline"
                >
                  {retryingCalendar ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            )}

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

        {/* Creator: link the poll to a community, then publish it to that
            community's dashboard feed. The feed row appears once a community is
            set (#138 selector merged with the #5 sub-project F publish control). */}
        {isOpen && isCreator && (communities.length > 0 || poll.community) && (
          <div className="rounded-xl border border-[#e8e5df] bg-[#faf9f6] p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-[#1a1a1a]">Community</p>
                <p className="text-sm text-[#8a8580]">Choose the community this poll belongs to.</p>
              </div>
              <Select
                value={poll.community || '__none__'}
                onValueChange={v => handleSetCommunity(v === '__none__' ? '' : v)}
                disabled={savingCommunity}
              >
                <SelectTrigger aria-label="Community" className="w-full sm:w-[220px] border-[#e8e5df] bg-white text-[#1a1a1a]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {communities.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {communityError && <p className="text-sm text-red-600">{communityError}</p>}

            {poll.community && (
              <div className="flex items-center justify-between gap-4 flex-wrap border-t border-[#e8e5df] pt-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-[#1a1a1a]">Community feed</p>
                  <p className="text-sm text-[#8a8580]">
                    {feedIsPublished
                      ? `Showing on the ${communityName} dashboard so members find it without opening chat.`
                      : `Publish to the ${communityName} dashboard so members find it without opening chat.`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePublishToCommunityFeed(!feedIsPublished)}
                  disabled={publishingToFeed}
                  className="border-[#0d9488] text-[#0d9488] hover:bg-[#ccfbf1] shrink-0"
                >
                  {publishingToFeed ? 'Saving…' : feedIsPublished ? 'Unpublish' : 'Publish to community feed'}
                </Button>
              </div>
            )}
            {feedError && <p className="text-sm text-red-600">{feedError}</p>}
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
                googleConnected={!!googleToken}
                writableCalendars={writableCalendars}
                chosenCalendarId={chosenCalendarId}
                onChooseCalendar={setChosenCalendarId}
                onConnectGoogle={() => connectGoogleCalendar({ forEvent: true })}
                meetingUrl={meetingUrlDraft}
                onMeetingUrlChange={setMeetingUrlDraft}
                jitsiSuggestion={jitsiSuggestionFor(rkey)}
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

      <DeleteResponseDialog
        open={showDeleteResponse}
        onOpenChange={setShowDeleteResponse}
        onConfirm={confirmDeleteResponse}
      />

      <UnscheduleDialog
        open={showUnschedule}
        onOpenChange={setShowUnschedule}
        onConfirm={confirmUnschedule}
        published={!!poll?.openmeetEventSlug || !!openmeetUrl}
        hasGoogleEvent={!!poll?.googleEventId && !!poll?.googleCalendarId}
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
