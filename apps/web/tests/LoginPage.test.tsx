import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/lib/auth.js';
import { LoginPage } from '../src/routes/LoginPage.js';

function renderLoginPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/me') {
          return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'nope' } }), {
            status: 401,
          });
        }
        if (url === '/api/v1/auth/login') {
          return new Response(
            JSON.stringify({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'The email or password you entered is incorrect.' } }),
            { status: 401 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('renders email/password fields and a submit button', async () => {
    renderLoginPage();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows an error message when login fails', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText('Email'), 'someone@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i);
    });
  });
});
