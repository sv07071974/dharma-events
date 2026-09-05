/**
 * Generates a display-friendly registration number for an event.
 * See REQUIREMENTS.md Section 6 (System-Generated Registration Fields).
 *
 * Example: eventCode "MDF26", sequence 1 -> "MDF26-0001"
 */
export function formatRegistrationNumber(eventCode: string, sequence: number, padLength = 4): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error('sequence must be a positive integer');
  }
  return `${eventCode}-${String(sequence).padStart(padLength, '0')}`;
}
