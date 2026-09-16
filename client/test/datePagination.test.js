import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_DATES_PER_PAGE, paginateDates } from '../src/lib/datePagination.js'

function dates(count) {
  return Array.from({ length: count }, (_, index) => `date-${index + 1}`)
}

test('keeps every date when an eight-date poll crosses a month boundary', () => {
  const input = [
    '2026-06-27',
    '2026-06-28',
    '2026-06-29',
    '2026-06-30',
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
  ]

  assert.deepEqual(paginateDates(input), [input.slice(0, 4), input.slice(4)])
})

test('keeps pages ordered, balanced, and within the seven-date maximum', () => {
  for (let count = 1; count <= 30; count++) {
    const input = dates(count)
    const pages = paginateDates(input)
    const pageSizes = pages.map(page => page.length)

    assert.deepEqual(pages.flat(), input)
    assert.ok(Math.max(...pageSizes) <= MAX_DATES_PER_PAGE)
    assert.ok(Math.max(...pageSizes) - Math.min(...pageSizes) <= 1)
  }
})

test('returns no pages when no dates are selected', () => {
  assert.deepEqual(paginateDates([]), [])
})
