// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Scanner } from '../../src/client/index.js'
import { fakeCamera, fakeDetector, setOnline, stubMedia } from './fakes.js'

const ok = (message = 'Received') => vi.fn(async (_code: string) => ({ ok: true, message }))
const field = () => screen.getByLabelText('Type or scan a code') as HTMLInputElement
const type = (code: string, key = 'Enter') => {
  fireEvent.change(field(), { target: { value: code } })
  if (key === 'Enter') fireEvent.submit(field().form!)
  else fireEvent.keyDown(field(), { key })
}

beforeEach(() => {
  stubMedia()
  setOnline(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('typed and USB entry', () => {
  it('submits on Enter and clears the field', async () => {
    const onScan = ok()
    render(<Scanner onScan={onScan} />)
    type('TUBE-1')
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('TUBE-1'))
    expect(field().value).toBe('')
  })

  it('submits on Tab, and keeps focus in the field', async () => {
    const onScan = ok()
    render(<Scanner onScan={onScan} />)
    fireEvent.change(field(), { target: { value: 'TUBE-2' } })
    const notCanceled = fireEvent.keyDown(field(), { key: 'Tab' })
    expect(notCanceled).toBe(false)
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('TUBE-2'))
  })

  it('lets Tab move focus as usual when the field is empty', () => {
    render(<Scanner onScan={ok()} />)
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true)
  })

  it('uses custom terminators', async () => {
    const onScan = ok()
    render(<Scanner onScan={onScan} terminators={['F9']} />)
    fireEvent.change(field(), { target: { value: 'X' } })
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(field(), { key: 'Enter' })).toBe(false)
    fireEvent.keyDown(field(), { key: 'F9' })
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('X'))
    expect(onScan).toHaveBeenCalledTimes(1)
  })

  it('ignores blank entries', async () => {
    const onScan = ok()
    render(<Scanner onScan={onScan} />)
    type('   ')
    await act(async () => {})
    expect(onScan).not.toHaveBeenCalled()
  })
})

describe('results', () => {
  it('announces an accepted scan in words in a polite live region, and counts it', async () => {
    render(<Scanner onScan={ok('Tube 4 received')} />)
    type('T4')
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    await waitFor(() => expect(status.textContent).toBe('Accepted T4: Tube 4 received'))
    expect(screen.getByText('Accepted:').textContent).toContain('1')
  })

  it('shows a refusal as text and does not count it', async () => {
    render(<Scanner onScan={async () => ({ ok: false, message: 'Already packed' })} />)
    type('T5')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not accepted T5: Already packed'))
    expect(screen.getByText('Accepted:').textContent).toContain('0')
  })

  it('undoes the last accepted scan through onUndo', async () => {
    const onUndo = vi.fn(async () => {})
    render(<Scanner onScan={ok()} onUndo={onUndo} />)
    type('A')
    type('B')
    const undo = await screen.findByRole('button', { name: 'Undo B' })
    fireEvent.click(undo)
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith('B'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Undid B.'))
    expect(screen.getByText('Accepted:').textContent).toContain('1')
    expect(screen.getByRole('button', { name: 'Undo A' })).toBeTruthy()
  })

  it('offers no Undo without onUndo, so the count never claims an undo that did not happen', () => {
    render(<Scanner onScan={ok()} />)
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('gives every control a name and a 44px target', () => {
    render(<Scanner onScan={ok()} onUndo={() => {}} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).not.toBe('')
      expect(button.style.minHeight).toBe('44px')
    }
    expect(field().style.minHeight).toBe('44px')
  })
})

describe('camera', () => {
  it('asks for the rear camera only after "Use camera" is pressed', async () => {
    const { getUserMedia } = fakeCamera()
    const { detector } = fakeDetector()
    render(<Scanner onScan={ok()} detector={detector} />)
    expect(getUserMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    await screen.findByRole('button', { name: 'Stop camera' })
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false })
  })

  it('counts the same code once inside repeatMs, and again after it', async () => {
    fakeCamera()
    const { detector, view } = fakeDetector()
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const onScan = ok()
    render(<Scanner onScan={onScan} detector={detector} repeatMs={2500} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))

    view.codes = ['ABC']
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1))
    // Held in view, then out of view and back inside the window: still once.
    const calls = detector.detect.mock.calls.length
    await waitFor(() => expect(detector.detect.mock.calls.length).toBeGreaterThan(calls + 2))
    view.codes = []
    const out = detector.detect.mock.calls.length
    await waitFor(() => expect(detector.detect.mock.calls.length).toBeGreaterThan(out + 1))
    now += 1000
    view.codes = ['ABC']
    const back = detector.detect.mock.calls.length
    await waitFor(() => expect(detector.detect.mock.calls.length).toBeGreaterThan(back + 1))
    expect(onScan).toHaveBeenCalledTimes(1)

    // Out of view past the window: counts again.
    view.codes = []
    const out2 = detector.detect.mock.calls.length
    await waitFor(() => expect(detector.detect.mock.calls.length).toBeGreaterThan(out2 + 1))
    now += 2600
    view.codes = ['ABC']
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2))
  })

  it('falls back to typing with a plain message when the camera is refused', async () => {
    fakeCamera({ name: 'NotAllowedError' })
    const { detector } = fakeDetector()
    const onScan = ok()
    render(<Scanner onScan={onScan} detector={detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Camera access was refused. You can still type or scan codes into the box.',
      ),
    )
    expect(screen.getByRole('button', { name: 'Use camera' })).toBeTruthy()
    type('TYPED')
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('TYPED'))
  })

  it('says when there is no camera', async () => {
    fakeCamera({ name: 'NotFoundError' })
    render(<Scanner onScan={ok()} detector={fakeDetector().detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^No camera was found/))
  })

  it('says the camera cannot read codes when there is no reader, without asking for the camera', async () => {
    const { getUserMedia } = fakeCamera()
    render(<Scanner onScan={ok()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/^The camera can't read codes in this browser\./),
    )
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stops the camera tracks on unmount', async () => {
    const { track } = fakeCamera()
    const { unmount } = render(<Scanner onScan={ok()} detector={fakeDetector().detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    await screen.findByRole('button', { name: 'Stop camera' })
    expect(track.stop).not.toHaveBeenCalled()
    unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  it('stops the camera tracks on "Stop camera"', async () => {
    const { track } = fakeCamera()
    render(<Scanner onScan={ok()} detector={fakeDetector().detector} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop camera' }))
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Use camera' })).toBeTruthy()
  })
})

describe('offline', () => {
  it('holds scans in memory, shows the waiting note, and sends them in order on online', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    let offline = true
    const sent: string[] = []
    const onScan = vi.fn(async (code: string) => {
      if (offline) throw new TypeError('Failed to fetch')
      sent.push(code)
      return { ok: true, message: 'Received' }
    })
    render(<Scanner onScan={onScan} />)
    type('ONE')
    await waitFor(() => expect(screen.getByText('1 scan waiting to send. Keep this page open.')).toBeTruthy())
    type('TWO')
    type('THREE')
    await waitFor(() => expect(screen.getByText('3 scans waiting to send. Keep this page open.')).toBeTruthy())
    // Later scans wait behind the first without being tried out of order.
    expect(onScan).toHaveBeenCalledTimes(1)

    offline = false
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(sent).toEqual(['ONE', 'TWO', 'THREE']))
    await waitFor(() => expect(screen.queryByTestId('scan-waiting')).toBeNull())
    expect(screen.getByText('Accepted:').textContent).toContain('3')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('queues without calling onScan while navigator.onLine is false', async () => {
    setOnline(false)
    const onScan = ok()
    render(<Scanner onScan={onScan} />)
    type('OFF')
    await waitFor(() => expect(screen.getByText('1 scan waiting to send. Keep this page open.')).toBeTruthy())
    expect(onScan).not.toHaveBeenCalled()
    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('OFF'))
  })

  it('keeps the rest waiting if the connection drops again mid-send', async () => {
    let failFrom = 0
    let calls = 0
    const onScan = vi.fn(async (code: string) => {
      calls += 1
      if (calls > failFrom) throw new TypeError('Failed to fetch')
      return { ok: true, message: code }
    })
    render(<Scanner onScan={onScan} />)
    type('A')
    type('B')
    await waitFor(() => expect(screen.getByText('2 scans waiting to send. Keep this page open.')).toBeTruthy())
    failFrom = calls + 1 // the next send works, the one after fails
    fireEvent.click(screen.getByRole('button', { name: 'Try sending now' }))
    await waitFor(() => expect(screen.getByText('1 scan waiting to send. Keep this page open.')).toBeTruthy())
  })

  it('does not queue ordinary server errors', async () => {
    render(
      <Scanner
        onScan={async () => {
          throw new Error('500')
        }}
      />,
    )
    type('ERR')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Couldn't check ERR/))
    expect(screen.queryByTestId('scan-waiting')).toBeNull()
  })

  it('never touches web storage', async () => {
    const spies = (['setItem', 'getItem', 'removeItem'] as const).map((m) => vi.spyOn(Storage.prototype, m))
    const idb = vi.fn()
    Object.defineProperty(globalThis, 'indexedDB', { value: { open: idb }, configurable: true })
    fakeCamera()
    const { detector, view } = fakeDetector()
    let offline = true
    const onScan = vi.fn(async () => {
      if (offline) throw new TypeError('Failed to fetch')
      return { ok: true, message: 'ok' }
    })
    render(<Scanner onScan={onScan} detector={detector} onUndo={() => {}} />)
    type('S1')
    fireEvent.click(screen.getByRole('button', { name: 'Use camera' }))
    view.codes = ['S2']
    await waitFor(() => expect(screen.getByText('2 scans waiting to send. Keep this page open.')).toBeTruthy())
    offline = false
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(screen.queryByTestId('scan-waiting')).toBeNull())
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(idb).not.toHaveBeenCalled()
    delete (globalThis as { indexedDB?: unknown }).indexedDB
  })
})
