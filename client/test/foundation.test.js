import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { slotColor, dateCapacity } from '../src/lib/gridPresentation.js'
import { paginateDates } from '../src/lib/datePagination.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const revision = '6df5682711d11d1dde20453d0e06a78aca48b34f'
const spec = `git+https://github.com/Citizen-Infra/design-system.git#${revision}`
const foundation = new URL('./', import.meta.resolve('@citizen-infra/design-system/tokens.css'))

test('one immutable HTTPS foundation pin, without replacing the framework', () => {
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'))
  assert.equal(pkg.dependencies['@citizen-infra/design-system'], spec)
  assert.equal(lock.packages[''].dependencies['@citizen-infra/design-system'], spec)
  assert.equal(lock.packages['node_modules/@citizen-infra/design-system'].resolved, spec)
  assert.equal(pkg.dependencies.react, '^19.2.0')
  assert.equal(JSON.parse(readFileSync(new URL('package.json', foundation), 'utf8')).version, '0.2.0-draft.1')
})

test('palette and font come from canonical package roles, not a competing app palette', () => {
  const css = read('src/styles/globals.css') + read('src/styles/open-index.css') + read('src/styles/avail-grid.css') + read('src/main.jsx')
  assert.match(css, /@citizen-infra\/design-system\/tokens.css/)
  assert.match(css, /@citizen-infra\/design-system\/fonts.css/)
  assert.doesNotMatch(css, /#[\da-f]{6}\b|rgba\(|oklch\(|@fontsource-variable\/geist|fonts\.googleapis/i)
  assert.doesNotMatch(css, /font-size:\s*\d+px/)
  assert.match(css, /hyphens: none/)
  assert.match(css, /--avails-text-caption: 0.875rem/)
  assert.match(css, /prefers-reduced-motion/)
})

test('both dated grids use the same responsive pages, data scale and row geometry', () => {
  for (const name of ['AvailGrid', 'SchedulingGrid']) {
    const source = read(`src/components/${name}.jsx`)
    assert.match(source, /useGridDates/)
    assert.match(source, /import \{ slotColor \} from '@\/lib\/gridPresentation'/)
    assert.match(source, /var\(--avails-grid-time-width\)/)
    assert.doesNotMatch(source, /avail-cell h-8|text-\[11px\]|rgba\(34/)
  }
  assert.match(read('src/components/AvailGrid.jsx'), /span} \* var\(--avails-slot-height\)/)
})

test('overlap intensity retains its monotonic count/total weighting', () => {
  assert.equal(slotColor(0, 3), null)
  assert.equal(slotColor(2, 0), null)
  const amounts = [1, 2, 3].map(count => Number(slotColor(count, 3).match(/ ([\d.]+)%/)[1]))
  assert.ok(amounts[0] < amounts[1] && amounts[1] < amounts[2])
  assert.ok(Math.abs(amounts[2] - 90) < 0.001)
  assert.match(slotColor(1, 3), /--cibc-data-high/)
  assert.match(slotColor(1, 3), /--cibc-data-empty/)
})

test('responsive pages cover every date exactly once and balance without losing selection keys', () => {
  const dates = Array.from({ length: 15 }, (_, i) => `example-${i}`)
  for (const width of [240, 288, 342, 704, 1200]) {
    for (const fontSize of [16, 32]) {
      const capacity = dateCapacity(width, fontSize), pages = paginateDates(dates, capacity)
      assert.ok(capacity >= 1 && capacity <= 7)
      assert.deepEqual(pages.flat(), dates)
      assert.ok(pages.every(page => page.length <= capacity))
      assert.ok(Math.max(...pages.map(p => p.length)) - Math.min(...pages.map(p => p.length)) <= 1)
    }
  }
  assert.equal(dateCapacity(342), 2)
  assert.equal(dateCapacity(342, 32), 1)
  assert.equal(dateCapacity(1200), 7)
})

test('calendar conflict, personal selection, pending edits and scheduled time have distinct roles', () => {
  const css = read('src/styles/avail-grid.css')
  for (const state of ['mine', 'busy', 'pending-add', 'pending-remove', 'pending-schedule', 'scheduled', 'active']) assert.ok(css.includes(`.avail-cell--${state}`), state)
  assert.match(css, /--cibc-data-empty: var\(--cibc-color-surface\)/)
  assert.match(css, /--cibc-data-high: var\(--cibc-color-action\)/)
  assert.match(css, /repeating-linear-gradient\(135deg/)
  assert.match(css, /inset 0 0 0 3px var\(--cibc-color-page\)/)
  assert.doesNotMatch(css + read('src/styles/open-index.css'), /--avails-(mine|busy)-wash/)
  assert.doesNotMatch(css, /--cibc-color-danger/)
  assert.match(css, /\.avail-cell--pending-remove:focus-visible\s*\{\s*outline-style: dashed/)
  assert.match(css, /\.avail-cell--pending-add:focus-visible/)
  assert.match(read('src/styles/open-index.css'), /\.avails-grid-event\s*\{\s*color: var\(--cibc-color-text\);\s*background: var\(--cibc-color-surface\)/)
  assert.match(css, /\.avail-cell--mine,\s*\.avails-mine-key/)
  assert.match(read('src/pages/PollView.jsx'), /avails-mine-key/)
  assert.match(read('src/pages/PollView.jsx'), /busy times are hatched/)
  assert.doesNotMatch(read('src/pages/PollView.jsx'), /--avails-mine-wash|busy times shown in pink/)
  assert.match(css, /--cibc-color-on-surface-strong/)
  assert.match(css, /focus-visible/)
})

test('upstream MIT/OFL notices are included unchanged without requiring a build for unit tests', () => {
  for (const [target, source] of [['cibc-design-system-MIT.txt', 'LICENSE'], ['OFL-Public-Sans.txt', 'fonts/OFL-Public-Sans.txt']]) {
    const expected = hash(readFileSync(new URL(source, foundation)))
    assert.equal(hash(readFileSync(new URL(`../public/licenses/${target}`, import.meta.url))), expected)
  }
})

test('standalone favicon reuses the existing sixteen-cell mark and pinned field colours', () => {
  const svg = read('public/favicon.svg'), tokens = readFileSync(new URL('tokens.css', foundation), 'utf8')
  assert.equal((svg.match(/<rect/g) || []).length, 17)
  for (const colour of svg.matchAll(/fill="(#[A-Fa-f0-9]{6})"/g)) assert.ok(tokens.includes(colour[1]))
  assert.match(read('index.html'), /href="\/favicon.svg"/)
})

test('calendar titles have focus/accessible recovery and a readout outside the painting surface', () => {
  const grid = read('src/components/AvailGrid.jsx')
  assert.match(grid, /Busy on your calendar\$\{slotEvents\[key\]/)
  assert.match(grid, /busy on your calendar\$\{eventName/)
  assert.match(grid, /<details/)
  assert.match(grid, /<summary[^>]*>Calendar conflicts/)
  assert.match(grid, /\{' — '\}\{entry.title\}/)
  assert.match(grid, /max-w-\[min\(24rem/)
})

test('About keeps its factual phrases as ordinary prose after their headings', () => {
  const about = read('src/pages/About.jsx')
  assert.ok(about.indexOf('Open-source scheduling.') > about.indexOf('</h1>'))
  assert.ok(about.indexOf('AI-native scheduling.') > about.indexOf('Create polls from'))
  assert.doesNotMatch(about, /text-sm font-medium text-primary mb-[46]/)
})
