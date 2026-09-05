import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Input data required to render a participant invitation PDF (Section 19). */
export interface InvitationPdfInput {
  eventName: string;
  participantName: string;
  registrationNo: string;
  registeredCount: number;
  eventDateLabel: string;
  venue?: string | null;
  instructions?: string | null;
  qrPngBytes: Uint8Array;
}

/** Builds the download filename for an invitation PDF, e.g. `MDF26-0042-Invitation.pdf`. */
export function invitationPdfFilename(registrationNo: string): string {
  return `${registrationNo}-Invitation.pdf`;
}

/**
 * Appends every page of `attachmentPdfBytes` after `basePdfBytes`, returning
 * a single merged PDF. Used to embed an event's optional invite
 * attachment (flyer/brochure/formal letter, Section 19) directly after each
 * participant's generated ticket page, so the email carries one combined
 * PDF file rather than two separate attachments.
 */
export async function mergePdfDocuments(basePdfBytes: Uint8Array, attachmentPdfBytes: Uint8Array): Promise<Uint8Array> {
  const baseDoc = await PDFDocument.load(basePdfBytes);
  const attachmentDoc = await PDFDocument.load(attachmentPdfBytes);
  const copiedPages = await baseDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
  for (const page of copiedPages) {
    baseDoc.addPage(page);
  }
  return baseDoc.save();
}

/**
 * Renders the participant invitation PDF described in REQUIREMENTS.md
 * Section 19: event name, participant name, registration ID, QR code(s),
 * registered guest count, and check-in instructions.
 *
 * When `registeredCount > 1`, one page per registered guest is rendered
 * (each labeled "Guest X of N") instead of a single page, so a group
 * registration of e.g. 4 people yields 4 separate QR codes in the same
 * PDF - each guest can be scanned/checked in individually at the door.
 * All guest pages encode the same underlying QR token/image (the
 * check-in API already tracks a running headcount per registration and
 * rejects checking in more people than were registered), so this does not
 * require any change to how QR tokens are generated/validated.
 */
export async function renderInvitationPdf(input: InvitationPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const qrImage = await doc.embedPng(input.qrPngBytes);

  const guestCount = Math.max(1, input.registeredCount);

  for (let guestIndex = 1; guestIndex <= guestCount; guestIndex += 1) {
    const page = doc.addPage([420, 594]); // A6-ish portrait card
    const { width } = page.getSize();
    let cursorY = 540;
    const centerText = (text: string, size: number, useFont = font, color = rgb(0, 0, 0)) => {
      const textWidth = useFont.widthOfTextAtSize(text, size);
      page.drawText(text, { x: (width - textWidth) / 2, y: cursorY, size, font: useFont, color });
      cursorY -= size + 10;
    };

    centerText(input.eventName, 20);
    cursorY -= 10;
    centerText(input.participantName.toUpperCase(), 16);
    cursorY -= 10;
    centerText('Registration ID', 10, regularFont, rgb(0.35, 0.35, 0.35));
    centerText(input.registrationNo, 18);
    if (guestCount > 1) {
      centerText(`Guest ${guestIndex} of ${guestCount}`, 12, regularFont, rgb(0.35, 0.35, 0.35));
    }
    cursorY -= 10;

    const qrSize = 220;
    page.drawImage(qrImage, { x: (width - qrSize) / 2, y: cursorY - qrSize, width: qrSize, height: qrSize });
    cursorY -= qrSize + 30;

    centerText(`Registered Guests: ${input.registeredCount}`, 12, regularFont);
    centerText(`Event Date: ${input.eventDateLabel}`, 11, regularFont);
    if (input.venue) {
      centerText(`Venue: ${input.venue}`, 11, regularFont);
    }
    cursorY -= 10;
    centerText('Present this QR at check-in.', 11, regularFont, rgb(0.2, 0.2, 0.2));

    if (input.instructions) {
      cursorY -= 20;
      centerText(input.instructions, 9, regularFont, rgb(0.4, 0.4, 0.4));
    }
  }

  return doc.save();
}
