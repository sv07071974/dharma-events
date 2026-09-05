import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import { DetailRow, LoadingSkeleton, Modal, StatusBadge } from './ui.js';
import { formatDateTime } from '../lib/format.js';

interface RegistrationDetail {
  id: string;
  registrationNo: string;
  name: string;
  email: string;
  phone: string | null;
  registeredCount: number;
  invitationStatus: string;
  notes: string | null;
  createdAt: string;
}

interface CheckinStatus {
  category: string;
  checkedInCount: number;
  remainingCount: number;
}

/**
 * Read-only registration detail view (UI Modernization Spec Phase 2 -
 * "Registration detail view using existing APIs"). Deliberately view-only:
 * it reuses `GET /api/v1/registrations/:id` (already used by the edit-less
 * Registrations list) and the Scanner's `checkin-status` endpoint for
 * arrival counts - no new or write API is introduced, and no edit form is
 * offered here (registration edit/cancel/delete is explicitly Phase 3 in
 * the spec).
 */
export function RegistrationDetailModal({
  registrationId,
  onClose,
}: {
  registrationId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['registration-detail', registrationId],
    queryFn: () => apiGet<{ registration: RegistrationDetail }>(`/api/v1/registrations/${registrationId}`),
  });
  const { data: statusData } = useQuery({
    queryKey: ['registration-checkin-status', registrationId],
    queryFn: () => apiGet<{ registration: CheckinStatus }>(`/api/v1/registrations/${registrationId}/checkin-status`),
  });

  const registration = data?.registration;
  const status = statusData?.registration;

  return (
    <Modal title="Registration Detail" onClose={onClose}>
      {isLoading && <LoadingSkeleton rows={5} />}
      {registration && (
        <div>
          <DetailRow label="Reg #" value={registration.registrationNo} />
          <DetailRow label="Name" value={registration.name} />
          <DetailRow label="Email" value={registration.email} />
          <DetailRow label="Phone" value={registration.phone ?? '—'} />
          <DetailRow label="Category" value={status?.category ?? '—'} />
          <DetailRow label="Registered count" value={registration.registeredCount} />
          <DetailRow label="Checked in" value={status ? status.checkedInCount : '—'} />
          <DetailRow label="Remaining" value={status ? status.remainingCount : '—'} />
          <DetailRow
            label="Invitation"
            value={
              <StatusBadge
                tone={
                  registration.invitationStatus === 'SENT'
                    ? 'success'
                    : registration.invitationStatus === 'FAILED'
                      ? 'danger'
                      : registration.invitationStatus === 'PENDING'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {registration.invitationStatus}
              </StatusBadge>
            }
          />
          <DetailRow label="Registered on" value={formatDateTime(registration.createdAt)} />
          {registration.notes && <DetailRow label="Notes" value={registration.notes} />}
        </div>
      )}
    </Modal>
  );
}
