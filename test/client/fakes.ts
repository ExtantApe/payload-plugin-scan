import { vi } from 'vitest'

import type { BarcodeDetectorLike } from '../../src/client/index.js'

/** A detector that reports whatever codes are "in view". */
export function fakeDetector() {
  const view = { codes: [] as string[] }
  const detector: BarcodeDetectorLike & { detect: ReturnType<typeof vi.fn> } = {
    detect: vi.fn(async () => view.codes.map((rawValue) => ({ rawValue }))),
  }
  return { detector, view }
}

/** Installs a fake navigator.mediaDevices.getUserMedia. Pass an error to refuse. */
export function fakeCamera(refuse?: { name: string }) {
  const track = { stop: vi.fn(), kind: 'video' }
  const stream = { getTracks: () => [track] }
  const getUserMedia = vi.fn(async () => {
    if (refuse) throw Object.assign(new Error(refuse.name), { name: refuse.name })
    return stream
  })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return { track, getUserMedia }
}

export function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { get: () => value, configurable: true })
}

/** jsdom doesn't implement media playback. */
export function stubMedia() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
}
