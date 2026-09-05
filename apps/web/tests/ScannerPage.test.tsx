import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/lib/auth.js';
import { ScannerPage } from '../src/routes/ScannerPage.js';

function renderScannerPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/events/event-1/scanner']}>
        <AuthProvider>
          <ScannerPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScannerPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/me') {
          return new Response(
            JSON.stringify({
              success: true,
              data: { user: { id: 'u1', email: 'volunteer@example.test', name: 'Volunteer', role: 'VOLUNTEER', active: true } },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/checkins/recent')) {
          return new Response(JSON.stringify({ success: true, data: { checkins: [] } }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('shows the SCAN QR button, search fallback and recent check-ins section', async () => {
    renderScannerPage();
    expect(screen.getByRole('button', { name: 'SCAN QR' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name / Phone / Reg ID')).toBeInTheDocument();
    expect(await screen.findByText('Recent Check-ins')).toBeInTheDocument();
  });
});

describe('ScannerPage (supervisor role)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/me') {
          return new Response(
            JSON.stringify({
              success: true,
              data: { user: { id: 'u2', email: 'supervisor@example.test', name: 'Supervisor', role: 'SUPERVISOR', active: true } },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/checkins/recent')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                checkins: [
                  {
                    id: 'c1',
                    checkedInAt: new Date().toISOString(),
                    attendeeCount: 2,
                    counterName: null,
                    status: 'VALID',
                    registration: { registrationNo: 'MDF26-0001', name: 'Jane Family' },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('shows a Reverse action on recent check-ins for a supervisor', async () => {
    renderScannerPage();
    expect(await screen.findByRole('button', { name: 'Reverse' })).toBeInTheDocument();
  });
});
