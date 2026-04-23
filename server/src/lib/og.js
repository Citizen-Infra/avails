import fs from 'fs';
import path from 'path';

// Open Graph metadata injection for poll URLs. SPA crawlers don't execute
// JS so they only see whatever HTML the server returns — this rewrites the
// default <title>/<meta> tags in client/dist/index.html to poll-specific
// values before serving, so Telegram/Slack/Discord/etc render rich previews.

let cachedIndexHtml = null;

function readIndexHtml(clientDist) {
  if (cachedIndexHtml) return cachedIndexHtml;
  try {
    cachedIndexHtml = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
    return cachedIndexHtml;
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Format a YYYY-MM-DD date string in UTC (server timezone-agnostic).
// Format is "Wkd Mon D" without a comma between weekday and month so
// multiple dates can be joined with ", " cleanly.
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(Date.UTC(y, m - 1, d));
  const wd = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${wd} ${md}`;
}

// Build the OG description from the poll record. Deliberately does NOT mention
// response count — that's poll-state info that shouldn't leak into link previews,
// and in hideResponsesUntilSubmit polls it would be counterproductive.
export function buildOgDescription(poll) {
  const parts = [];

  // Dates: list up to 3, otherwise summarise as range
  const dates = Array.isArray(poll.dates) ? poll.dates : [];
  if (dates.length > 0) {
    if (dates.length <= 3) {
      parts.push(dates.map(formatDate).join(', '));
    } else {
      parts.push(`${dates.length} dates, ${formatDate(dates[0])}–${formatDate(dates[dates.length - 1])}`);
    }
  }

  // Time range + timezone
  const tr = poll.timeRange || {
    start: poll.earliestTime || '09:00',
    end: poll.latestTime || '17:00',
  };
  const timeStr = tr.start && tr.end ? `${tr.start}–${tr.end}` : '';
  const tzStr = poll.timezone || '';
  if (timeStr) parts.push(timeStr + (tzStr ? ' ' + tzStr : ''));

  // Finalized polls: note the scheduled time
  if (poll.finalTime) {
    try {
      const when = new Date(poll.finalTime).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: poll.timezone || 'UTC',
      });
      parts.unshift(`Scheduled ${when}`);
    } catch {}
  }

  return parts.join(' · ') || 'Group scheduling on AT Protocol';
}

/**
 * Replace default OG/twitter/title tags in the index.html template with
 * poll-specific values. Uses targeted regexes keyed on property/name so the
 * replacement is tolerant of attribute-order tweaks.
 */
export function injectOg(html, { title, description, url, image }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = image ? escapeHtml(image) : null;

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="description" content="${d}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:description" content="${d}" />`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:url" content="${u}" />`);

  if (img) {
    out = out.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?\s*>/i, `<meta property="og:image" content="${img}" />`);
  }

  return out;
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Minimal PDS resolution + poll fetch, local to this module to avoid cross-
// importing the route files (circular). Intentionally uses anonymous read —
// poll records are public ATProto data.
async function fetchPoll(did, rkey) {
  try {
    const plc = await fetchWithTimeout(`https://plc.directory/${encodeURIComponent(did)}`);
    if (!plc.ok) return null;
    const doc = await plc.json();
    const svc = doc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    );
    const pds = svc?.serviceEndpoint || 'https://bsky.social';
    const rec = await fetchWithTimeout(
      `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=chat.avails.scheduling.poll&rkey=${encodeURIComponent(rkey)}`
    );
    if (!rec.ok) return null;
    const data = await rec.json();
    return data.value || null;
  } catch {
    return null;
  }
}

// Per-poll cache (keyed by did/rkey) so a burst of crawler hits doesn't hammer
// the PDS. Short TTL — polls change (title edits, finalize, unschedule), and
// we'd rather serve slightly-stale OG than block the response path.
const CACHE_TTL_MS = 60 * 1000;
const pollCache = new Map(); // key → { poll, expiresAt }

export function clearOgCache() {
  pollCache.clear();
  cachedIndexHtml = null;
}

async function fetchPollCached(did, rkey) {
  const key = `${did}/${rkey}`;
  const now = Date.now();
  const hit = pollCache.get(key);
  if (hit && hit.expiresAt > now) return hit.poll;
  const poll = await fetchPoll(did, rkey);
  pollCache.set(key, { poll, expiresAt: now + CACHE_TTL_MS });
  return poll;
}

/**
 * Express handler for GET /p/:did/:rkey that serves the SPA with per-poll
 * OG metadata injected. Falls back to the unmodified template if the poll
 * can't be fetched (network issue, unknown DID, record deleted).
 */
export function pollOgHandler(clientDist) {
  return async (req, res) => {
    const { did, rkey } = req.params;
    const html = readIndexHtml(clientDist);
    if (!html) {
      // index.html not on disk yet (dev without a build) — let SPA fallback handle
      return res.status(404).send('index.html not found');
    }

    const poll = await fetchPollCached(did, rkey);
    if (!poll) {
      return res.type('html').send(html);
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const ogUrl = `${protocol}://${host}/p/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`;
    const ogImage = `${protocol}://${host}/og-image.png`;

    const title = poll.title ? `${poll.title} — Avails` : 'Avails — Group Scheduling';
    const description = buildOgDescription(poll);

    res.type('html').send(injectOg(html, { title, description, url: ogUrl, image: ogImage }));
  };
}
