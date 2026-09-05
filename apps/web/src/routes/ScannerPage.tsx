import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserQRCodeReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { apiGet, apiPost, ApiRequestError } from '../lib/api.js';
import { hasRole, useAuth } from '../lib/auth.js';
import { EmptyState } from '../components/ui.js';
import { formatTime } from '../lib/format.js';

interface ScannerRegistration {
  id: string;
  registrationNo: string;
  name: string;
  category: string;
  registeredCount: number;
  checkedInCount: number;
  remainingCount: number;
}

interface ValidateResponse {
  valid: boolean;
  reason?: string;
  message?: string;
  registration?: ScannerRegistration;
}

interface RecentCheckin {
  id: string;
  checkedInAt: string;
  attendeeCount: number;
  counterName: string | null;
  status: 'VALID' | 'OVERRIDE' | 'REVERSED';
  registration: { registrationNo: string; name: string };
}

interface SearchRegistration {
  id: string;
  registrationNo: string;
  name: string;
  registeredCount: number;
}

/** Extracts the raw QR token from either a full check-in URL or a bare token string (Section 13). */
function extractToken(scannedText: string): string {
  try {
    const url = new URL(scannedText);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? scannedText;
  } catch {
    return scannedText;
  }
}

/**
 * Scanner and check-in UI (REQUIREMENTS.md Sections 23-28 - Phase 5).
 * Camera access is requested only when the volunteer presses "Scan QR"
 * (Section 24); ZXing's `BrowserQRCodeReader` is used, preferring the rear
 * camera via `facingMode: 'environment'`.
 */
export function ScannerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canOverride = hasRole(user, 'SUPERVISOR');

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [active, setActive] = useState<ValidateResponse | null>(null);
  const [arrivingCount, setArrivingCount] = useState(1);
  const [counterName, setCounterName] = useState('');
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const { data: recentData, refetch: refetchRecent } = useQuery({
    queryKey: ['checkins-recent', eventId],
    queryFn: () => apiGet<{ checkins: RecentCheckin[] }>(`/api/v1/events/${eventId}/checkins/recent`),
    refetchInterval: 15_000,
  });

  const validateToken = useMutation({
    mutationFn: (token: string) => apiPost<ValidateResponse>(`/api/v1/events/${eventId}/qr/validate`, { token }),
    onSuccess: (result) => {
      setActive(result);
      setArrivingCount(result.registration ? result.registration.remainingCount : 0);
    },
  });

  async function stopScanning() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  async function startScanning() {
    setCameraError(null);
    setActive(null);
    setCheckinMessage(null);
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result) => {
          if (result) {
            // Pause the scanner after a successful detection (Section 24);
            // it only resumes when the volunteer explicitly scans again.
            controlsRef.current?.stop();
            controlsRef.current = null;
            setScanning(false);
            validateToken.mutate(extractToken(result.getText()));
          }
        },
      );
      controlsRef.current = controls;
    } catch (err) {
      setScanning(false);
      setCameraError(
        err instanceof Error
          ? `Camera unavailable: ${err.message}. Use manual search instead.`
          : 'Camera unavailable. Use manual search instead.',
      );
    }
  }

  useEffect(() => {
    return () => {
      void stopScanning();
    };
  }, []);

  // --- Manual search fallback (Section 28) ---
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchRegistration[]>([]);

  async function runSearch() {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    const result = await apiGet<{ registrations: SearchRegistration[] }>(
      `/api/v1/events/${eventId}/registrations/search?q=${encodeURIComponent(searchTerm)}`,
    );
    setSearchResults(result.registrations);
  }

  const openManual = useMutation({
    mutationFn: (registrationId: string) =>
      apiGet<{ registration: ScannerRegistration }>(`/api/v1/registrations/${registrationId}/checkin-status`),
    onSuccess: (result) => {
      setActive({ valid: true, registration: result.registration });
      setArrivingCount(result.registration.remainingCount);
      setCheckinMessage(null);
    },
  });

  const checkIn = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/events/${eventId}/checkins`, {
        registrationId: active!.registration!.id,
        attendeeCount: arrivingCount,
        counterName: counterName || undefined,
      }),
    onSuccess: () => {
      setActive(null);
      setCheckinMessage('Checked in successfully.');
      void refetchRecent();
      void queryClient.invalidateQueries({ queryKey: ['registrations', eventId] });
    },
  });

  /** Supervisor override of an over-check-in (Section 27/80). */
  const overrideCheckIn = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/events/${eventId}/checkins/override`, {
        registrationId: active!.registration!.id,
        attendeeCount: arrivingCount,
        counterName: counterName || undefined,
        reason: overrideReason,
      }),
    onSuccess: () => {
      setActive(null);
      setOverrideReason('');
      setCheckinMessage('Override check-in recorded.');
      void refetchRecent();
      void queryClient.invalidateQueries({ queryKey: ['registrations', eventId] });
    },
  });

  /** Supervisor reversal of a check-in (Section 80). */
  const reverseCheckin = useMutation({
    mutationFn: ({ checkinId, reason }: { checkinId: string; reason: string }) =>
      apiPost(`/api/v1/checkins/${checkinId}/reverse`, { reason }),
    onSuccess: () => {
      setReversingId(null);
      setReverseReason('');
      setCheckinMessage('Check-in reversed.');
      void refetchRecent();
      void queryClient.invalidateQueries({ queryKey: ['registrations', eventId] });
    },
  });

  function cancelActive() {
    setActive(null);
    setCheckinMessage(null);
    setOverrideReason('');
  }

  return (
    <main>
      <div className="page-header">
        <h1>Scanner</h1>
      </div>

      {/*
        The <video> element is always mounted (never conditionally rendered)
        so `videoRef.current` is already attached to a real DOM node the
        instant `startScanning` runs. Previously it was only rendered once
        `scanning` became true, but that state update is asynchronous - by
        the time `decodeFromConstraints` read `videoRef.current`, React
        hadn't re-rendered yet, so it received `null` and ZXing silently
        fell back to an invisible off-DOM video element (camera light turns
        on, but nothing is ever displayed or decoded from the visible UI).
      */}
      <div className="card" style={{ textAlign: 'center', display: scanning ? 'block' : 'none' }}>
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <button type="button" className="btn-secondary" onClick={stopScanning}>
          Cancel scan
        </button>
      </div>
      {!scanning && !active && (
        <div className="card" style={{ textAlign: 'center' }}>
          <button type="button" className="btn-scan" onClick={startScanning}>
            {'\u{1F4F7}'} SCAN QR
          </button>
          <p className="text-muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            Your browser will ask for camera permission the first time. Allow it to scan tickets, or use the manual
            search below if a camera is not available.
          </p>
        </div>
      )}
      {cameraError && <p role="alert">{cameraError}</p>}
      {checkinMessage && <p className="alert-success">{checkinMessage}</p>}

      {active && active.valid === false && (
        <div className="scan-result-card scan-result-card--invalid">
          <h2>Invalid registration</h2>
          <p>{active.message ?? 'This QR code could not be validated.'}</p>
          <button type="button" className="btn-secondary" onClick={cancelActive}>
            Dismiss
          </button>
        </div>
      )}

      {active && active.valid && active.registration && active.registration.remainingCount > 0 && (
        <div className="scan-result-card scan-result-card--valid">
          <h2>Valid registration</h2>
          <p style={{ fontWeight: 600 }}>
            {active.registration.registrationNo} — {active.registration.name}
          </p>
          <p className="text-muted">Category: {active.registration.category}</p>
          <p className="text-muted">
            Registered: {active.registration.registeredCount} · Already arrived: {active.registration.checkedInCount}{' '}
            · Remaining: {active.registration.remainingCount}
          </p>

          <div className="field">
            <label htmlFor="arrivingCount">Arriving now</label>
            <div className="counter-control">
              <button type="button" className="btn-secondary btn-icon" onClick={() => setArrivingCount((c) => Math.max(0, c - 1))}>
                -
              </button>
              <input
                id="arrivingCount"
                type="number"
                value={arrivingCount}
                min={0}
                max={active.registration.remainingCount}
                onChange={(e) => setArrivingCount(Number(e.target.value))}
              />
              <button
                type="button"
                className="btn-secondary btn-icon"
                onClick={() => setArrivingCount((c) => Math.min(active.registration!.remainingCount, c + 1))}
              >
                +
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="counterName">Counter name (optional)</label>
            <input id="counterName" value={counterName} onChange={(e) => setCounterName(e.target.value)} />
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-lg"
              onClick={() => checkIn.mutate()}
              disabled={checkIn.isPending || arrivingCount <= 0}
            >
              {checkIn.isPending ? 'Checking in…' : 'CHECK IN'}
            </button>
            <button type="button" className="btn-secondary" onClick={cancelActive}>
              Cancel
            </button>
          </div>
          {checkIn.isError && (
            <p role="alert">{checkIn.error instanceof ApiRequestError ? checkIn.error.message : 'Check-in failed.'}</p>
          )}
        </div>
      )}

      {active && active.valid && active.registration && active.registration.remainingCount <= 0 && (
        <div className="scan-result-card scan-result-card--full">
          <h2>Already fully checked in</h2>
          <p style={{ fontWeight: 600 }}>Registration: {active.registration.registrationNo}</p>
          <p className="text-muted">
            Registered: {active.registration.registeredCount}, Checked in: {active.registration.checkedInCount}
          </p>
          {canOverride ? (
            <div>
              <div className="field">
                <label htmlFor="overrideArriving">Arriving now (override)</label>
                <input
                  id="overrideArriving"
                  type="number"
                  min={1}
                  value={arrivingCount}
                  onChange={(e) => setArrivingCount(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label htmlFor="overrideReason">Reason (required)</label>
                <input id="overrideReason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </div>
              <button
                type="button"
                className="btn-danger"
                onClick={() => overrideCheckIn.mutate()}
                disabled={overrideCheckIn.isPending || arrivingCount <= 0 || !overrideReason.trim()}
              >
                Override &amp; Check In
              </button>
              {overrideCheckIn.isError && (
                <p role="alert">
                  {overrideCheckIn.error instanceof ApiRequestError ? overrideCheckIn.error.message : 'Override failed.'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted">A supervisor override is required to check in additional attendees.</p>
          )}
          <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={cancelActive}>
            Dismiss
          </button>
        </div>
      )}

      <div className="card">
        <h2>Search Participant</h2>
        <div className="search-bar">
          <div className="field">
            <label htmlFor="scannerSearch">Name / Phone / Reg ID</label>
            <input
              id="scannerSearch"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={runSearch}>
            Search
          </button>
        </div>
        {searchResults.length > 0 && (
          <ul className="plain-list">
            {searchResults.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {r.registrationNo} — {r.name} (Registered: {r.registeredCount})
                </span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => openManual.mutate(r.id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Recent Check-ins</h2>
        {(recentData?.checkins.length ?? 0) === 0 ? (
          <EmptyState title="No check-ins yet." />
        ) : (
          <ul className="plain-list">
            {recentData?.checkins.map((c) => (
              <li key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span>
                    {formatTime(c.checkedInAt)} — {c.registration.registrationNo} (
                    {c.registration.name}), {c.attendeeCount} arrived{c.counterName ? ` at ${c.counterName}` : ''}
                    {c.status === 'OVERRIDE' && <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>override</span>}
                  </span>
                  {canOverride && reversingId !== c.id && (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setReversingId(c.id)}>
                      Reverse
                    </button>
                  )}
                </div>
                {canOverride && reversingId === c.id && (
                  <div className="form-inline" style={{ marginTop: '0.5rem' }}>
                    <div className="field">
                      <label htmlFor={`reverseReason-${c.id}`}>Reason</label>
                      <input
                        id={`reverseReason-${c.id}`}
                        value={reverseReason}
                        onChange={(e) => setReverseReason(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={!reverseReason.trim() || reverseCheckin.isPending}
                      onClick={() => reverseCheckin.mutate({ checkinId: c.id, reason: reverseReason })}
                    >
                      Confirm reverse
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setReversingId(null);
                        setReverseReason('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {reverseCheckin.isError && (
          <p role="alert">
            {reverseCheckin.error instanceof ApiRequestError ? reverseCheckin.error.message : 'Reversal failed.'}
          </p>
        )}
      </div>
    </main>
  );
}
