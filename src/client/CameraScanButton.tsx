'use client'

import { useCallback, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, SyntheticEvent } from 'react'

import { useScanner } from './useScanner.js'
import type { BarcodeFormat, DetectorSource } from './useScanner.js'

export interface CameraScanButtonProps {
  /** Called once with the code read, after the dialog has closed. */
  onResult: (code: string) => void
  formats?: readonly BarcodeFormat[]
  /** The site's own reader for browsers without BarcodeDetector. */
  detector?: DetectorSource
  /** The button's text. Default "Scan with camera". */
  label?: string
}

const target: CSSProperties = { minHeight: 44, minWidth: 44, font: 'inherit', padding: '0.5rem 1rem' }

/** A button that opens the camera in a dialog, reads one code, closes, and calls `onResult`. */
export function CameraScanButton({ onResult, formats, detector, label = 'Scan with camera' }: CameraScanButtonProps) {
  const ids = useId()
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const done = useRef(false)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  // Declared before the hook so onCode can close; the hook's stop is read through a ref.
  const stopRef = useRef<() => void>(() => undefined)

  const close = useCallback(() => {
    stopRef.current()
    const dialog = dialogRef.current
    if (dialog) {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
    setOpen(false)
    openerRef.current?.focus()
  }, [])

  const camera = useScanner({
    formats,
    detector,
    repeatMs: 0,
    onCode: (code) => {
      if (done.current) return
      done.current = true
      close()
      onResultRef.current(code)
    },
  })
  stopRef.current = camera.stop

  const openDialog = () => {
    const dialog = dialogRef.current
    if (!dialog) return
    done.current = false
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    setOpen(true)
    closeRef.current?.focus()
    void camera.start()
  }

  // Escape: the native dialog fires "cancel"; handle it here so the camera stops and focus returns.
  const onCancel = (e: SyntheticEvent) => {
    e.preventDefault()
    close()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const message = camera.error
    ? camera.error.message
    : camera.active
      ? 'Point the camera at a code. It closes by itself when it reads one.'
      : 'Starting the camera…'

  return (
    <>
      <button ref={openerRef} type="button" style={target} onClick={openDialog} aria-haspopup="dialog">
        {label}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-status`}
        onCancel={onCancel}
        onKeyDown={onKeyDown}
        style={{ maxWidth: '36rem', width: 'calc(100% - 2rem)' }}
      >
        <h2 id={`${ids}-title`} style={{ marginTop: 0 }}>
          Scan a code
        </h2>
        <video
          ref={camera.videoRef}
          muted
          playsInline
          aria-label="Camera view"
          hidden={!camera.active}
          style={{ width: '100%' }}
        />
        <p id={`${ids}-status`} role="status" aria-live="polite">
          {open ? message : ''}
        </p>
        <button ref={closeRef} type="button" style={target} onClick={close}>
          Close
        </button>
      </dialog>
    </>
  )
}
