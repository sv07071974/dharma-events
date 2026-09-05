import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiRequestError } from '../lib/api.js';
import { useAuth, hasRole } from '../lib/auth.js';
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge, Modal } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface EventSummary {
  id: string;
  eventCode: string;
  eventName: string;
  eventDate: string;
  status: string;
}

export function EventsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: () => apiGet<{ events: EventSummary[] }>('/api/v1/events'),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createEvent = useMutation({
    mutationFn: () => apiPost('/api/v1/events', { eventCode, eventName, eventDate }),
    onSuccess: () => {
      setEventCode('');
      setEventName('');
      setEventDate('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => setFormError(err instanceof ApiRequestError ? err.message : 'Failed to create event.'),
  });

  const allEvents = data?.events ?? [];
  const filteredEvents = search.trim()
    ? allEvents.filter(
        (e) =>
          e.eventName.toLowerCase().includes(search.trim().toLowerCase()) ||
          e.eventCode.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : allEvents;

  return (
    <main>
      <div className="page-header">
        <h1>Events</h1>
        {hasRole(user, 'EVENT_MANAGER') && (
          <button type="button" onClick={() => setShowCreate(true)}>
            + New Event
          </button>
        )}
      </div>

      {allEvents.length > 0 && (
        <div className="search-bar">
          <div className="field">
            <label htmlFor="eventSearch">Search events</label>
            <input
              id="eventSearch"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={4} />}

      {isError && <ErrorState message="Could not load events." onRetry={() => void refetch()} />}

      {!isLoading && !isError && allEvents.length === 0 && (
        <EmptyState
          title="No events yet."
          hint={hasRole(user, 'EVENT_MANAGER') ? 'Create your first event to get started.' : undefined}
        />
      )}

      {!isLoading && !isError && allEvents.length > 0 && filteredEvents.length === 0 && (
        <EmptyState title="No events match your search." />
      )}

      {!isLoading && !isError && filteredEvents.length > 0 && (
        <div className="table-wrap responsive-table">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Code</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr key={event.id}>
                  <td data-label="Event">
                    <Link to={`/events/${event.id}`}>{event.eventName}</Link>
                  </td>
                  <td data-label="Code">{event.eventCode}</td>
                  <td data-label="Date">{formatDate(event.eventDate)}</td>
                  <td data-label="Status">
                    <StatusBadge tone="primary">{event.status}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal
          title="Create Event"
          onClose={() => {
            setShowCreate(false);
            setFormError(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              createEvent.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="eventCode">Event code</label>
              <input id="eventCode" required value={eventCode} onChange={(e) => setEventCode(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="eventName">Event name</label>
              <input id="eventName" required value={eventName} onChange={(e) => setEventName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="eventDate">Event date</label>
              <input
                id="eventDate"
                type="date"
                required
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <span className="field__hint">Format: day/month/year (your browser's date picker)</span>
            </div>
            {formError && <p role="alert">{formError}</p>}
            <div className="form-actions">
              <button type="submit" disabled={createEvent.isPending}>
                {createEvent.isPending ? 'Creating…' : 'Create event'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

