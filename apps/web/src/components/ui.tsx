import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Shared presentation components (UI Modernization Spec Section 7.2 -
 * "Implement or standardize... rather than page-specific styling").
 * Deliberately dependency-free (no UI library) to avoid the bundle-size and
 * compatibility risk the spec explicitly warns against in Section 11.
 */

/** Skeleton placeholder for content still loading - avoids a jarring blank page or single "Loading…" line. */
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-block" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-line" key={i} style={{ width: i % 2 === 0 ? '100%' : '70%' }} />
      ))}
    </div>
  );
}

/** Friendly empty state with an optional call to action, replacing bare "No X yet." text. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

/** Actionable failure state with a retry button, per Section 12 ("actionable failure state"). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Small colored status pill. Never relies on color alone - always renders the label text too (Section 7.3). */
export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
  children: ReactNode;
}) {
  const toneClass = tone === 'neutral' ? '' : `badge-${tone}`;
  return <span className={`badge ${toneClass}`.trim()}>{children}</span>;
}

/** A single labelled number, used in dashboard/invitation summary grids. */
export function SummaryCard({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

/**
 * Lightweight centered modal dialog (Section 7.2 "Side panel/drawer").
 * Closes on backdrop click, Escape, or the explicit close button. Does not
 * trap focus exhaustively (no dependency added for it) but does move focus
 * to the dialog on open and restores it on close, and is marked up with
 * `role="dialog"`/`aria-modal` for assistive technology.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel once on mount only - NOT on every re-render. Re-running
  // this whenever `onClose` changes identity (e.g. an inline arrow function
  // in the caller, recreated on every parent render/keystroke) would steal
  // focus away from whatever form field the user is actively typing in.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Kept as a separate effect (re-registering a listener is harmless) so it
  // always calls the latest `onClose` without needing it in the focus effect above.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-panel__header">
          <h2>{title}</h2>
          <button type="button" className="btn-icon btn-secondary" aria-label="Close dialog" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-panel__body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Standardized "are you sure?" dialog (Phase 2 - Section 8.7/9.2 "Add
 * confirmation dialogs before... Send All Ready / Resend"). Built on top of
 * `Modal` so it inherits the same Escape/backdrop/focus behavior. The
 * confirm button is disabled while `isPending` so a slow action can't be
 * double-submitted by an impatient extra click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  isPending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="form-actions" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className={tone === 'danger' ? 'btn-danger' : ''}
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? 'Working…' : confirmLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** A label/value pair row used by read-only detail views (e.g. Registration Detail). */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <span className="detail-row__value">{value}</span>
    </div>
  );
}
