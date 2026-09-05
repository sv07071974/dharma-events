/** Input data required to render the invitation email (Section 19). */
export interface InvitationEmailInput {
  eventName: string;
  participantName: string;
  registrationNo: string;
  registeredCount: number;
  eventDateLabel: string;
  venue?: string | null;
  instructions?: string | null;
  qrDataUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the participant invitation email (Section 19/20): event details,
 * registration ID, registered guest count, and an inline QR image. The QR
 * image is also attached as a PDF by the caller (Section 8.5 - inline where
 * supported, plus a PDF attachment).
 */
export function renderInvitationEmail(input: InvitationEmailInput): RenderedEmail {
  const subject = `Your invitation to ${input.eventName} - ${input.registrationNo}`;

  const venueLine = input.venue ? `<p><strong>Venue:</strong> ${escapeHtml(input.venue)}</p>` : '';
  const instructionsBlock = input.instructions
    ? `<p style="color:#555">${escapeHtml(input.instructions)}</p>`
    : '';

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>${escapeHtml(input.eventName)}</h2>
      <p>Dear ${escapeHtml(input.participantName)},</p>
      <p>Here is your invitation. Please present the QR code below at check-in.</p>
      <p><strong>Registration ID:</strong> ${escapeHtml(input.registrationNo)}</p>
      <p><strong>Registered Guests:</strong> ${input.registeredCount}</p>
      <p><strong>Event Date:</strong> ${escapeHtml(input.eventDateLabel)}</p>
      ${venueLine}
      <div style="text-align:center;margin:20px 0">
        <img src="${input.qrDataUrl}" alt="Check-in QR code" width="220" height="220" />
      </div>
      ${instructionsBlock}
      <p>A PDF copy of this invitation is attached for your convenience.</p>
    </div>
  `.trim();

  const text = [
    `${input.eventName}`,
    ``,
    `Dear ${input.participantName},`,
    `Here is your invitation. Please present the QR code (see attached PDF) at check-in.`,
    ``,
    `Registration ID: ${input.registrationNo}`,
    `Registered Guests: ${input.registeredCount}`,
    `Event Date: ${input.eventDateLabel}`,
    input.venue ? `Venue: ${input.venue}` : '',
    input.instructions ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
