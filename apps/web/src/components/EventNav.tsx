import { NavLink } from 'react-router-dom';
import { hasRole, type CurrentUser } from '../lib/auth.js';

const EVENT_TABS: {
  to: (id: string) => string;
  label: string;
  icon: string;
  end?: boolean;
  minimumRole?: CurrentUser['role'];
}[] = [
  { to: (id) => `/events/${id}`, label: 'Overview', icon: '\u{1F3E0}', end: true, minimumRole: 'SUPERVISOR' },
  {
    to: (id) => `/events/${id}/registrations`,
    label: 'Registrations',
    icon: '\u{1F465}',
    minimumRole: 'SUPERVISOR',
  },
  {
    to: (id) => `/events/${id}/invitations`,
    label: 'Invitations',
    icon: '\u{2709}\u{FE0F}',
    minimumRole: 'EVENT_MANAGER',
  },
  { to: (id) => `/events/${id}/scanner`, label: 'Check-in', icon: '\u{1F4F7}' },
  { to: (id) => `/events/${id}/dashboard`, label: 'Dashboard', icon: '\u{1F4CA}', minimumRole: 'SUPERVISOR' },
];

/**
 * Persistent event-scoped navigation (UI Modernization Spec Section 6.1 -
 * "consistent application shell"). Rendered once by `ProtectedLayout` so
 * every event-scoped page (Overview/Registrations/Invitations/Scanner/
 * Dashboard) shares the same tabs instead of each page inventing its own
 * "back to event" link. Shown as a horizontal tab strip on desktop and a
 * fixed bottom bar on mobile/tablet (CSS media queries in styles.css swap
 * between `.event-nav--top` and `.event-nav--bottom` presentation).
 *
 * Tabs are filtered by role so a plain VOLUNTEER (event-day check-in
 * staff) sees only Check-in - matching the backend's own role
 * requirements for these routes/endpoints, so this is UX convenience,
 * not the actual access boundary (Section 35).
 */
export function EventNav({ eventId, user }: { eventId: string; user: CurrentUser | null }) {
  const tabs = EVENT_TABS.filter((tab) => !tab.minimumRole || hasRole(user, tab.minimumRole));

  return (
    <nav className="event-nav" aria-label="Event sections">
      {tabs.map((tab) => (
        <NavLink
          key={tab.label}
          to={tab.to(eventId)}
          end={tab.end}
          className={({ isActive }) => `event-nav__item${isActive ? ' active' : ''}`}
        >
          <span className="event-nav__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="event-nav__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
