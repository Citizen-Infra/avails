import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const image = new URL('../public/og-image-open-index.png', import.meta.url)
const source = readFileSync(new URL('../scripts/social-preview.html', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('social cover is an actual landscape PNG referenced by both sharing families', () => {
  const png = readFileSync(image)
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
  assert.ok(png.length < 1_000_000, 'sharing asset stays under 1MB')
  assert.equal((html.match(/content="https:\/\/avails.citizeninfra.org\/og-image-open-index.png"/g) || []).length, 2)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
  assert.match(html, /property="og:image:alt" content="[^\"]+"/)
  assert.match(html, /name="twitter:image:alt" content="[^\"]+"/)
})

test('social source inherits the pinned identity and never reads poll or participant data', () => {
  assert.match(source, /@citizen-infra\/design-system\/fonts.css/)
  assert.match(source, /@citizen-infra\/design-system\/tokens.css/)
  assert.match(source, /src="\/favicon.svg"/)
  assert.match(source, /slotOpacity/)
  assert.match(source, /var\(--cibc-color-page\)/)
  assert.match(source, /var\(--cibc-color-action\)/)
  assert.doesNotMatch(source, /fetch\(|\/api\/|localStorage|sessionStorage|https?:\/\//)
  assert.doesNotMatch(source, /impeccable|THESIS:|OWN-WORLD:|FIRST VIEWPORT:|FINISH:/)
})
