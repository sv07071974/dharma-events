import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '../src/routes/DashboardPage.js';

function renderDashboardPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/events/event-1/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/dashboard/summary')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                totalRegistrations: 3,
                totalCapacity: 9,
                totalArrived: 5,
                remaining: 4,
                attendancePercentage: 55.6,
                fullyCheckedIn: 1,
                partiallyCheckedIn: 1,
                notArrived: 1,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/dashboard/categories')) {
          return new Response(JSON.stringify({ success: true, data: { categories: [] } }), { status: 200 });
        }
        if (url.includes('/dashboard/volunteers')) {
          return new Response(JSON.stringify({ success: true, data: { volunteers: [] } }), { status: 200 });
        }
        if (url.includes('/dashboard/timeline')) {
          return new Response(JSON.stringify({ success: true, data: { timeline: [] } }), { status: 200 });
        }
        if (url.includes('/dashboard/recent')) {
          return new Response(JSON.stringify({ success: true, data: { checkins: [] } }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('renders the summary and report export links', async () => {
    renderDashboardPage();
    expect(await screen.findByText('Registered')).toBeInTheDocument();
    const registeredCard = screen.getByText('Registered').closest('.stat-card');
    expect(registeredCard).not.toBeNull();
    expect(registeredCard).toHaveTextContent('3');
    expect(screen.getByText('55.6%')).toBeInTheDocument();
    expect(screen.getAllByText('CSV')).toHaveLength(4);
    expect(screen.getAllByText('XLSX')).toHaveLength(4);
  });
});
