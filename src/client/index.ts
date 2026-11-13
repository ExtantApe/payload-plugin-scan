'use client'

export { Scanner } from './Scanner.js'
export type { ScanResult, ScannerProps } from './Scanner.js'
export { CameraScanButton } from './CameraScanButton.js'
export type { CameraScanButtonProps } from './CameraScanButton.js'
export { useScanner, DEFAULT_FORMATS, DEFAULT_REPEAT_MS } from './useScanner.js'
export type {
  BarcodeDetectorLike,
  BarcodeFormat,
  DetectorSource,
  ScannerError,
  ScannerErrorKind,
  UseScannerOptions,
  UseScannerResult,
} from './useScanner.js'
