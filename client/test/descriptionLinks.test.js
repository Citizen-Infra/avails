import test from 'node:test'
import assert from 'node:assert/strict'

import { descriptionLinks } from '../src/lib/descriptionLinks.js'

test('links web URLs and leaves surrounding text and punctuation intact', () => {
  assert.deepEqual(descriptionLinks('Join at https://example.org/meet?day=1, or www.example.com.'), [
    { text: 'Join at ' },
    { text: 'https://example.org/meet?day=1', href: 'https://example.org/meet?day=1' },
    { text: ', or ' },
    { text: 'www.example.com', href: 'https://www.example.com/' },
    { text: '.' },
  ])
})

test('keeps balanced URL parentheses but not enclosing punctuation', () => {
  assert.deepEqual(descriptionLinks('(https://example.org/wiki/Meeting_(event)).'), [
    { text: '(' },
    { text: 'https://example.org/wiki/Meeting_(event)', href: 'https://example.org/wiki/Meeting_(event)' },
    { text: ').' },
  ])
})

test('keeps markup, unsafe schemes, and malformed URLs as plain text', () => {
  assert.deepEqual(descriptionLinks('<script>alert(1)</script> javascript:alert(1) https://'), [
    { text: '<script>alert(1)</script> javascript:alert(1) https://' },
  ])
})
