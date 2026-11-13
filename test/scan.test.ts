import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, handleEndpoints, type Config, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { onSite, resolveScan, scanPlugin, type KindRegistration, type ScanKind } from '../src/index.js'

// Made-up kits on two made-up sites. A kit belongs to a site and maybe a buyer.
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let mongo: MongoMemoryReplSet
const kits: Record<string, { site: string; buyer: string | null }> = {
  '100000000001': { site: 'A', buyer: 'buyer' },
  '100000000002': { site: 'B', buyer: null },
}
const refusals: string[] = []
let staffThrows = false

const kitKind: ScanKind = {
  pattern: /^\d{12}$/,
  scopeOf: async ({ code }) => kits[code]?.site ?? null,
  isStaff: async ({ user, scope }) => {
    if (staffThrows) throw new Error('made-up failure')
    const sites = (user.staffOf as string[] | undefined) ?? []
    return scope === null ? sites.length > 0 : sites.includes(String(scope))
  },
  resolve: async ({ code, user, staff }) => {
    const k = kits[code]
    if (!k) return null
    if (staff) return { to: `/kits/${code}` }
    return k.buyer && user.handle === k.buyer ? { to: `/my-tests/activate?kit=${code}` } : null
  },
}

let n = 0
const person = (extra: Doc = {}) => ({ id: `u${++n}`, collection: 'users', ...extra })
const scan = (user: Doc | null, code: string, kind = 'k') => resolveScan(payload, { kind, code, req: { user: user as never, payload } })

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('scan'), ensureIndexes: true }),
      collections: [{ slug: 'users', auth: true, fields: [{ name: 'handle', type: 'text' }] }],
      plugins: [
        scanPlugin({ kinds: { k: kitKind }, perMinute: 20, onRefusal: ({ kind, outcome }) => void refusals.push(`${kind}:${outcome}`) }),
        // Another plugin registers a kind after Scan, with no import.
        (c: Config) => ({ ...c, custom: { ...c.custom, scanKinds: [...((c.custom?.scanKinds as KindRegistration[]) ?? []), { owner: 'boxes', kinds: { b: { ...kitKind, pattern: /^[A-Z]{3}-\d$/ } } }] } }),
      ],
    }),
  })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('the answer table', () => {
  it('asks a signed-out person to sign in, whatever the code, without looking anything up', async () => {
    for (const code of ['100000000001', '999999999999', 'not-a-code']) expect(await scan(null, code)).toEqual({ outcome: 'signIn' })
    // An account from another sign-in collection is signed out here.
    expect(await scan({ id: 'x', collection: 'devices' }, '100000000001')).toEqual({ outcome: 'signIn' })
  })

  it('sends the buyer to activation, and gives everyone else the same quiet page for any other code', async () => {
    const buyer = person({ handle: 'buyer' })
    expect(await scan(buyer, '100000000001')).toEqual({ outcome: 'to', to: '/my-tests/activate?kit=100000000001' })
    const someone = person({ handle: 'someone' })
    const answers = await Promise.all(['100000000001', '100000000002', '999999999999', 'not-a-code', '1000000000011'].map((c) => scan(someone, c)))
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ outcome: 'nothingHere' })]))
    expect(await scan(someone, '100000000001', 'no-such-kind')).toEqual({ outcome: 'nothingHere' })
  })

  it('sends staff to the record in their own site, and gives staff of another site the same Not found as no such code', async () => {
    const staffA = person({ staffOf: ['A'] })
    expect(await scan(staffA, '100000000001')).toEqual({ outcome: 'to', to: '/kits/100000000001' })
    expect(await scan(staffA, '100000000002')).toEqual({ outcome: 'notFound' }) // site B's kit
    expect(await scan(staffA, '999999999999')).toEqual({ outcome: 'notFound' })
    expect(await scan(staffA, 'bad')).toEqual({ outcome: 'notFound' })
  })

  it('never asks the provider about a malformed code', async () => {
    let asked = 0
    const counting: ScanKind = { ...kitKind, resolve: async (a) => ((asked++, kitKind.resolve(a))) , scopeOf: async (a) => ((asked++, kitKind.scopeOf!(a))) }
    const p = await getPayload({ key: 'count', config: await buildConfig({ secret: 's', telemetry: false, typescript: { autoGenerate: false }, db: mongooseAdapter({ url: mongo.getUri('scan-count'), ensureIndexes: true }), collections: [{ slug: 'users', auth: true, fields: [] }], plugins: [scanPlugin({ kinds: { k: counting } })] }) } as never)
    for (const code of ['bad', '1'.repeat(13), 'x'.repeat(500)]) await resolveScan(p, { kind: 'k', code, req: { user: person() as never, payload: p } })
    expect(asked).toBe(0)
    await p.destroy()
  })

  it('answers quietly when a provider fails', async () => {
    staffThrows = true
    const staffA = person({ staffOf: ['A'] })
    expect(await scan(staffA, '100000000001')).toEqual({ outcome: 'nothingHere' })
    staffThrows = false
  })

  it('takes kinds from other plugins, and refuses a kind registered twice', async () => {
    expect(await scan(person({ staffOf: ['A'] }), 'ABC-1', 'b')).toEqual({ outcome: 'notFound' })
    const twice = (c: Config) => ({ ...c, custom: { ...c.custom, scanKinds: [{ owner: 'a', kinds: { k: kitKind } }] } })
    await expect(getPayload({ key: 'dup', config: await buildConfig({ secret: 's', telemetry: false, typescript: { autoGenerate: false }, db: mongooseAdapter({ url: mongo.getUri('scan-dup') }), collections: [{ slug: 'users', auth: true, fields: [] }], plugins: [scanPlugin({ kinds: { k: kitKind } }), twice] }) } as never)).rejects.toThrow(/"k" is registered by both/)
  })

  it('never sends anyone off the site', async () => {
    const evil: ScanKind = { ...kitKind, resolve: async () => ({ to: '//elsewhere.example' }) }
    const fine: ScanKind = { ...kitKind, resolve: async () => ({ to: '/fine' }) }
    const p = await getPayload({ key: 'evil', config: await buildConfig({ secret: 's', telemetry: false, typescript: { autoGenerate: false }, db: mongooseAdapter({ url: mongo.getUri('scan-evil'), ensureIndexes: true }), collections: [{ slug: 'users', auth: true, fields: [] }], plugins: [scanPlugin({ kinds: { k: evil, f: fine } })] }) } as never)
    expect(await resolveScan(p, { kind: 'f', code: '100000000001', req: { user: person() as never, payload: p } })).toEqual({ outcome: 'to', to: '/fine' }) // the control
    expect(await resolveScan(p, { kind: 'k', code: '100000000001', req: { user: person() as never, payload: p } })).toEqual({ outcome: 'nothingHere' })
    await p.destroy()
  })
})

describe('limits and logging', () => {
  it('rate-limits lookups per signed-in person, with the same quiet answer over the limit', async () => {
    const buyer = person({ handle: 'buyer' })
    for (let i = 0; i < 20; i++) await scan(buyer, '100000000001')
    expect(await scan(buyer, '100000000001')).toEqual({ outcome: 'nothingHere' })
    expect(await scan(person({ handle: 'buyer' }), '100000000001')).toEqual({ outcome: 'to', to: '/my-tests/activate?kit=100000000001' }) // someone else isn't limited
  })

  it('counts refusals by kind and outcome only, never the code or the person', async () => {
    refusals.length = 0
    await scan(person(), '100000000002')
    expect(refusals).toEqual(['k:nothingHere'])
    expect(JSON.stringify(refusals)).not.toContain('100000000002')
  })

  it('gives apps the same answers as JSON, never cached', async () => {
    const res = await handleEndpoints({ config: Promise.resolve(payload.config), request: new Request('https://site.example.com/api/scan/k/100000000001') } as never)
    expect([res.status, await res.json(), res.headers.get('cache-control')]).toEqual([200, { signIn: true }, 'no-store'])
  })
})

describe('what the security read found', () => {
  it('keeps every answer on the site, however the path is dressed up', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'evil', '/\\\\evil.example']) expect(onSite(bad), bad).toBeNull()
    expect(onSite('/kits/1?x=1#y')).toBe('/kits/1?x=1#y')
    expect(onSite('/a/../b')).toBe('/b')
  })

  it('never tells resolve a person is staff for a code that has no site', async () => {
    const seen: boolean[] = []
    const watching: ScanKind = { ...kitKind, resolve: async (a) => (seen.push(a.staff), kitKind.resolve(a)) }
    const p = await getPayload({ key: 'watch', config: await buildConfig({ secret: 's', telemetry: false, typescript: { autoGenerate: false }, db: mongooseAdapter({ url: mongo.getUri('scan-watch'), ensureIndexes: true }), collections: [{ slug: 'users', auth: true, fields: [] }], plugins: [scanPlugin({ kinds: { k: watching } })] }) } as never)
    await resolveScan(p, { kind: 'k', code: '999999999999', req: { user: person({ staffOf: ['A'] }) as never, payload: p } })
    expect(seen).toEqual([false])
    await p.destroy()
  })

  it('doesn’t grow the attempts table past the limit when someone floods it', async () => {
    const flooder = person()
    const count = async () => (await payload.count({ collection: 'scan-attempts' as never, overrideAccess: true })).totalDocs
    const before = await count()
    for (let i = 0; i < 40; i++) await scan(flooder, '999999999999')
    expect((await count()) - before).toBe(20) // 20 a minute per person here; the flood adds none past it
  })

  it('answers an odd code in the URL without an error, and labels unknown kinds as unknown', async () => {
    const res = await handleEndpoints({ config: Promise.resolve(payload.config), request: new Request('https://site.example.com/api/scan/k/%25') } as never)
    expect(res.status).toBe(200)
    refusals.length = 0
    await scan(person(), '1', 'made-up-junk')
    expect(refusals).toEqual(['(unknown kind):nothingHere'])
  })
})
