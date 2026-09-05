import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, ApiRequestError } from '../lib/api.js';
import { EmptyState, ErrorState, LoadingSkeleton, Modal, StatusBadge } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface EventSummary {
  id: string;
  eventCode: string;
  eventName: string;
  eventDate: string;
  status: string;
}

/**
 * Admin-only cleanup tool (Phase 3, explicitly approved) - lists every
 * event (including archived ones, which are still returned by the plain
 * `GET /api/v1/events` list) and lets an ADMIN permanently delete test/
 * duplicate events before going live. Uses the existing `DELETE
 * /api/v1/events/:eventId?hard=true` endpoint (added alongside this
 * screen) which cascades to every dependent record (categories,
 * volunteers, registrations, check-ins, invitation jobs - all
 * `onDelete: Cascade` in schema.prisma) - irreversible, so deletion
 * requires typing the event's own code to confirm, not just a click.
 */
export function ManageEventsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: () => apiGet<{ events: EventSummary[] }>('/api/v1/events'),
  });

  const [pendingDelete, setPendingDelete] = useState<EventSummary | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteEvent = useMutation({
    mutationFn: (eventId: string) => apiDelete(`/api/v1/events/${eventId}?hard=true`),
    onSuccess: () => {
      setPendingDelete(null);
      setConfirmText('');
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) =>
      setDeleteError(err instanceof ApiRequestError ? err.message : 'Failed to delete this event.'),
  });

  const events = data?.events ?? [];

  return (
    <main>
      <div className="page-header">
        <h1>Manage Events</h1>
      </div>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Permanently delete test or duplicate events. This removes the event and everything tied to
        it - registrations, check-ins, invitations, categories, volunteers - and cannot be undone.
      </p>

      {isLoading && <LoadingSkeleton rows={4} />}
      {isError && <ErrorState message="Could not load events." onRetry={() => void refetch()} />}

      {!isLoading && !isError && events.length === 0 && <EmptyState title="No events yet." />}

      {!isLoading && !isError && events.length > 0 && (
        <div className="table-wrap responsive-table">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Code</th>
                <th>Date</th>
                <th>Status</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Event">{event.eventName}</td>
                  <td data-label="Code">{event.eventCode}</td>
                  <td data-label="Date">{formatDate(event.eventDate)}</td>
                  <td data-label="Status">
                    <StatusBadge tone="primary">{event.status}</StatusBadge>
                  </td>
                  <td data-label="">
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => {
                        setPendingDelete(event);
                        setConfirmText('');
                        setDeleteError(null);
                      }}
                    >
                      Delete permanently
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <Modal
          title="Delete event permanently"
          onClose={() => {
            setPendingDelete(null);
            setConfirmText('');
            setDeleteError(null);
          }}
        >
          <p>
            This will permanently delete <strong>{pendingDelete.eventName}</strong> ({pendingDelete.eventCode})
            and all of its registrations, check-ins, invitations, categories, and volunteers. This
            cannot be undone.
          </p>
          <div className="field">
            <label htmlFor="confirmEventCode">
              Type the event code (<strong>{pendingDelete.eventCode}</strong>) to confirm
            </label>
            <input
              id="confirmEventCode"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          {deleteError && <p role="alert">{deleteError}</p>}
          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn-danger"
              disabled={confirmText !== pendingDelete.eventCode || deleteEvent.isPending}
              onClick={() => deleteEvent.mutate(pendingDelete.id)}
            >
              {deleteEvent.isPending ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPendingDelete(null);
                setConfirmText('');
                setDeleteError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
