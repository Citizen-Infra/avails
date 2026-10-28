import test from 'node:test'
import assert from 'node:assert/strict'
import { analytics } from '../src/lib/analytics.js'
import { createPoll, submitResponse, finalizePoll, updateResponse } from '../src/lib/api.js'

test('only successful creation, new responses and finalization emit minimal action events', async t => {
  const events = [], requests = []
  const original = globalThis.fetch
  t.mock.method(analytics, 'capture', (...args) => events.push(args))
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ example: 'PRIVATE_RESULT' }) }
  t.after(() => { globalThis.fetch = original })
  assert.deepEqual(await createPoll({ title: 'PRIVATE_POLL' }), { example: 'PRIVATE_RESULT' })
  await submitResponse('PRIVATE_DID', 'PRIVATE_KEY', { name: 'PRIVATE_NAME', slots: ['PRIVATE_SLOT'], email: 'PRIVATE_EMAIL' })
  await finalizePoll('PRIVATE_DID', 'PRIVATE_KEY', 'PRIVATE_TIME', 60, ['PRIVATE_EMAIL'], 'PRIVATE_LINK')
  await updateResponse('PRIVATE_DID', 'PRIVATE_KEY', 'PRIVATE_RESPONSE', { name: 'PRIVATE_NAME' })
  assert.deepEqual(events, [['poll_created'], ['response_submitted'], ['meeting_finalized']])
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/)
  assert.equal(requests.length, 4)
})

test('failed scheduling operations emit no completion event and retain their existing errors', async t => {
  const events = [], original = globalThis.fetch
  t.mock.method(analytics, 'capture', (...args) => events.push(args))
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => Response.json({ error: 'PRIVATE_ERROR' }, { status: 400 })
  await assert.rejects(createPoll({}), /PRIVATE_ERROR/)
  await assert.rejects(submitResponse('private', 'private', {}), /PRIVATE_ERROR/)
  await assert.rejects(finalizePoll('private', 'private', 'private', 60, []), /PRIVATE_ERROR/)
  assert.equal(events.length, 0)
})

test('an unexpected analytics exception never turns successful scheduling into a failure', async t => {
  const original = globalThis.fetch
  t.mock.method(analytics, 'capture', () => { throw new Error('Synthetic analytics failure') })
  globalThis.fetch = async () => Response.json({ saved: true })
  t.after(() => { globalThis.fetch = original })
  assert.deepEqual(await createPoll({}), { saved: true })
})
