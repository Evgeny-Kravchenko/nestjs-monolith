import { OutgoingMail } from '@/core/mail/mail.types';

const SUBJECT = 'Confirm your registration';
const VALIDITY = '10 minutes';

export function buildOtpMail(to: string, code: string): OutgoingMail {
  return {
    to,
    subject: SUBJECT,
    text: `Your confirmation code is ${code}. It is valid for ${VALIDITY}.`,
    html: `<p>Your confirmation code is <strong>${code}</strong>. It is valid for ${VALIDITY}.</p>`,
  };
}

export function buildMagicLinkMail(to: string, link: string): OutgoingMail {
  return {
    to,
    subject: SUBJECT,
    text: `Confirm your registration by opening this link: ${link}\nIt is valid for ${VALIDITY}.`,
    html: `<p><a href="${escapeHtml(link)}">Confirm your registration</a>. The link is valid for ${VALIDITY}.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
