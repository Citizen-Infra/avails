import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AnalyticsConsent.jsx', import.meta.url), 'utf8')

test('consent shows full equal-weight choices while undecided, then collapses to one quiet line', () => {
  assert.match(source, /const expanded = consent === 'unknown' \|\| open/)
  assert.match(source, /<h2 id="analytics-heading" className="text-lg font-semibold">Optional usage analytics<\/h2>/)
  assert.match(source, /<h2 id="analytics-heading" className="sr-only">Optional usage analytics<\/h2>/)
  assert.match(source, /aria-labelledby="analytics-heading"/)
  assert.match(source, /role="status"/)
  assert.match(source, /variant="outline" onClick=\{\(\) => choose\('denied'\)\}>Keep analytics off</)
  assert.match(source, /variant="outline" onClick=\{\(\) => choose\('allowed'\)\}>Allow analytics</)
  // The quiet line stays muted and small; the white band exists only while expanded.
  assert.match(source, /expanded \? 'bg-card py-6 text-foreground' : 'py-2 text-sm text-muted-foreground'/)
  // Withdrawal stays one action away: the collapsed line owns the change entry.
  assert.match(source, /onClick=\{\(\) => setOpen\(true\)\}\s*\n?\s*className="underline underline-offset-4[^"]*focus-visible:ring/)
})

test('collapsed line keeps focus recovery, storage warning and poll-route clearance', () => {
  assert.match(source, /settings\.current\?\.focus\(\); setFocusSettings\(false\)/)
  assert.match(source, /setStorageWarning\(!analytics\.setConsent\(value\)\)/)
  assert.match(source, /applies to this tab only\./)
  assert.match(source, /pb-36 lg:pb-6/)
  assert.match(source, /aria-controls="analytics-choices"/)
  assert.match(source, /id="analytics-choices"/)
})

test('the analytics choice never gates scheduling surface or leaks before consent', () => {
  assert.match(source, /if \(!analytics\.enabled\) return null/)
  assert.match(source, /useEffect\(\(\) => \{ analytics\.page\(pathname\) \}, \[pathname, consent\]\)/)
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage\.setItem/)
  assert.doesNotMatch(source, /fetch\(/)
})
