import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail({ to, subject, html, attachments }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set, skipping email to:', to);
    return;
  }
  return resend.emails.send({
    from: 'Avails <noreply@zhgnv.com>',
    to,
    subject,
    html,
    attachments,
  });
}
