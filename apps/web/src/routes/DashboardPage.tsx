import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import { EmptyState, LoadingSkeleton, SummaryCard } from '../components/ui.js';
import { formatTime } from '../lib/format.js';

interface DashboardSummary {
  totalRegistrations: number;
  totalCapacity: number;
  totalArrived: number;
  remaining: number;
  attendancePercentage: number;
  fullyCheckedIn: number;
  partiallyCheckedIn: number;
  notArrived: number;
}

interface CategoryBreakdown {
  categoryId: string;
  name: string;
  registered: number;
  arrived: number;
}

interface VolunteerBreakdown {
  userId: string;
  name: string;
  checkedInCount: number;
  checkinTransactions: number;
}

interface TimelineBucket {
  hour: string;
  attendeeCount: number;
}

interface RecentCheckin {
  id: string;
  checkedInAt: string;
  attendeeCount: number;
  counterName: string | null;
  status: string;
  checkedBy: string;
  registration: { registrationNo: string; name: string };
}

const REPORTS: { path: string; label: string; description: string }[] = [
  { path: 'attendance', label: 'Attendance', description: 'Everyone checked in so far, with counts and timestamps.' },
  { path: 'no-show', label: 'No-show', description: 'Registered guests who have not checked in yet.' },
  { path: 'checkins', label: 'Check-in transactions', description: 'Full log of every check-in/reverse action.' },
  { path: 'invitations', label: 'Invitation delivery', description: 'Send status for every generated invitation.' },
];

/**
 * Operational dashboard (REQUIREMENTS.md Sections 29-31, 48 - Phase 7).
 * Polls every 5 seconds per Section 31 ("Use polling every 5 seconds. Do
 * not introduce WebSockets unless necessary").
 */
export function DashboardPage() {
  const { eventId } = useParams<{ eventId: string }>();

  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary', eventId],
    queryFn: () => apiGet<DashboardSummary>(`/api/v1/events/${eventId}/dashboard/summary`),
    refetchInterval: 5_000,
  });
  const { data: categoryData } = useQuery({
    queryKey: ['dashboard-categories', eventId],
    queryFn: () => apiGet<{ categories: CategoryBreakdown[] }>(`/api/v1/events/${eventId}/dashboard/categories`),
    refetchInterval: 5_000,
  });
  const { data: volunteerData } = useQuery({
    queryKey: ['dashboard-volunteers', eventId],
    queryFn: () => apiGet<{ volunteers: VolunteerBreakdown[] }>(`/api/v1/events/${eventId}/dashboard/volunteers`),
    refetchInterval: 5_000,
  });
  const { data: timelineData } = useQuery({
    queryKey: ['dashboard-timeline', eventId],
    queryFn: () => apiGet<{ timeline: TimelineBucket[] }>(`/api/v1/events/${eventId}/dashboard/timeline`),
    refetchInterval: 5_000,
  });
  const { data: recentData } = useQuery({
    queryKey: ['dashboard-recent', eventId],
    queryFn: () => apiGet<{ checkins: RecentCheckin[] }>(`/api/v1/events/${eventId}/dashboard/recent`),
    refetchInterval: 5_000,
  });

  const maxTimelineCount = Math.max(1, ...(timelineData?.timeline.map((t) => t.attendeeCount) ?? [1]));

  return (
    <main>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      {!summary && <LoadingSkeleton rows={3} />}

      {summary && (
        <div className="card">
          <h2>Summary</h2>
          <div className="stat-grid">
            <SummaryCard value={summary.totalRegistrations} label="Registered" />
            <SummaryCard value={summary.totalCapacity} label="Capacity" />
            <SummaryCard value={summary.totalArrived} label="Arrived" />
            <SummaryCard value={summary.remaining} label="Remaining" />
            <SummaryCard value={`${summary.attendancePercentage}%`} label="Attendance" />
            <SummaryCard value={summary.fullyCheckedIn} label="Fully checked in" />
            <SummaryCard value={summary.partiallyCheckedIn} label="Partially checked in" />
            <SummaryCard value={summary.notArrived} label="Not arrived" />
          </div>
        </div>
      )}

      <div className="card">
        <h2>By Category</h2>
        {(categoryData?.categories.length ?? 0) === 0 ? (
          <EmptyState title="No data yet." />
        ) : (
          <ul className="plain-list">
            {categoryData?.categories.map((c) => (
              <li key={c.categoryId}>
                {c.name}: {c.arrived} / {c.registered}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>By Volunteer</h2>
        {(volunteerData?.volunteers.length ?? 0) === 0 ? (
          <EmptyState title="No data yet." />
        ) : (
          <ul className="plain-list">
            {volunteerData?.volunteers.map((v) => (
              <li key={v.userId}>
                {v.name}: {v.checkedInCount} ({v.checkinTransactions} check-ins)
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Arrival Timeline</h2>
        {(timelineData?.timeline.length ?? 0) === 0 ? (
          <EmptyState title="No data yet." />
        ) : (
          <div>
            {timelineData?.timeline.map((t) => (
              <div className="timeline-row" key={t.hour}>
                <span className="timeline-row__label">
                  {formatTime(t.hour)}
                </span>
                <span className="timeline-row__bar-track">
                  <span
                    className="timeline-row__bar-fill"
                    style={{ width: `${Math.round((t.attendeeCount / maxTimelineCount) * 100)}%` }}
                  />
                </span>
                <span className="timeline-row__value">{t.attendeeCount}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recent Check-Ins</h2>
        {(recentData?.checkins.length ?? 0) === 0 ? (
          <EmptyState title="No check-ins yet." />
        ) : (
          <ul className="plain-list">
            {recentData?.checkins.map((c) => (
              <li key={c.id}>
                {formatTime(c.checkedInAt)} — {c.registration.registrationNo} (
                {c.registration.name}), {c.attendeeCount} by {c.checkedBy}
                {c.counterName ? ` at ${c.counterName}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Reports</h2>
        <div className="report-grid">
          {REPORTS.map((r) => (
            <div className="report-card" key={r.path}>
              <h3>{r.label}</h3>
              <p>{r.description}</p>
              <div className="report-card__actions">
                <a className="btn btn-secondary btn-sm" href={`/api/v1/events/${eventId}/reports/${r.path}?format=csv`}>
                  CSV
                </a>
                <a className="btn btn-secondary btn-sm" href={`/api/v1/events/${eventId}/reports/${r.path}?format=xlsx`}>
                  XLSX
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
