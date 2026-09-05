import QRCode from 'qrcode';

/**
 * Renders a QR code as a PNG buffer, suitable for inline embedding in email
 * (Section 8.5) or a PDF invitation attachment.
 */
export async function renderQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

/** Renders a QR code as a base64 data URL, for inline `<img>` use in HTML email. */
export async function renderQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}
