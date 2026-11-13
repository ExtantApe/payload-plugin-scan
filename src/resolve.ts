import { createHash } from 'node:crypto'

import type { CollectionSlug, Payload } from 'payload'

import type { KindRegistration, Req, Resolved, ScanAnswer, ScanKind } from './types.js'

const configOf = (payload: Payload): Resolved => {
  const o = payload.config.custom?.scan as Resolved | undefined
  if (!o) throw new Error('Scan: the plugin is not configured on this site.')
  return o
}

/** Every kind: the site's own and those other plugins registered at `config.custom.scanKinds`. One owner per kind. */
export function kindsOf(payload: Payload): Record<string, ScanKind> {
  const o = configOf(payload)
  const all: Record<string, ScanKind> = {}
  const owner: Record<string, string> = {}
  const add = (who: string, kinds: Record<string, ScanKind>) => {
    for (const [k, v] of Object.entries(kinds ?? {})) {
      if (owner[k]) throw new Error(`Scan: the kind "${k}" is registered by both ${owner[k]} and ${who}. One provider per kind.`)
      if (!/^[a-z][a-z0-9-]{0,15}$/.test(k)) throw new Error(`Scan: "${k}" isn't a usable kind: lowercase letters, digits and hyphens, up to 16.`)
      if (!(v?.pattern instanceof RegExp) || typeof v.isStaff !== 'function' || typeof v.resolve !== 'function') throw new Error(`Scan: the kind "${k}" from ${who} needs pattern, isStaff and resolve.`)
      owner[k] = who
      all[k] = v
    }
  }
  add('the site', o.kinds)
  const regs = payload.config.custom?.scanKinds as KindRegistration[] | undefined
  for (const r of Array.isArray(regs) ? regs : []) add(String(r?.owner ?? 'a plugin'), r?.kinds)
  return all
}

/** Records this lookup, then counts the minute including it: under a race, some are refused, never too many let in. */
async function allowed(payload: Payload, key: string): Promise<boolean> {
  const o = configOf(payload)
  const keyHash = createHash('sha256').update(`${payload.secret}|scan|${key}`).digest('hex')
  const now = Date.now()
  const since = new Date(now - 60_000).toISOString()
  // Already over the limit: refused without adding a row, so a flood can't grow the table.
  const { totalDocs } = await payload.count({ collection: o.attempts as CollectionSlug, where: { and: [{ keyHash: { equals: keyHash } }, { at: { greater_than: since } }] }, overrideAccess: true })
  if (totalDocs >= o.perMinute) return false
  const mine = (await payload.create({ collection: o.attempts as CollectionSlug, data: { keyHash, at: new Date(now).toISOString() } as never, overrideAccess: true })) as { id: ID }
  const { docs } = await payload.find({ collection: o.attempts as CollectionSlug, where: { and: [{ keyHash: { equals: keyHash } }, { at: { greater_than: since } }] }, sort: ['at', 'id'], limit: o.perMinute, pagination: false, depth: 0, overrideAccess: true })
  await payload.db.deleteMany({ collection: o.attempts, where: { at: { less_than: new Date(now - 10 * 60_000).toISOString() } } as never }).catch(() => undefined)
  return (docs as { id: ID }[]).some((d) => String(d.id) === String(mine.id))
}
type ID = string | number

/**
 * A path on this site, or null. Resolved the way a browser would, against a stand-in origin: anything that lands on
 * another origin (`//x`, `/\\x`, tabs or newlines before a slash) is refused, and the path is given back clean.
 */
export function onSite(to: string): string | null {
  if (!to.startsWith('/')) return null
  try {
    const base = 'https://scan.invalid'
    const u = new URL(to, base)
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : null
  } catch {
    return null
  }
}

/**
 * What a scan link opens, decided on the server from who is signed in, never from the link.
 * - Signed out: "Sign in", whatever the code.
 * - Signed in, not staff: where `resolve` sends them, else one shared "Nothing here for this account".
 * - Staff of that kind in the code's scope: where `resolve` sends them, else "Not found".
 * - Staff elsewhere: "Not found", the same as a code that doesn't exist.
 * The pattern is checked first in every case, lookups are rate-limited, and anything that fails answers as if the
 * code didn't exist for that person. The code is never logged next to a person.
 */
export async function resolveScan(payload: Payload, args: { kind: string; code: string; req: Req }): Promise<ScanAnswer> {
  const o = configOf(payload)
  const user = args.req.user as (Record<string, unknown> & { collection?: string }) | null | undefined
  const signedIn = Boolean(user && user.collection === o.users)
  const refuse = async (answer: ScanAnswer): Promise<ScanAnswer> => {
    try {
      const known = Object.hasOwn(kindsOf(payload), String(args.kind))
      await o.onRefusal?.({ kind: known ? String(args.kind) : '(unknown kind)', outcome: answer.outcome })
    } catch {
      /* counting must never change the answer */
    }
    return answer
  }
  if (!signedIn) return refuse({ outcome: 'signIn' })
  const quiet: ScanAnswer = { outcome: 'nothingHere' }
  try {
    const key = `user:${String(user!.id)}`
    if (!(await allowed(payload, key))) return refuse(quiet)
    const kind = Object.hasOwn(kindsOf(payload), args.kind) ? kindsOf(payload)[args.kind]! : null
    const code = typeof args.code === 'string' ? args.code.trim() : ''
    const isStaff = async (scope: ID | null) => {
      try {
        return kind ? (await kind.isStaff({ user: user!, scope, req: args.req, payload })) === true : false
      } catch {
        return false
      }
    }
    // Malformed codes and unknown kinds get the same answer as codes that don't exist.
    if (!kind || code.length > 200 || !kind.pattern.test(code)) return refuse((await isStaff(null)) ? { outcome: 'notFound' } : quiet)
    const scope = kind.scopeOf ? await kind.scopeOf({ code, req: args.req, payload }) : null
    // The same calls whether or not the code exists: isStaff is always asked twice, so timing says little.
    const [here, anywhere] = await Promise.all([isStaff(scope), isStaff(null)])
    const staffHere = kind.scopeOf ? scope !== null && here : anywhere
    const r = await kind.resolve({ code, user: user!, staff: staffHere, req: args.req, payload })
    const to = r && typeof r.to === 'string' ? onSite(r.to) : null
    if (to) return { outcome: 'to', to }
    if (staffHere || anywhere) return refuse({ outcome: 'notFound' })
    return refuse(quiet)
  } catch {
    // Can't decide: the same quiet answer as a code that doesn't exist.
    return refuse(quiet)
  }
}
