import type { Payload, PayloadRequest } from 'payload'

export type Req = Partial<PayloadRequest>
export type ID = string | number

/** One kind of scan link, registered by whoever owns its codes (`…/k/<code>` for Sample Kits' kits). */
export type ScanKind = {
  /** Checked before any lookup. A code that doesn't match is treated exactly like one that doesn't exist. */
  pattern: RegExp
  /** The site or scope a code belongs to, or null when there's no such code. Leave out on a single-site install. */
  scopeOf?: (args: { code: string; req: Req; payload: Payload }) => Promise<ID | null>
  /** Is this person staff for this kind, in this scope (null: in any scope)? Throwing counts as no. */
  isStaff: (args: { user: Record<string, unknown>; scope: ID | null; req: Req; payload: Payload }) => Promise<boolean>
  /** Where this person may go for this code, or null when there's nothing they may see. */
  resolve: (args: { code: string; user: Record<string, unknown>; staff: boolean; req: Req; payload: Payload }) => Promise<{ to: string } | null>
}

export type KindRegistration = { owner: string; kinds: Record<string, ScanKind> }

export type ScanAnswer = { outcome: 'to'; to: string } | { outcome: 'signIn' } | { outcome: 'nothingHere' } | { outcome: 'notFound' }

export type ScanOptions = {
  kinds?: Record<string, ScanKind>
  /** Lookups per minute, per signed-in person. Signed-out scans never look anything up. Default 30. */
  perMinute?: number
  /** The auth collection. Default: admin.user, else users. */
  users?: string
  /** Counts refusals per kind for abuse alerts. Gets no code and no person. */
  onRefusal?: (args: { kind: string; outcome: ScanAnswer['outcome'] }) => void | Promise<void>
}

export type Resolved = { kinds: Record<string, ScanKind>; perMinute: number; users: string; attempts: string; onRefusal?: ScanOptions['onRefusal'] }
