import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/lib/auth.js';
import { ProtectedLayout } from '../src/routes/AppLayout.js';

function renderProtected() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/events']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<p>Login page</p>} />
            <Route element={<ProtectedLayout />}>
              <Route path="/events" element={<p>Events page</p>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProtectedLayout', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/me') {
          return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'nope' } }), {
            status: 401,
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('redirects to /login when no session is active', async () => {
    renderProtected();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
