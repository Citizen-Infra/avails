import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_DATES_PER_PAGE, paginateDates } from '../src/lib/datePagination.js'

function dates(count) {
  return Array.from({ length: count }, (_, index) => `date-${index + 1}`)
}

test('balances eight dates across two equal pages', () => {
  assert.deepEqual(paginateDates(dates(8)).map(page => page.length), [4, 4])
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
