import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthForm } from './account'

// The mock factory is hoisted above imports, so it must not reference any
// top-level binding — resolve values inline.
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      login: vi.fn(),
      register: vi.fn(),
    },
  }
})

function renderWithClient(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

function fillCredentials(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('a-z, 0-9, - and _'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByPlaceholderText('at least 8 characters'), {
    target: { value: password },
  })
}

describe('AuthForm', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('logs in with the trimmed username', async () => {
    const { api } = await import('../lib/api')
    ;(api.login as ReturnType<typeof vi.fn>).mockResolvedValue({
      user_id: 'u1',
      username: 'sean',
      token: 'aa'.repeat(32),
    })
    renderWithClient(<AuthForm />)

    fillCredentials('  sean ', 'hunter2hunter2')
    fireEvent.click(screen.getByText('Log in'))

    await vi.waitFor(() => {
      expect(api.login).toHaveBeenCalledWith('sean', 'hunter2hunter2')
    })
  })

  it('surfaces the server message when registration hits a taken username', async () => {
    const { api } = await import('../lib/api')
    ;(api.register as ReturnType<typeof vi.fn>).mockRejectedValue({
      kind: 'server',
      status: 409,
      code: 'username_taken',
      message: 'that username is taken',
    })
    renderWithClient(<AuthForm />)

    fillCredentials('sean', 'hunter2hunter2')
    fireEvent.click(screen.getByText('Create account'))

    expect(await screen.findByText('that username is taken')).toBeTruthy()
  })

  it('disables both actions until credentials are present', () => {
    renderWithClient(<AuthForm />)
    expect((screen.getByText('Log in') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Create account') as HTMLButtonElement).disabled).toBe(true)
  })
})
