// One composer for every Avails email, producing the HTML and plain-text parts
// together from the same input.
//
// Why it takes plain text and never HTML: callers used to hand-write HTML
// fragments, and two of five interpolated user-supplied poll titles straight
// into markup without escaping. Escaping here rather than at the call sites
// removes the whole bug class instead of the two instances that happened to
// exist. It also makes a message with no text part impossible to write, which
// is the other half of avails#146.
//
// Shape follows DESIGN.md's "light brand" register for email: Paper Cream
// ground, hairline border, flat, text wordmark, one link, no images and no
// filled button. A heavier promotional layout is measurably worse for inbox
// placement, and avails sends from a domain with no reputation to spend.

const ESCAPES = { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => String(s).replace(/[&"'<>]/g, (c) => ESCAPES[c]);

const CREAM = '#faf9f6';      // Paper Cream — the ground
const INK = '#1a1a1a';        // Warm Ink — primary text
const STONE = '#6b6560';      // Stone — secondary text
const HAIRLINE = '#e8e5df';   // Hairline — the one rule

// Deep Teal, not Gather Teal, and this is deliberate. Gather Teal (#0d9488) on
// Paper Cream is 3.56:1 — fine for large text and UI, below WCAG AA's 4.5:1 for
// body-size text, which is exactly what a link in an email body is. Deep Teal is
// 5.28:1. DESIGN.md §2 scopes Deep Teal to the scheduled-card gradient and says
// it never appears alone; this is a documented exception for email body links,
// recorded in DESIGN.md under Named Rules.
const LINK = '#0f766e';

// Geist first for the rare client that has it, then the system stack. Webfonts
// are not loadable in most mail clients, so this honours the One Typeface Rule
// as far as email allows rather than pretending otherwise.
const FONT = "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Compose an email's HTML and plain-text parts from plain-text input.
 *
 * @param {object} opts
 * @param {string} opts.heading      The answer, stated plainly. Title weight.
 * @param {string[]} opts.paragraphs Body prose. Plain text; escaped here.
 * @param {{label: string, url: string}|null} [opts.action] Single optional link.
 * @param {string} opts.footer       Why this arrived. Plain text.
 * @returns {{html: string, text: string}}
 */
export function composeEmail({ heading, paragraphs = [], action = null, footer }) {
  const body = paragraphs.filter(Boolean);

  const htmlParagraphs = body
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${INK};">${esc(p)}</p>`
    )
    .join('');

  const htmlAction = action
    ? `<p style="margin:0 0 4px 0;font-size:15px;line-height:1.55;">` +
      `<a href="${esc(action.url)}" style="color:${LINK};text-decoration:underline;">${esc(action.label)}</a>` +
      `</p>`
    : '';

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    // Tells supporting clients not to auto-invert. A cream ground forced into
    // dark mode goes muddy, and the recipient's client is not ours to choose.
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${esc(heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:${CREAM};color-scheme:light;">` +
    // width must be in CSS as well as the attribute. With the attribute alone
    // the percentage resolves against a box that ignores the outer padding, so
    // max-width never clamps and the body clips off the right edge on a phone.
    // Padding lives on the td, not the table: several clients drop CSS padding
    // on a table element outright.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;background:${CREAM};">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    // table-layout:fixed with word-wrap:break-word guards against a long
    // unbreakable token (a raw URL used as link text, a long title with no
    // spaces) forcing the table past its declared width under auto layout.
    // Precautionary rather than fixing an observed break.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;table-layout:fixed;text-align:left;word-wrap:break-word;">` +
    `<tr><td style="font-family:${FONT};padding:0 0 22px 0;font-size:13px;font-weight:500;letter-spacing:0.02em;color:${STONE};">avails</td></tr>` +
    `<tr><td style="font-family:${FONT};">` +
    `<h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;line-height:1.3;color:${INK};">${esc(heading)}</h1>` +
    htmlParagraphs +
    htmlAction +
    `<p style="margin:24px 0 0 0;padding-top:16px;border-top:1px solid ${HAIRLINE};font-size:13px;line-height:1.5;color:${STONE};">${esc(footer)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  const text = [
    heading,
    '',
    ...body.flatMap((p) => [p, '']),
    ...(action ? [`${action.label}: ${action.url}`, ''] : []),
    '--',
    footer,
  ].join('\n');

  return { html, text };
}
