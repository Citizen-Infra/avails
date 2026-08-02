import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// `text` is required alongside `html`. An HTML-only message is a spam signal on
// its own, and avails sends from a domain with no sending reputation to absorb
// one. Build both parts with composeEmail() in ./email-template.js rather than
// hand-writing either.
export async function sendEmail({ to, subject, html, text, attachments }) {
  // Validate before the configuration check, not after: without a key the
  // function returns early, so a guard placed below it would never fire in
  // development or tests and would only surface in production.
  if (!text) throw new Error(`sendEmail: text part is required (to: ${to})`);
  if (!resend) {
    console.warn('RESEND_API_KEY not set, skipping email to:', to);
    return;
  }
  return resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Avails <noreply@citizeninfra.org>',
    to,
    subject,
    html,
    text,
    attachments,
  });
}
