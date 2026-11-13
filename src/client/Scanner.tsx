'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'

import { useScanner } from './useScanner.js'
import type { BarcodeFormat, DetectorSource } from './useScanner.js'

export interface ScanResult {
  ok: boolean
  /** Shown and announced in words, such as "Tube 4 received" or "Already packed". */
  message: string
}

export interface ScannerProps {
  /** Checks one code. Reject with a network error (a TypeError from fetch) to have the scan wait and retry. */
  onScan: (code: string) => Promise<ScanResult>
  /** Called when the person undoes the last accepted scan. Undo is offered only when this is given. */
  onUndo?: (code: string) => void | Promise<void>
  formats?: readonly BarcodeFormat[]
  /** The same camera code within this many ms counts once. Default 2500; 0 turns the window off. */
  repeatMs?: number
  /** Keys that end a typed or USB-scanned code. Default Enter and Tab. */
  terminators?: readonly string[]
  /** A short tone for each result. Default on. */
  sound?: boolean
  /** A short buzz for each result, where the device supports it. Default on. */
  vibrate?: boolean
  /** The site's own reader for browsers without BarcodeDetector. */
  detector?: DetectorSource
  /** Label for the typed entry field. */
  label?: string
}

type Status = { tone: 'ok' | 'refused' | 'waiting' | 'info'; text: string }

const target: CSSProperties = { minHeight: 44, minWidth: 44, font: 'inherit', padding: '0.5rem 1rem' }

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return err instanceof TypeError
}

export function waitingNote(n: number): string {
  return `${n} ${n === 1 ? 'scan' : 'scans'} waiting to send. Keep this page open.`
}

function feedback(ok: boolean, sound: boolean, vibrate: boolean) {
  if (vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ok ? 60 : [80, 60, 80])
    } catch {
      // Ignore devices that refuse.
    }
  }
  if (!sound) return
  const Ctx =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  try {
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 880 : 220
    gain.gain.value = 0.1
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.3))
    osc.onended = () => void ctx.close()
  } catch {
    // Sound is a nicety; never let it break scanning.
  }
}

/**
 * Reads codes from a typed or USB-scanner entry field, and from the camera once the person presses "Use camera".
 * Scans that can't reach the server wait in memory only, and are sent in order when the connection returns.
 */
export function Scanner(props: ScannerProps) {
  const {
    onScan,
    onUndo,
    formats,
    repeatMs,
    terminators = ['Enter', 'Tab'],
    sound = true,
    vibrate = true,
    detector,
    label = 'Type or scan a code',
  } = props
  const ids = useId()
  const [value, setValue] = useState('')
  const [count, setCount] = useState(0)
  const [accepted, setAccepted] = useState<string[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [waiting, setWaiting] = useState(0)

  // Memory only: never written to any storage, so codes don't linger on a shared device.
  const queue = useRef<string[]>([])
  const chain = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const latest = useRef({ onScan, onUndo, sound, vibrate })
  latest.current = { onScan, onUndo, sound, vibrate }

  const syncWaiting = () => {
    if (mounted.current) setWaiting(queue.current.length)
  }

  const report = useCallback((code: string, result: ScanResult) => {
    if (!mounted.current) return
    if (result.ok) {
      setCount((c) => c + 1)
      setAccepted((list) => [...list, code])
      setStatus({ tone: 'ok', text: `Accepted ${code}: ${result.message}` })
    } else {
      setStatus({ tone: 'refused', text: `Not accepted ${code}: ${result.message}` })
    }
    feedback(result.ok, latest.current.sound, latest.current.vibrate)
  }, [])

  /** Sends one code. Returns false if it couldn't reach the server. */
  const send = useCallback(
    async (code: string): Promise<boolean> => {
      try {
        report(code, await latest.current.onScan(code))
        return true
      } catch (err) {
        if (isNetworkError(err)) return false
        if (mounted.current) {
          setStatus({ tone: 'refused', text: `Couldn't check ${code}. Something went wrong; try it again.` })
        }
        feedback(false, latest.current.sound, latest.current.vibrate)
        return true
      }
    },
    [report],
  )

  const enqueue = useCallback((task: () => Promise<void>) => {
    chain.current = chain.current.then(task, task)
  }, [])

  const flush = useCallback(() => {
    enqueue(async () => {
      while (queue.current.length > 0) {
        const code = queue.current[0] as string
        if (!(await send(code))) break
        queue.current.shift()
        syncWaiting()
      }
    })
  }, [enqueue, send])

  const submit = useCallback(
    (raw: string) => {
      const code = raw.trim()
      if (!code) return
      enqueue(async () => {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        // Keep order: while anything waits, new scans wait behind it.
        if (queue.current.length > 0 || offline || !(await send(code))) {
          queue.current.push(code)
          syncWaiting()
          if (mounted.current) setStatus({ tone: 'waiting', text: `Waiting to send ${code}. No connection.` })
        }
      })
    },
    [enqueue, send],
  )

  useEffect(() => {
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  const camera = useScanner({ formats, repeatMs, detector, onCode: submit })

  useEffect(() => {
    if (camera.error) setStatus({ tone: 'info', text: `${camera.error.message} You can still type or scan codes into the box.` })
  }, [camera.error])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(value)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!terminators.includes('Enter')) e.preventDefault()
      return // The form's submit handles Enter.
    }
    // An empty field lets Tab move focus as usual, so keyboard users are never trapped.
    if (terminators.includes(e.key) && value.trim() !== '') {
      e.preventDefault()
      submit(value)
      setValue('')
    }
  }

  const undo = () => {
    const code = accepted[accepted.length - 1]
    if (code === undefined || !onUndo) return
    enqueue(async () => {
      try {
        await latest.current.onUndo?.(code)
        if (!mounted.current) return
        setAccepted((list) => list.slice(0, -1))
        setCount((c) => Math.max(0, c - 1))
        setStatus({ tone: 'info', text: `Undid ${code}.` })
      } catch {
        if (mounted.current) setStatus({ tone: 'refused', text: `Couldn't undo ${code}. Try again.` })
      }
    })
  }

  const lastAccepted = accepted[accepted.length - 1]

  return (
    <div className="scan-scanner">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 16rem' }}>
          <label htmlFor={`${ids}-code`}>{label}</label>
          <input
            id={`${ids}-code`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            style={{ ...target, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <button type="submit" style={target}>
          Add code
        </button>
        <button type="button" style={target} onClick={() => (camera.active ? camera.stop() : void camera.start())}>
          {camera.active ? 'Stop camera' : 'Use camera'}
        </button>
      </form>

      <video
        ref={camera.videoRef}
        muted
        playsInline
        aria-label="Camera view"
        hidden={!camera.active}
        style={{ width: '100%', maxWidth: '32rem', marginTop: '0.75rem' }}
      />

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-tone={status?.tone}
        style={{ fontSize: '1.5rem', fontWeight: 600, minHeight: '2em', margin: '0.75rem 0' }}
      >
        {status?.text ?? ''}
      </p>

      {waiting > 0 && (
        <p data-testid="scan-waiting" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <span>{waitingNote(waiting)}</span>
          <button type="button" style={target} onClick={flush}>
            Try sending now
          </button>
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <p style={{ margin: 0 }}>
          Accepted: <strong>{count}</strong>
        </p>
        {onUndo && (
          <button type="button" style={target} onClick={undo} disabled={lastAccepted === undefined}>
            {lastAccepted === undefined ? 'Undo last scan' : `Undo ${lastAccepted}`}
          </button>
        )}
      </div>
    </div>
  )
}
