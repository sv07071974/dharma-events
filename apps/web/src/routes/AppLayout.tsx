import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, hasRole, type CurrentUser } from '../lib/auth.js';
import { apiGet } from '../lib/api.js';
import { EventNav } from '../components/EventNav.js';
import { StatusBadge } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface EventSummary {
  id: string;
  eventName: string;
  eventDate: string;
  status: string;
}

/**
 * Wraps every authenticated route. Redirects to `/login` when the session
 * check resolves to "no user" (server is still the source of truth - this
 * is a UX convenience only, per Section 35: "Never rely on hidden frontend
 * buttons for security").
 */
export function ProtectedLayout() {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const eventId = location.pathname.match(/^\/events\/([^/]+)/)?.[1];

  const { data: eventData } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventSummary }>(`/api/v1/events/${eventId}`),
    enabled: Boolean(eventId),
  });

  if (isLoading) {
    return (
      <main>
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const event = eventData?.event;

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/events" className="app-nav__brand">
          Dharma Events
        </NavLink>
        <NavLink to="/events" className={({ isActive }) => (isActive ? 'active' : '')}>
          Events
        </NavLink>
        {hasRole(user, 'ADMIN') && (
          <NavLink to="/admin/events" className={({ isActive }) => (isActive ? 'active' : '')}>
            Manage Events
          </NavLink>
        )}
        {event && (
          <div className="app-nav__event" title={`${event.eventName} · ${formatDate(event.eventDate)}`}>
            <span className="app-nav__event-name">{event.eventName}</span>
            <span className="text-muted app-nav__event-date">{formatDate(event.eventDate)}</span>
            <StatusBadge tone="primary">{event.status}</StatusBadge>
          </div>
        )}
        <div className="app-nav__user">
          <span>
            {user.name} ({user.role})
          </span>
          <button type="button" className="btn-secondary btn-sm" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </nav>
      {eventId && <EventNav eventId={eventId} user={user} />}
      <div className={eventId ? 'app-shell__content app-shell__content--with-event-nav' : 'app-shell__content'}>
        <Outlet />
      </div>
    </div>
  );
}

/** Hides a route's contents (and shows a permission message) below `minimumRole`. */
export function RequireRole({ minimumRole, children }: { minimumRole: CurrentUser['role']; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasRole(user, minimumRole)) {
    return (
      <main>
        <p className="text-muted">You do not have permission to view this page.</p>
      </main>
    );
  }
  return <>{children}</>;
}
