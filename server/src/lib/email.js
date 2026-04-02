import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail({ to, subject, html, attachments }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set, skipping email to:', to);
    return;
  }
  return resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Avails <noreply@cibc.zhgnv.com>',
    to,
    subject,
    html,
    attachments,
  });
}
