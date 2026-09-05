import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiRequestError } from '../lib/api.js';
import { ConfirmDialog, EmptyState, ErrorState, LoadingSkeleton, StatusBadge, SummaryCard } from '../components/ui.js';

interface Registration {
  id: string;
  registrationNo: string;
  name: string;
  categoryId: string;
  invitationStatus: 'NOT_SENT' | 'PENDING' | 'SENT' | 'FAILED';
}

interface InvitationsSummary {
  summary: { total: number; ready: number; pending: number; sent: number; failed: number };
  registrations: Registration[];
}

interface CategorySummary {
  id: string;
  inviteAttachmentFilename: string | null;
}

interface EventSummary {
  inviteAttachmentFilename: string | null;
}

/** REQUIREMENTS.md Section 18 - Invitation Workflow admin screen. */
export function InvitationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['invitations', eventId],
    queryFn: () => apiGet<InvitationsSummary>(`/api/v1/events/${eventId}/invitations`),
  });
  // Category/event attachment flags - used only to show a "has attachment" indicator per
  // row (UI Modernization Spec Phase 2 "invitation preview improvements"). No new API: both
  // endpoints already exist and already return these fields.
  const { data: categoryData } = useQuery({
    queryKey: ['categories', eventId],
    queryFn: () => apiGet<{ categories: CategorySummary[] }>(`/api/v1/events/${eventId}/categories`),
  });
  const { data: eventData } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventSummary }>(`/api/v1/events/${eventId}`),
  });
  const categoryAttachmentMap = new Map(
    categoryData?.categories.map((c) => [c.id, Boolean(c.inviteAttachmentFilename)]) ?? [],
  );
  const eventHasAttachment = Boolean(eventData?.event.inviteAttachmentFilename);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['invitations', eventId] });

  const [actionError, setActionError] = useState<string | null>(null);
  const onActionError = (err: unknown, fallback: string) =>
    setActionError(err instanceof ApiRequestError ? err.message : fallback);

  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [confirmResendId, setConfirmResendId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => apiPost(`/api/v1/events/${eventId}/invitations/generate`),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => onActionError(err, 'Failed to generate invitations. Check the event and try again.'),
  });
  const sendAllReady = useMutation({
    mutationFn: () => apiPost(`/api/v1/events/${eventId}/invitations/send`),
    onSuccess: () => {
      setActionError(null);
      setConfirmSendAll(false);
      invalidate();
    },
    onError: (err) => onActionError(err, 'Invitations could not be sent. Try again.'),
  });
  const resend = useMutation({
    mutationFn: (registrationId: string) => apiPost(`/api/v1/registrations/${registrationId}/invitation/resend`),
    onSuccess: () => {
      setActionError(null);
      setConfirmResendId(null);
      invalidate();
    },
    onError: (err) => onActionError(err, 'Invitation could not be resent. Check the email address and try again.'),
  });

  const summary = data?.summary;
  const resendTarget = data?.registrations.find((r) => r.id === confirmResendId);

  return (
    <main>
      <div className="page-header">
        <h1>Invitations</h1>
        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? 'Generating…' : 'Generate Invitations'}
          </button>
          <button type="button" onClick={() => setConfirmSendAll(true)} disabled={sendAllReady.isPending}>
            {sendAllReady.isPending
              ? 'Sending…'
              : summary
                ? `Send All Ready (${summary.ready})`
                : 'Send All Ready'}
          </button>
        </div>
      </div>

      {actionError && <p role="alert">{actionError}</p>}

      {confirmSendAll && (
        <ConfirmDialog
          title="Send all ready invitations"
          message={`This will email ${summary?.ready ?? 0} invitation${summary?.ready === 1 ? '' : 's'} right now. Continue?`}
          confirmLabel="Send"
          isPending={sendAllReady.isPending}
          onConfirm={() => sendAllReady.mutate()}
          onCancel={() => setConfirmSendAll(false)}
        />
      )}

      {resendTarget && (
        <ConfirmDialog
          title="Resend invitation"
          message={`Resend the invitation email to ${resendTarget.name} (${resendTarget.registrationNo})?`}
          confirmLabel="Resend"
          isPending={resend.isPending}
          onConfirm={() => resend.mutate(resendTarget.id)}
          onCancel={() => setConfirmResendId(null)}
        />
      )}

      {summary && (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <SummaryCard value={summary.total} label="Total" />
          <SummaryCard value={summary.ready} label="Ready" />
          <SummaryCard value={summary.pending} label="Pending" />
          <SummaryCard value={summary.sent} label="Sent" />
          <SummaryCard value={summary.failed} label="Failed" />
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={4} />}

      {isError && <ErrorState message="Could not load invitations." onRetry={() => void refetch()} />}

      {!isLoading && !isError && (
        <div className="table-wrap responsive-table">
          <table>
            <thead>
              <tr>
                <th>Reg #</th>
                <th>Name</th>
                <th>Status</th>
                <th>Preview</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.registrations.map((r) => (
                <tr key={r.id}>
                  <td data-label="Reg #">{r.registrationNo}</td>
                  <td data-label="Name">{r.name}</td>
                  <td data-label="Status">
                    <StatusBadge
                      tone={
                        r.invitationStatus === 'SENT'
                          ? 'success'
                          : r.invitationStatus === 'FAILED'
                            ? 'danger'
                            : r.invitationStatus === 'PENDING'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {r.invitationStatus}
                    </StatusBadge>
                  </td>
                  <td data-label="Preview">
                    <a href={`/api/v1/registrations/${r.id}/invitation/preview`} target="_blank" rel="noreferrer">
                      Preview PDF
                    </a>
                    {(categoryAttachmentMap.get(r.categoryId) || eventHasAttachment) && (
                      <span className="badge" title="An attachment will be included with this invitation">
                        📎 Attachment
                      </span>
                    )}
                  </td>
                  <td data-label="Action">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setConfirmResendId(r.id)}
                      disabled={resend.isPending}
                    >
                      {resend.isPending && confirmResendId === r.id ? 'Resending…' : 'Resend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.registrations.length ?? 0) === 0 && <EmptyState title="No registrations yet." />}
        </div>
      )}
    </main>
  );
}
