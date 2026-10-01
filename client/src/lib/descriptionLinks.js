const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi
const TRAILING_PUNCTUATION = /[.,!?;:'"]$/
const CLOSING_BRACKETS = { ')': '(', ']': '[', '}': '{' }

function trimUrl(candidate) {
  let url = candidate
  while (url) {
    const last = url.at(-1)
    if (TRAILING_PUNCTUATION.test(last)) {
      url = url.slice(0, -1)
    } else if (last in CLOSING_BRACKETS &&
      url.split(last).length > url.split(CLOSING_BRACKETS[last]).length) {
      url = url.slice(0, -1)
    } else {
      break
    }
  }
  return url
}

// Keep descriptions as text; only recognized web URLs become links.
export function descriptionLinks(description) {
  const parts = []
  let cursor = 0

  for (const match of description.matchAll(URL_PATTERN)) {
    const text = trimUrl(match[0])
    let href
    try {
      const url = new URL(text.startsWith('www.') ? `https://${text}` : text)
      if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href
    } catch {
      // A malformed URL remains plain text.
    }
    if (!href) continue

    if (match.index > cursor) parts.push({ text: description.slice(cursor, match.index) })
    parts.push({ text, href })
    cursor = match.index + text.length
  }

  if (cursor < description.length) parts.push({ text: description.slice(cursor) })
  return parts
}
