/**
 * Client-side helpers for resolving a Bluesky list URL/URI to a canonical
 * at:// URI, using Bluesky's public (unauthenticated, CORS-enabled) AppView.
 * No avails server round-trip needed — this is a public read, same trust
 * level as opening the list in a browser.
 */

const PUBLIC_API = 'https://public.api.bsky.app'

/**
 * Parse a Bluesky list URL (https://bsky.app/profile/<handle-or-did>/lists/<rkey>)
 * or a raw at:// list URI into { authority, rkey }. Returns null if the input
 * doesn't match either shape.
 */
export function parseListInput(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('at://')) {
    const m = trimmed.match(/^at:\/\/([^/]+)\/app\.bsky\.graph\.list\/([^/]+)$/)
    return m ? { authority: m[1], rkey: m[2] } : null
  }

  try {
    const url = new URL(trimmed)
    const m = url.pathname.match(/^\/profile\/([^/]+)\/lists\/([^/]+)/)
    return m ? { authority: m[1], rkey: m[2] } : null
  } catch {
    return null
  }
}

async function resolveDid(authority) {
  if (authority.startsWith('did:')) return authority
  const res = await fetch(
    `${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(authority)}`
  )
  if (!res.ok) throw new Error(`Could not resolve handle "${authority}".`)
  const data = await res.json()
  return data.did
}

/**
 * Resolve a list URL/URI to its canonical at:// URI and confirm it exists
 * via app.bsky.graph.getList. Throws a user-facing Error on failure.
 * Returns { uri, name, purpose, itemCount }.
 */
export async function resolveList(input) {
  const parsed = parseListInput(input)
  if (!parsed) {
    throw new Error('Enter a Bluesky list URL (bsky.app/profile/…/lists/…) or an at:// list URI.')
  }

  const did = await resolveDid(parsed.authority)
  const uri = `at://${did}/app.bsky.graph.list/${parsed.rkey}`

  const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(uri)}`)
  if (!res.ok) {
    throw new Error("That list couldn't be found. Double-check the URL and that the list is public.")
  }
  const data = await res.json()
  const list = data.list
  if (!list) {
    throw new Error("That list couldn't be found. Double-check the URL and that the list is public.")
  }

  return { uri, name: list.name, purpose: list.purpose, itemCount: data.items?.length ?? list.listItemCount }
}
