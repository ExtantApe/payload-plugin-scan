'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Format names as the browser's BarcodeDetector spells them. */
export type BarcodeFormat =
  | 'aztec'
  | 'code_128'
  | 'code_39'
  | 'code_93'
  | 'codabar'
  | 'data_matrix'
  | 'ean_13'
  | 'ean_8'
  | 'itf'
  | 'pdf417'
  | 'qr_code'
  | 'upc_a'
  | 'upc_e'
  | (string & {})

/** Anything that reads codes from a video frame: the native BarcodeDetector, or a reader the site provides. */
export interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
}

/**
 * A reader the site provides for browsers without BarcodeDetector, such as a ZXing WebAssembly reader served from
 * the site's own /vendor folder. Either the reader itself or a factory that builds it (called once per camera start).
 */
export type DetectorSource =
  | BarcodeDetectorLike
  | ((formats: readonly BarcodeFormat[]) => BarcodeDetectorLike | Promise<BarcodeDetectorLike>)

export type ScannerErrorKind = 'denied' | 'no-camera' | 'no-camera-api' | 'unsupported' | 'failed'

export interface ScannerError {
  kind: ScannerErrorKind
  /** Plain words, ready to show. */
  message: string
}

export interface UseScannerOptions {
  /** Defaults to Code 128 and QR. */
  formats?: readonly BarcodeFormat[]
  /** Called once per accepted camera read. */
  onCode: (code: string) => void
  /** The same code within this many ms of its last sighting counts once. Default 2500; 0 turns the window off. */
  repeatMs?: number
  /** Used when the browser has no BarcodeDetector, or one that can't read the requested formats. */
  detector?: DetectorSource
}

export interface UseScannerResult {
  /** Asks for the camera and starts reading. Call it from a person's action, such as a button press. */
  start: () => Promise<void>
  /** Stops reading and releases the camera. */
  stop: () => void
  active: boolean
  error: ScannerError | null
  /** Attach to a `<video muted playsInline>` element that stays mounted while scanning. */
  videoRef: RefObject<HTMLVideoElement | null>
}

export const DEFAULT_FORMATS: readonly BarcodeFormat[] = ['code_128', 'qr_code']
export const DEFAULT_REPEAT_MS = 2500
const FRAME_INTERVAL_MS = 150

export const MESSAGES = {
  denied: 'Camera access was refused.',
  'no-camera': 'No camera was found on this device.',
  'no-camera-api':
    "This browser can't use the camera on this page.",
  unsupported: "The camera can't read codes in this browser.",
  failed: "The camera couldn't start.",
} as const satisfies Record<ScannerErrorKind, string>

function scannerError(kind: ScannerErrorKind): ScannerError {
  return { kind, message: MESSAGES[kind] }
}

/**
 * Repeat suppression for camera reads. A code counts once while it stays in view, and again only after it has been
 * out of view for `repeatMs`. With `repeatMs` 0 a code counts again as soon as it leaves the frame and comes back.
 */
export function createRepeatFilter(repeatMs: number) {
  const lastSeen = new Map<string, number>()
  let previousFrame = new Set<string>()
  return {
    /** Takes the codes in one frame and returns the ones that count. */
    accept(codes: readonly string[], now: number): string[] {
      const accepted: string[] = []
      const frame = new Set<string>()
      for (const code of codes) {
        if (!code || frame.has(code)) continue
        frame.add(code)
        const seen = lastSeen.get(code)
        const repeat = previousFrame.has(code) || (seen !== undefined && now - seen < repeatMs)
        lastSeen.set(code, now)
        if (!repeat) accepted.push(code)
      }
      previousFrame = frame
      for (const [code, seen] of lastSeen) if (now - seen >= repeatMs && !frame.has(code)) lastSeen.delete(code)
      return accepted
    },
    reset() {
      lastSeen.clear()
      previousFrame = new Set()
    },
  }
}

interface NativeDetectorClass {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

async function chooseDetector(
  formats: readonly BarcodeFormat[],
  injected: DetectorSource | undefined,
): Promise<BarcodeDetectorLike | null> {
  const fromInjected = async () =>
    injected === undefined ? null : typeof injected === 'function' ? await injected(formats) : injected
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
  if (Native) {
    try {
      const supported = Native.getSupportedFormats ? await Native.getSupportedFormats() : [...formats]
      const usable = formats.filter((f) => supported.includes(f))
      if (usable.length > 0 && (usable.length === formats.length || injected === undefined)) {
        return new Native({ formats: usable })
      }
    } catch {
      // Fall through to the site's reader.
    }
  }
  return fromInjected()
}

function errorKind(err: unknown): ScannerErrorKind {
  const name = (err as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-camera'
  return 'failed'
}

/** Headless camera reading, shared by `<Scanner>` and `<CameraScanButton>`. */
export function useScanner(options: UseScannerOptions): UseScannerResult {
  const { formats = DEFAULT_FORMATS, repeatMs = DEFAULT_REPEAT_MS, detector } = options
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<ScannerError | null>(null)

  // Latest values, read by the running loop without restarting it.
  const latest = useRef({ onCode: options.onCode, formats, detector })
  latest.current = { onCode: options.onCode, formats, detector }
  const filterRef = useRef(createRepeatFilter(repeatMs))
  useEffect(() => {
    filterRef.current = createRepeatFilter(repeatMs)
  }, [repeatMs])

  const run = useRef<{ generation: number; stream: MediaStream | null; timer: ReturnType<typeof setTimeout> | null }>(
    { generation: 0, stream: null, timer: null },
  )
  const mounted = useRef(true)

  const release = useCallback(() => {
    const r = run.current
    r.generation += 1
    if (r.timer !== null) clearTimeout(r.timer)
    r.timer = null
    r.stream?.getTracks().forEach((track) => track.stop())
    r.stream = null
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        // Not every environment implements pause.
      }
      video.srcObject = null
    }
  }, [])

  const stop = useCallback(() => {
    release()
    if (mounted.current) setActive(false)
  }, [release])

  const start = useCallback(async () => {
    release()
    const generation = run.current.generation
    const current = () => mounted.current && run.current.generation === generation
    setError(null)

    const reader = await chooseDetector(latest.current.formats, latest.current.detector).catch(() => null)
    if (!current()) return
    if (!reader) {
      setError(scannerError('unsupported'))
      return
    }
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    if (!media || typeof media.getUserMedia !== 'function') {
      setError(scannerError('no-camera-api'))
      return
    }

    let stream: MediaStream
    try {
      stream = await media.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    } catch (err) {
      if (current()) setError(scannerError(errorKind(err)))
      return
    }
    if (!current()) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    run.current.stream = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      try {
        void Promise.resolve(video.play()).catch(() => undefined)
      } catch {
        // Autoplay of a muted inline video is allowed; ignore environments without play().
      }
    }
    filterRef.current.reset()
    setActive(true)

    const tick = async () => {
      if (!current()) return
      const source = videoRef.current
      if (source) {
        try {
          const found = await reader.detect(source)
          if (!current()) return
          const codes = filterRef.current.accept(
            found.map((f) => f.rawValue),
            Date.now(),
          )
          for (const code of codes) latest.current.onCode(code)
        } catch {
          // A frame that isn't ready yet; try the next one.
        }
      }
      if (current()) run.current.timer = setTimeout(tick, FRAME_INTERVAL_MS)
    }
    run.current.timer = setTimeout(tick, 0)
  }, [release])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      release()
    }
  }, [release])

  return { start, stop, active, error, videoRef }
}
