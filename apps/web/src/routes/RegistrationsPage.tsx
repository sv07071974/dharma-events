import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiRequestError } from '../lib/api.js';
import { useAuth, hasRole } from '../lib/auth.js';
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from '../components/ui.js';
import { RegistrationDetailModal } from '../components/RegistrationDetailModal.js';

interface Registration {
  id: string;
  registrationNo: string;
  name: string;
  email: string;
  phone: string | null;
  registeredCount: number;
  categoryId: string;
  invitationStatus: string;
}

interface CategorySummary {
  id: string;
  name: string;
}

interface VolunteerOption {
  id: string;
  name: string;
  active: boolean;
}

const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+1', label: 'USA/Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+60', label: 'Malaysia (+60)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+968', label: 'Oman (+968)' },
  { code: '+973', label: 'Bahrain (+973)' },
  { code: '+965', label: 'Kuwait (+965)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+977', label: 'Nepal (+977)' },
  { code: '+64', label: 'New Zealand (+64)' },
];

interface PreviewRow {
  rowNumber: number;
  status: 'VALID' | 'WARNING' | 'ERROR';
  name: string;
  email: string;
  errors: string[];
  warnings: string[];
}

interface PreviewResult {
  totalRows: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  detectedMapping: Record<string, string>;
  rows: PreviewRow[];
}

export function RegistrationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = hasRole(user, 'EVENT_MANAGER');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['registrations', eventId],
    queryFn: () => apiGet<{ registrations: Registration[] }>(`/api/v1/events/${eventId}/registrations`),
  });
  const { data: categoryData } = useQuery({
    queryKey: ['categories', eventId],
    queryFn: () => apiGet<{ categories: CategorySummary[] }>(`/api/v1/events/${eventId}/categories`),
  });
  const { data: volunteerData } = useQuery({
    queryKey: ['volunteers', eventId],
    queryFn: () => apiGet<{ volunteers: VolunteerOption[] }>(`/api/v1/events/${eventId}/volunteers`),
  });

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Registration[] | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  async function runSearch() {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const result = await apiGet<{ registrations: Registration[] }>(
      `/api/v1/events/${eventId}/registrations/search?q=${encodeURIComponent(search)}`,
    );
    setSearchResults(result.registrations);
  }

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [registeredCount, setRegisteredCount] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const [volunteerId, setVolunteerId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createRegistration = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/events/${eventId}/registrations`, {
        name,
        email,
        phone: phoneNumber.trim() ? `${countryCode} ${phoneNumber.trim()}` : undefined,
        registeredCount: Number(registeredCount),
        categoryId,
        volunteerId: volunteerId || undefined,
      }),
    onSuccess: () => {
      setName('');
      setEmail('');
      setPhoneNumber('');
      setRegisteredCount('1');
      setVolunteerId('');
      void queryClient.invalidateQueries({ queryKey: ['registrations', eventId] });
    },
    onError: (err) => setFormError(err instanceof ApiRequestError ? err.message : 'Failed to create registration.'),
  });

  // --- Import flow (Sections 15-17): upload -> preview -> commit. ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ importedCount: number; skippedErrorCount: number } | null>(null);

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    setImportError(null);
    setImportResult(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(`/api/v1/events/${eventId}/import/preview`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body = (await response.json()) as { success: boolean; data?: PreviewResult; error?: { message: string } };
      if (!body.success || !body.data) {
        setImportError(body.error?.message ?? 'Preview failed.');
        return;
      }
      setPreview(body.data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Preview failed.');
    }
  }

  async function handleCommit() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(`/api/v1/events/${eventId}/import/commit`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body = (await response.json()) as {
        success: boolean;
        data?: { importedCount: number; skippedErrorCount: number };
        error?: { message: string };
      };
      if (!body.success || !body.data) {
        setImportError(body.error?.message ?? 'Import failed.');
        return;
      }
      setImportResult(body.data);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['registrations', eventId] });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  const displayedRegistrations = searchResults ?? data?.registrations ?? [];

  return (
    <main>
      <div className="page-header">
        <h1>Registrations</h1>
      </div>

      <div className="search-bar">
        <div className="field">
          <label htmlFor="regSearch">Search (name / email / phone / reg #)</label>
          <input
            id="regSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
        </div>
        <button type="button" className="btn-secondary" onClick={runSearch}>
          Search
        </button>
      </div>

      {isLoading && <LoadingSkeleton rows={4} />}

      {isError && <ErrorState message="Could not load registrations." onRetry={() => void refetch()} />}

      {!isLoading && !isError && (
        <div className="table-wrap responsive-table">
          <table>
            <thead>
              <tr>
                <th>Reg #</th>
                <th>Name</th>
                <th>Email</th>
                <th>Count</th>
                <th>Invitation</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {displayedRegistrations.map((r) => (
                <tr key={r.id}>
                  <td data-label="Reg #">{r.registrationNo}</td>
                  <td data-label="Name">{r.name}</td>
                  <td data-label="Email">{r.email}</td>
                  <td data-label="Count">{r.registeredCount}</td>
                  <td data-label="Invitation">
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
                  <td data-label="">
                    <button type="button" className="btn-secondary" onClick={() => setViewingId(r.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayedRegistrations.length === 0 && (
            <EmptyState
              title={searchResults ? 'No registrations match your search.' : 'No registrations yet.'}
            />
          )}
        </div>
      )}

      {viewingId && <RegistrationDetailModal registrationId={viewingId} onClose={() => setViewingId(null)} />}


      {canManage && (
        <>
          <div className="card">
            <h2>Add Registration</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setFormError(null);
                createRegistration.mutate();
              }}
            >
              <div className="field">
                <label htmlFor="regName">Name</label>
                <input id="regName" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="regEmail">Email</label>
                <input id="regEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="regPhone">Mobile number (optional)</label>
                <div className="form-inline" style={{ gap: '0.5rem' }}>
                  <select
                    id="regCountryCode"
                    aria-label="Country code"
                    style={{ maxWidth: 180 }}
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    id="regPhone"
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="regCount">Attendee count</label>
                <input
                  id="regCount"
                  type="number"
                  min={1}
                  required
                  value={registeredCount}
                  onChange={(e) => setRegisteredCount(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="regCategory">Category</label>
                <select id="regCategory" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select…</option>
                  {categoryData?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="regVolunteer">Volunteer (optional)</label>
                <select id="regVolunteer" value={volunteerId} onChange={(e) => setVolunteerId(e.target.value)}>
                  <option value="">None</option>
                  {volunteerData?.volunteers
                    .filter((v) => v.active)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              </div>
              {formError && <p role="alert">{formError}</p>}
              <button type="submit" disabled={createRegistration.isPending}>
                Add registration
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Import (.xlsx / .csv)</h2>
            <div className="stepper">
              <span className="stepper__step done">
                <span className="stepper__number">1</span> Download template
              </span>
              <span className={`stepper__step ${!preview && !importResult ? 'active' : 'done'}`}>
                <span className="stepper__number">2</span> Select file &amp; preview
              </span>
              <span className={`stepper__step ${preview ? 'active' : importResult ? 'done' : ''}`}>
                <span className="stepper__number">3</span> Review rows
              </span>
              <span className={`stepper__step ${importResult ? 'done' : ''}`}>
                <span className="stepper__number">4</span> Confirm import
              </span>
            </div>
            <p className="text-muted" style={{ marginTop: 0 }}>
              <a href={`/api/v1/events/${eventId}/import/template`}>Download blank template (.xlsx)</a> — fill it in
              and upload it below.
            </p>
            <form className="form-inline" onSubmit={handlePreview}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" required />
              <button type="submit" className="btn-secondary">
                Preview
              </button>
            </form>
            {importError && <p role="alert">{importError}</p>}
            {preview && (
              <div style={{ marginTop: '1rem' }}>
                <p className="alert-info">
                  {preview.totalRows} rows detected — {preview.validCount} valid, {preview.warningCount} warnings,{' '}
                  {preview.errorCount} errors.
                </p>
                <ul className="plain-list">
                  {preview.rows
                    .filter((r) => r.status !== 'VALID')
                    .map((r) => (
                      <li key={r.rowNumber}>
                        <span className={`badge ${r.status === 'ERROR' ? 'badge-danger' : 'badge-warning'}`}>
                          Row {r.rowNumber} · {r.status}
                        </span>{' '}
                        {[...r.errors, ...r.warnings].join('; ')}
                      </li>
                    ))}
                </ul>
                <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                  <button type="button" onClick={handleCommit}>
                    Import valid rows
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {importResult && (
              <p className="alert-success" style={{ marginTop: '1rem' }}>
                Imported {importResult.importedCount} rows ({importResult.skippedErrorCount} skipped due to errors).
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
