/**
 * Friendly date/time formatting helpers (UI Modernization Spec Section
 * 5.2/8.2 - "raw event dates" / "display friendly dates"). Pure
 * presentation only - never used for anything sent back to the API, so
 * this cannot affect calculations, QR payloads, or report content.
 */

const dateFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Formats an ISO date/date-only string as e.g. "4 Sep 2026". Falls back to the raw input if unparseable. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

/** Formats an ISO timestamp as e.g. "4 Sep 2026, 3:45 PM". Falls back to the raw input if unparseable. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormatter.format(date);
}

/** Formats an ISO timestamp as just a time, e.g. "3:45 PM". Falls back to the raw input if unparseable. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return timeFormatter.format(date);
}
