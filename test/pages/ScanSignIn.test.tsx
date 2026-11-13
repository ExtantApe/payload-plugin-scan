// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ScanSignIn } from '../../src/pages/index.js'

describe('ScanSignIn', () => {
  it('keeps the link’s fragment as a fragment, never inside the query a server would see', async () => {
    window.history.replaceState(null, '', '/k/100000000001#s=made-up-secret')
    render(<ScanSignIn signInPath="/login" returnPath="/k/100000000001" />)
    const link = screen.getByRole('link', { name: 'Sign in' })
    await waitFor(() => expect(link.getAttribute('href')).toContain('#'))
    const url = new URL(link.getAttribute('href')!, 'https://site.example.com')
    expect(url.search).not.toContain('made-up-secret')
    expect(decodeURIComponent(url.search)).not.toContain('made-up-secret')
    expect(url.hash).toBe('#s=made-up-secret')
    expect(url.searchParams.get('redirect')).toBe('/k/100000000001')
  })
})
