// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CameraScanButton } from '../../src/client/index.js'
import { fakeCamera, fakeDetector, stubMedia } from './fakes.js'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement

beforeEach(() => stubMedia())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CameraScanButton', () => {
  it('opens a dialog, reads one code, closes, calls onResult once and returns focus', async () => {
    const { track } = fakeCamera()
    const { detector, view } = fakeDetector()
    const onResult = vi.fn()
    render(<CameraScanButton onResult={onResult} detector={detector} />)
    const opener = screen.getByRole('button', { name: 'Scan with camera' })
    fireEvent.click(opener)
    expect(dialog().hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.getByText(/Point the camera at a code/)).toBeTruthy())

    view.codes = ['QR-1', 'QR-2']
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    // Let a few more frames pass: still once.
    await new Promise((r) => setTimeout(r, 400))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('QR-1')
    expect(dialog().hasAttribute('open')).toBe(false)
    expect(track.stop).toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape and stops the camera', async () => {
    const { track } = fakeCamera()
    const onResult = vi.fn()
    render(<CameraScanButton onResult={onResult} detector={fakeDetector().detector} label="Camera" />)
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }))
    await waitFor(() => expect(screen.getByText(/Point the camera/)).toBeTruthy())
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(dialog().hasAttribute('open')).toBe(false)
    expect(track.stop).toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('shows a refused camera in the dialog', async () => {
    fakeCamera({ name: 'NotAllowedError' })
    render(<CameraScanButton onResult={vi.fn()} detector={fakeDetector().detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan with camera' }))
    await waitFor(() => expect(screen.getByRole('status', { hidden: true }).textContent).toBe('Camera access was refused.'))
    expect(dialog().hasAttribute('open')).toBe(true)
  })

  it('uses the native showModal and close where the browser has them', async () => {
    fakeCamera()
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
    Object.assign(HTMLDialogElement.prototype, { showModal, close })
    Object.defineProperty(HTMLDialogElement.prototype, 'open', {
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open')
      },
      configurable: true,
    })
    try {
      render(<CameraScanButton onResult={vi.fn()} detector={fakeDetector().detector} />)
      fireEvent.click(screen.getByRole('button', { name: 'Scan with camera' }))
      expect(showModal).toHaveBeenCalled()
      fireEvent(dialog(), new Event('cancel', { cancelable: true }))
      expect(close).toHaveBeenCalled()
    } finally {
      const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>
      delete proto.showModal
      delete proto.close
      delete proto.open
    }
  })

  it('stops the camera on unmount', async () => {
    const { track } = fakeCamera()
    const { unmount } = render(<CameraScanButton onResult={vi.fn()} detector={fakeDetector().detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan with camera' }))
    await waitFor(() => expect(screen.getByText(/Point the camera/)).toBeTruthy())
    unmount()
    expect(track.stop).toHaveBeenCalled()
  })
})
