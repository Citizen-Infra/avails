import test from 'node:test'
import assert from 'node:assert/strict'
import { slotOpacity, slotLayerCount } from '../src/lib/gridPresentation.js'

test('one vote is translucent and additional layers compound without peak normalization', () => {
  assert.equal(slotOpacity(0), 0)
  assert.ok(Math.abs(slotOpacity(1) - 0.22) < 1e-12)
  assert.ok(Math.abs(slotOpacity(4) - (1 - 0.78 ** 4)) < 1e-12)
  for (let count = 1; count <= 8; count++) assert.ok(slotOpacity(count) > slotOpacity(count - 1))
  for (const count of [9, 10, 1000]) assert.equal(slotOpacity(count), 0.88)
  for (const count of [-1, undefined, NaN, Infinity]) assert.equal(slotOpacity(count), 0)
})

test('a new personal draft adds one layer while a saved personal vote is replaced', () => {
  assert.equal(slotLayerCount(0, { selected: true, editable: true }), 1)
  assert.equal(slotLayerCount(3, { selected: true, editable: true }), 4)
  assert.equal(slotLayerCount(3, { selected: true, saved: true, editable: true }), 3)
  assert.equal(slotLayerCount(3, { selected: false, saved: true, editable: true }), 2)
  assert.equal(slotLayerCount(1, { selected: false, saved: true, editable: true }), 0)
  assert.equal(slotLayerCount(0, { selected: true, saved: true, editable: true }), 1)
})

test('personal drag previews adjust only the personal contribution', () => {
  assert.equal(slotLayerCount(2, { editable: true, preview: 'add' }), 3)
  assert.equal(slotLayerCount(2, { selected: true, saved: true, editable: true, preview: 'add' }), 2)
  assert.equal(slotLayerCount(2, { selected: true, saved: true, editable: true, preview: 'remove' }), 1)
  assert.equal(slotLayerCount(2, { selected: true, editable: true, preview: 'remove' }), 2)
  assert.equal(slotLayerCount(0, { selected: true, editable: true, preview: 'remove' }), 0)
})

test('read-only and focused-person lenses do not add a duplicate personal layer', () => {
  for (const count of [0, 1, 3]) {
    assert.equal(slotLayerCount(count, { selected: true, saved: true }), count)
    assert.equal(slotLayerCount(count, { selected: true, preview: 'add' }), count)
  }
  assert.equal(slotLayerCount(NaN), 0)
})
