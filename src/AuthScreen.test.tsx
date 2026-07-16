import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));

vi.mock('./lib/storage', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { signInWithPassword, signUp: vi.fn() } },
  loadLocalState: vi.fn(),
  saveLocalState: vi.fn(),
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  deleteRemoteTransaction: vi.fn(),
  loadProfile: vi.fn(),
  saveProfile: vi.fn(),
  getSession: vi.fn()
}));

vi.mock('recharts', () => ({}));

import { AuthScreen } from './App';

describe('authentication form', () => {
  it('submits with the keyboard and shows loading and success feedback', async () => {
    const user = userEvent.setup();
    let resolveLogin!: (value: unknown) => void;
    signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    render(<AuthScreen />);

    await user.type(screen.getByLabelText('E-mail'), 'user@example.com');
    await user.type(screen.getByLabelText('Senha'), 'password123{Enter}');
    expect(screen.getByRole('button', { name: 'Aguarde...' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Entrando...');

    resolveLogin({ error: null, data: { session: {} } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Login realizado.'));
  });

  it('renders a friendly authentication error', async () => {
    const user = userEvent.setup();
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' }, data: {} });
    render(<AuthScreen />);
    await user.type(screen.getByLabelText('E-mail'), 'user@example.com');
    await user.type(screen.getByLabelText('Senha'), 'wrongpass{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent('E-mail ou senha inválidos');
  });
});
