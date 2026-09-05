import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './routes/LoginPage.js';
import { ProtectedLayout, RequireRole } from './routes/AppLayout.js';
import { EventsPage } from './routes/EventsPage.js';
import { EventDetailPage } from './routes/EventDetailPage.js';
import { RegistrationsPage } from './routes/RegistrationsPage.js';
import { InvitationsPage } from './routes/InvitationsPage.js';
import { ScannerPage } from './routes/ScannerPage.js';
import { DashboardPage } from './routes/DashboardPage.js';
import { ManageEventsPage } from './routes/ManageEventsPage.js';

/**
 * Root application shell (REQUIREMENTS.md Section 51 - Frontend Route
 * Structure). `/` redirects straight to `/events`, which itself renders
 * under `ProtectedLayout` and bounces to `/login` if the user has no
 * active session - there is no separate marketing/landing page.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/events" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/events" element={<EventsPage />} />
        <Route
          path="/admin/events"
          element={
            <RequireRole minimumRole="ADMIN">
              <ManageEventsPage />
            </RequireRole>
          }
        />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route
          path="/events/:eventId/registrations"
          element={
            <RequireRole minimumRole="SUPERVISOR">
              <RegistrationsPage />
            </RequireRole>
          }
        />
        <Route
          path="/events/:eventId/invitations"
          element={
            <RequireRole minimumRole="EVENT_MANAGER">
              <InvitationsPage />
            </RequireRole>
          }
        />
        <Route path="/events/:eventId/scanner" element={<ScannerPage />} />
        <Route
          path="/events/:eventId/dashboard"
          element={
            <RequireRole minimumRole="SUPERVISOR">
              <DashboardPage />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
