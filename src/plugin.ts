import type { CollectionConfig, Config, Endpoint, Plugin } from 'payload'

import { kindsOf, resolveScan } from './resolve.js'
import type { Resolved, ScanOptions } from './types.js'

const attemptsCollection = (slug: string): CollectionConfig => ({
  slug,
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  timestamps: false,
  fields: [
    { name: 'keyHash', type: 'text', required: true, index: true },
    { name: 'at', type: 'date', required: true, index: true },
  ],
})

/** For apps: the same answers as the pages, as JSON. Never says more than the page would. */
const endpoint: Endpoint = {
  path: '/scan/:kind/:code',
  method: 'get',
  handler: async (req) => {
    const kind = String(req.routeParams?.kind ?? '')
    // Payload has already decoded route params.
    const code = String(req.routeParams?.code ?? '')
    const a = await resolveScan(req.payload, { kind, code, req })
    const body = a.outcome === 'to' ? { to: a.to } : a.outcome === 'signIn' ? { signIn: true } : a.outcome === 'notFound' ? { notFound: true } : { nothingHere: true }
    return Response.json(body, { status: 200, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  },
}

/** Scan: answers scan links by who is signed in, with no probing; the reading components are in `./client`. */
export const scanPlugin =
  (options: ScanOptions = {}): Plugin =>
  (config: Config): Config => {
    const o: Resolved = {
      kinds: options.kinds ?? {},
      perMinute: options.perMinute ?? 30,
      users: options.users ?? config.admin?.user ?? 'users',
      attempts: 'scan-attempts',
      onRefusal: options.onRefusal,
    }
    if (!(o.perMinute >= 1 && Number.isFinite(o.perMinute))) throw new Error('Scan: perMinute must be 1 or more.')
    return {
      ...config,
      custom: { ...config.custom, scan: o },
      collections: [...(config.collections ?? []), attemptsCollection(o.attempts)],
      endpoints: [...(config.endpoints ?? []), endpoint],
      onInit: async (payload) => {
        kindsOf(payload) // a duplicate or broken kind stops the site here
        await config.onInit?.(payload)
      },
    }
  }
