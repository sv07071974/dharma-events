import { useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiGet, apiPatch, apiPost, apiDelete, ApiRequestError } from '../lib/api.js';
import { useAuth, hasRole } from '../lib/auth.js';
import { ConfirmDialog, EmptyState, LoadingSkeleton } from '../components/ui.js';

interface EventDetail {
  id: string;
  eventCode: string;
  eventName: string;
  eventDate: string;
  venue: string | null;
  status: string;
  registrationOpen: boolean;
  checkinOpen: boolean;
  inviteAttachmentFilename: string | null;
  inviteAttachmentSize: number | null;
}

interface CategorySummary {
  id: string;
  name: string;
  active: boolean;
  inviteAttachmentFilename: string | null;
  inviteAttachmentSize: number | null;
}

interface VolunteerSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  active: boolean;
}

/**
 * Per-category invite-template upload/view/remove control. Lets an event
 * manager give a specific category (e.g. "VIP") its own invite PDF, which
 * takes priority over the event's common attachment for registrations in
 * that category (falls back to the event's common one if not set here).
 */
function CategoryTemplateRow({
  eventId,
  category,
  canManage,
}: {
  eventId: string | undefined;
  category: CategorySummary;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch(`/api/v1/categories/${category.id}/invite-attachment`, { method: 'POST', body: form });
    },
    onSuccess: () => {
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['categories', eventId] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Failed to upload template.'),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/v1/categories/${category.id}/invite-attachment`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories', eventId] }),
  });

  if (!canManage && !category.inviteAttachmentFilename) {
    return null;
  }

  return (
    <div style={{ marginTop: '0.4rem', marginLeft: '1rem' }}>
      {category.inviteAttachmentFilename ? (
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          Template: {category.inviteAttachmentFilename}{' '}
          <a href={`/api/v1/categories/${category.id}/invite-attachment`} target="_blank" rel="noreferrer">
            View
          </a>
          {canManage && (
            <>
              {' · '}
              <button
                type="button"
                className="btn-sm btn-secondary"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove
              </button>
            </>
          )}
        </span>
      ) : (
        canManage && <span className="text-muted" style={{ fontSize: '0.85rem' }}>No category-specific template (uses event's common one).</span>
      )}
      {canManage && (
        <form
          className="form-inline"
          style={{ marginTop: '0.3rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            const file = fileInputRef.current?.files?.[0];
            if (!file) return;
            upload.mutate(file);
          }}
        >
          <input ref={fileInputRef} type="file" accept="application/pdf" required />
          <button type="submit" className="btn-sm btn-secondary" disabled={upload.isPending}>
            {category.inviteAttachmentFilename ? 'Replace template' : 'Upload template'}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = hasRole(user, 'EVENT_MANAGER');

  const { data: eventData } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetail }>(`/api/v1/events/${eventId}`),
  });
  const { data: categoryData } = useQuery({
    queryKey: ['categories', eventId],
    queryFn: () => apiGet<{ categories: CategorySummary[] }>(`/api/v1/events/${eventId}/categories`),
  });
  const { data: volunteerData } = useQuery({
    queryKey: ['volunteers', eventId],
    queryFn: () => apiGet<{ volunteers: VolunteerSummary[] }>(`/api/v1/events/${eventId}/volunteers`),
  });

  const [categoryName, setCategoryName] = useState('');

  const toggleFlag = useMutation({
    mutationFn: (patch: Partial<Pick<EventDetail, 'registrationOpen' | 'checkinOpen' | 'status'>>) =>
      apiPatch(`/api/v1/events/${eventId}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
  });

  const createCategory = useMutation({
    mutationFn: () => apiPost(`/api/v1/events/${eventId}/categories`, { name: categoryName }),
    onSuccess: () => {
      setCategoryName('');
      void queryClient.invalidateQueries({ queryKey: ['categories', eventId] });
    },
  });

  // --- Volunteers ---
  const [volunteerName, setVolunteerName] = useState('');
  const [volunteerEmail, setVolunteerEmail] = useState('');
  const [volunteerPhone, setVolunteerPhone] = useState('');
  const [volunteerRole, setVolunteerRole] = useState('');
  const [volunteerError, setVolunteerError] = useState<string | null>(null);

  const createVolunteer = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/events/${eventId}/volunteers`, {
        name: volunteerName,
        email: volunteerEmail,
        phone: volunteerPhone || undefined,
        role: volunteerRole,
      }),
    onSuccess: () => {
      setVolunteerName('');
      setVolunteerEmail('');
      setVolunteerPhone('');
      setVolunteerRole('');
      setVolunteerError(null);
      void queryClient.invalidateQueries({ queryKey: ['volunteers', eventId] });
    },
    onError: (err) => setVolunteerError(err instanceof ApiRequestError ? err.message : 'Failed to add volunteer.'),
  });

  const removeVolunteer = useMutation({
    mutationFn: (volunteerId: string) => apiDelete(`/api/v1/volunteers/${volunteerId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['volunteers', eventId] }),
  });

  const [volunteerPendingDelete, setVolunteerPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const deleteVolunteer = useMutation({
    mutationFn: (volunteerId: string) => apiDelete(`/api/v1/volunteers/${volunteerId}?hard=true`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['volunteers', eventId] });
      setVolunteerPendingDelete(null);
    },
  });

  // --- Invite attachment PDF (upload / view / remove) ---
  const inviteFileInputRef = useRef<HTMLInputElement>(null);
  const [inviteAttachmentError, setInviteAttachmentError] = useState<string | null>(null);

  const uploadInviteAttachment = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch(`/api/v1/events/${eventId}/invite-attachment`, { method: 'POST', body: form });
    },
    onSuccess: () => {
      setInviteAttachmentError(null);
      if (inviteFileInputRef.current) inviteFileInputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
    onError: (err) =>
      setInviteAttachmentError(err instanceof ApiRequestError ? err.message : 'Failed to upload invite attachment.'),
  });

  const removeInviteAttachment = useMutation({
    mutationFn: () => apiDelete(`/api/v1/events/${eventId}/invite-attachment`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
  });

  // Plain VOLUNTEERs (event-day check-in staff) don't get an Overview tab
  // at all - see EventNav - so land them straight on Check-in instead of
  // showing a "no permission" page for a route they can't reach via nav.
  if (!hasRole(user, 'SUPERVISOR')) {
    return <Navigate to={`/events/${eventId}/scanner`} replace />;
  }

  const event = eventData?.event;
  if (!event) {
    return (
      <main>
        <LoadingSkeleton rows={4} />
      </main>
    );
  }

  return (
    <main>
      <div className="page-header">
        <div>
          <h1>{event.eventName}</h1>
          <div className="page-header__meta">
            {event.eventCode} · <span className="badge badge-primary">{event.status}</span>
          </div>
        </div>
      </div>

      {canManage && (
        <div className="card">
          <h2>Event Settings</h2>
          <div className="checkbox-row">
            <input
              id="registrationOpen"
              type="checkbox"
              checked={event.registrationOpen}
              onChange={(e) => toggleFlag.mutate({ registrationOpen: e.target.checked })}
            />
            <label htmlFor="registrationOpen">Registration open</label>
          </div>
          <div className="checkbox-row">
            <input
              id="checkinOpen"
              type="checkbox"
              checked={event.checkinOpen}
              onChange={(e) => toggleFlag.mutate({ checkinOpen: e.target.checked })}
            />
            <label htmlFor="checkinOpen">Check-in open</label>
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="eventStatus">Status</label>
            <select
              id="eventStatus"
              value={event.status}
              onChange={(e) => toggleFlag.mutate({ status: e.target.value as EventDetail['status'] })}
            >
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <h3>Invite attachment (PDF)</h3>
            <p className="text-muted" style={{ marginTop: 0 }}>
              Optional flyer/brochure/formal invite PDF. It gets appended after each participant's ticket page when
              invitation emails are sent.
            </p>
            {event.inviteAttachmentFilename ? (
              <div className="form-inline">
                <span>
                  {event.inviteAttachmentFilename}
                  {event.inviteAttachmentSize ? ` (${Math.round(event.inviteAttachmentSize / 1024)} KB)` : ''}
                </span>
                <a
                  href={`/api/v1/events/${eventId}/invite-attachment`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                >
                  View
                </a>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={removeInviteAttachment.isPending}
                  onClick={() => removeInviteAttachment.mutate()}
                >
                  Remove
                </button>
              </div>
            ) : (
              <EmptyState title="No invite attachment uploaded." hint="Upload a PDF flyer/brochure to attach to every invitation email." />
            )}
            <form
              className="form-inline"
              style={{ marginTop: '0.75rem' }}
              onSubmit={(e) => {
                e.preventDefault();
                const file = inviteFileInputRef.current?.files?.[0];
                if (!file) return;
                uploadInviteAttachment.mutate(file);
              }}
            >
              <input ref={inviteFileInputRef} type="file" accept="application/pdf" required />
              <button type="submit" className="btn-secondary" disabled={uploadInviteAttachment.isPending}>
                {event.inviteAttachmentFilename ? 'Replace' : 'Upload'}
              </button>
            </form>
            {inviteAttachmentError && <p role="alert">{inviteAttachmentError}</p>}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Categories</h2>
        {(categoryData?.categories.length ?? 0) === 0 ? (
          <EmptyState title="No categories yet." hint="Add a category below so registrations can be classified." />
        ) : (
          <ul className="plain-list">
            {categoryData?.categories.map((category) => (
              <li key={category.id}>
                {category.name} {!category.active && <span className="badge">inactive</span>}
                <CategoryTemplateRow eventId={eventId} category={category} canManage={canManage} />
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="form-inline"
            style={{ marginTop: '1rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              createCategory.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="categoryName">New category</label>
              <input
                id="categoryName"
                required
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
              />
            </div>
            <button type="submit" disabled={createCategory.isPending}>
              Add category
            </button>
            {createCategory.isError && (
              <p role="alert">
                {createCategory.error instanceof ApiRequestError ? createCategory.error.message : 'Failed to add category.'}
              </p>
            )}
          </form>
        )}
      </div>

      <div className="card">
        <h2>Volunteers</h2>
        {(volunteerData?.volunteers.length ?? 0) === 0 ? (
          <EmptyState title="No volunteers yet." hint="Add a volunteer below to credit them for registrations they bring in." />
        ) : (
          <ul className="plain-list">
            {volunteerData?.volunteers.map((volunteer) => (
              <li key={volunteer.id}>
                {volunteer.name} · {volunteer.role} ({volunteer.email})
                {!volunteer.active && <span className="badge">inactive</span>}
                {canManage && volunteer.active && (
                  <button
                    type="button"
                    className="btn-sm btn-secondary"
                    style={{ marginLeft: '0.5rem' }}
                    disabled={removeVolunteer.isPending}
                    onClick={() => removeVolunteer.mutate(volunteer.id)}
                    title="Deactivate - keeps past registrations/check-ins attributed to them"
                  >
                    Deactivate
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    style={{ marginLeft: '0.5rem' }}
                    disabled={deleteVolunteer.isPending}
                    title="Permanently delete - registrations they brought stay, just lose the volunteer credit"
                    onClick={() => setVolunteerPendingDelete({ id: volunteer.id, name: volunteer.name })}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {volunteerPendingDelete && (
          <ConfirmDialog
            title="Delete volunteer"
            message={`Permanently delete ${volunteerPendingDelete.name}? This cannot be undone. Their past registrations stay, just without volunteer credit.`}
            confirmLabel="Delete"
            tone="danger"
            isPending={deleteVolunteer.isPending}
            onConfirm={() => deleteVolunteer.mutate(volunteerPendingDelete.id)}
            onCancel={() => setVolunteerPendingDelete(null)}
          />
        )}
        {canManage && (
          <form
            className="form-inline"
            style={{ marginTop: '1rem', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              createVolunteer.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="volunteerName">Name</label>
              <input
                id="volunteerName"
                required
                value={volunteerName}
                onChange={(e) => setVolunteerName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="volunteerEmail">Email</label>
              <input
                id="volunteerEmail"
                type="email"
                required
                value={volunteerEmail}
                onChange={(e) => setVolunteerEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="volunteerPhone">Phone (optional)</label>
              <input id="volunteerPhone" value={volunteerPhone} onChange={(e) => setVolunteerPhone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="volunteerRole">Role/duty</label>
              <input
                id="volunteerRole"
                required
                value={volunteerRole}
                onChange={(e) => setVolunteerRole(e.target.value)}
              />
            </div>
            <button type="submit" disabled={createVolunteer.isPending}>
              Add volunteer
            </button>
            {volunteerError && <p role="alert">{volunteerError}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
