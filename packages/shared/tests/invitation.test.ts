import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildQrUrl, generateQrToken, hashQrToken } from '../src/qr-token.js';
import { renderQrDataUrl, renderQrPng } from '../src/qr-image.js';
import { invitationPdfFilename, renderInvitationPdf } from '../src/invitation-pdf.js';
import { renderInvitationEmail } from '../src/invitation-email.js';
import { retryDelayMs } from '../src/invitation-retry.js';

describe('generateQrToken / hashQrToken', () => {
  it('generates URL-safe tokens with at least 128 bits of randomness by default', () => {
    const token = generateQrToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // base64url of 24 bytes -> 32 chars, no padding.
    expect(token.length).toBe(32);
  });

  it('rejects fewer than 16 bytes', () => {
    expect(() => generateQrToken(8)).toThrow(/128 bits/);
  });

  it('generates distinct tokens on each call', () => {
    const a = generateQrToken();
    const b = generateQrToken();
    expect(a).not.toBe(b);
  });

  it('hashes deterministically with SHA-256 (hex, 64 chars)', () => {
    const token = 'fixed-token-value';
    const hash1 = hashQrToken(token);
    const hash2 = hashQrToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashQrToken('a')).not.toBe(hashQrToken('b'));
  });
});

describe('buildQrUrl', () => {
  it('joins the public URL and token with /q/', () => {
    expect(buildQrUrl('https://events.sansmi.org', 'abc123')).toBe(
      'https://events.sansmi.org/q/abc123',
    );
  });

  it('strips a trailing slash from the public URL', () => {
    expect(buildQrUrl('https://events.sansmi.org/', 'abc123')).toBe(
      'https://events.sansmi.org/q/abc123',
    );
  });
});

describe('renderQrPng / renderQrDataUrl', () => {
  it('renders a PNG buffer that decodes back to the original URL', async () => {
    const url = buildQrUrl('https://events.sansmi.org', generateQrToken());
    const png = await renderQrPng(url);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic bytes
    expect(png.length).toBeGreaterThan(0);
  });

  it('renders a data URL', async () => {
    const url = buildQrUrl('https://events.sansmi.org', generateQrToken());
    const dataUrl = await renderQrDataUrl(url);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('invitationPdfFilename', () => {
  it('builds the "<regNo>-Invitation.pdf" filename', () => {
    expect(invitationPdfFilename('MDF26-0042')).toBe('MDF26-0042-Invitation.pdf');
  });
});

describe('renderInvitationPdf', () => {
  it('renders one QR page per registered guest (Guest X of N labels)', async () => {
    const qrPngBytes = await renderQrPng(buildQrUrl('https://events.sansmi.org', generateQrToken()));
    const pdfBytes = await renderInvitationPdf({
      eventName: 'myDharma Fest 2026',
      participantName: 'Example Participant',
      registrationNo: 'MDF26-0042',
      registeredCount: 3,
      eventDateLabel: '2026-09-12',
      venue: 'Main Hall',
      instructions: 'Please arrive 30 minutes early.',
      qrPngBytes,
    });

    expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('utf8')).toBe('%PDF-');
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('renders a single page (no "Guest X of N" label) for a single-guest registration', async () => {
    const qrPngBytes = await renderQrPng(buildQrUrl('https://events.sansmi.org', generateQrToken()));
    const pdfBytes = await renderInvitationPdf({
      eventName: 'myDharma Fest 2026',
      participantName: 'Example Participant',
      registrationNo: 'MDF26-0043',
      registeredCount: 1,
      eventDateLabel: '2026-09-12',
      qrPngBytes,
    });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('renderInvitationEmail', () => {
  it('includes key participant/event details and the inline QR image', () => {
    const email = renderInvitationEmail({
      eventName: 'myDharma Fest 2026',
      participantName: 'Example Participant',
      registrationNo: 'MDF26-0042',
      registeredCount: 3,
      eventDateLabel: '2026-09-12',
      venue: 'Main Hall',
      instructions: 'Please arrive early.',
      qrDataUrl: 'data:image/png;base64,AAA',
    });

    expect(email.subject).toContain('MDF26-0042');
    expect(email.html).toContain('Example Participant');
    expect(email.html).toContain('MDF26-0042');
    expect(email.html).toContain('data:image/png;base64,AAA');
    expect(email.text).toContain('MDF26-0042');
    expect(email.text).toContain('Main Hall');
  });

  it('escapes HTML-significant characters in participant-controlled fields', () => {
    const email = renderInvitationEmail({
      eventName: 'Event <script>alert(1)</script>',
      participantName: '<b>Name</b>',
      registrationNo: 'MDF26-0001',
      registeredCount: 1,
      eventDateLabel: '2026-01-01',
      qrDataUrl: 'data:image/png;base64,AAA',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Name</b>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('retryDelayMs', () => {
  it('follows the Section 21 schedule: immediate, +1m, +5m, +30m', () => {
    expect(retryDelayMs(1)).toBe(0);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(300_000);
    expect(retryDelayMs(4)).toBe(1_800_000);
  });

  it('caps at the longest configured delay beyond the schedule', () => {
    expect(retryDelayMs(10)).toBe(1_800_000);
  });

  it('rejects non-positive attempt numbers', () => {
    expect(() => retryDelayMs(0)).toThrow();
    expect(() => retryDelayMs(-1)).toThrow();
  });
});
