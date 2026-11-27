import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { kindsOf, resolveScan, scanPlugin, type ScanKind } from '../src/index.js'

// The 2026-11-26 audit's tests: access through the real endpoint with real sign-in, odd input, and the checks that
// must fail closed. Made-up kits on two made-up sites, as in scan.test.ts.
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let mongo: MongoMemoryReplSet
const LIMIT = 20
const kits: Record<string, { site: string; buyer: string | null }> = {
  '100000000001': { site: 'A', buyer: 'buyer' },
  '100000000002': { site: 'B', buyer: null },
}
const A_KIT = '100000000001'
const B_KIT = '100000000002'
const MISSING = '999999999999'

/** Every call a provider gets, as `function:code` (isStaff has no code, so it records its scope). */
const calls: string[] = []
const lookups = () => calls.filter((c) => !c.startsWith('isStaff:'))
const refusals: string[] = []
let failing: '' | 'resolve' | 'scopeOf' = ''
let refusalThrows = false

const kitKind: ScanKind = {
  pattern: /^\d{12}$/,
  scopeOf: async ({ code }) => {
    calls.push(`scopeOf:${code}`)
    if (failing === 'scopeOf') throw new Error('made-up failure')
    return kits[code]?.site ?? null
  },
  isStaff: async ({ user, scope }) => {
    calls.push(`isStaff:${String(scope)}`)
    const sites = (user.staffOf as string[] | undefined) ?? []
    return scope === null ? sites.length > 0 : sites.includes(String(scope))
  },
  resolve: async ({ code, user, staff }) => {
    calls.push(`resolve:${code}`)
    if (failing === 'resolve') throw new Error('made-up failure')
    const k = kits[code]
    if (!k) return null
    if (staff) return { to: `/kits/${code}` }
    return k.buyer && user.handle === k.buyer ? { to: `/my-tests/activate?kit=${code}` } : null
  },
}
/** A kind whose pattern takes any length, so only Scan's own length cap stands in the way. */
const wideKind: ScanKind = { ...kitKind, pattern: /^[a-z]+$/, scopeOf: undefined, resolve: async ({ code }) => (calls.push(`resolve:${code}`), { to: '/wide' }) }

let n = 0
const person = (extra: Doc = {}) => ({ id: `g${++n}`, collection: 'users', ...extra })
const scan = (user: Doc | null, code: unknown, kind: unknown = 'k') => resolveScan(payload, { kind: kind as string, code: code as string, req: { user: user as never, payload } })

/** A real account, signed in for real: the token goes through Payload's own auth on the way to the endpoint. */
const tokens: Record<string, string> = {}
async function account(name: string, collection: 'users' | 'devices', data: Doc = {}) {
  const email = `${name}@example.com`
  const password = `made-up-${name}-password`
  await payload.create({ collection: collection as never, data: { email, password, ...data } as never, overrideAccess: true })
  const { token } = await payload.login({ collection: collection as never, data: { email, password } as never })
  tokens[name] = token!
}
async function get(path: string, as?: string) {
  const headers: Record<string, string> = as ? { Authorization: `JWT ${tokens[as] ?? as}` } : {}
  const res = await handleEndpoints({ config: Promise.resolve(payload.config), request: new Request(`https://site.example.com/api${path}`, { headers }) } as never)
  return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control'), referrer: res.headers.get('referrer-policy') }
}
const quietJson = { status: 200, text: JSON.stringify({ nothingHere: true }), cache: 'no-store', referrer: 'no-referrer' }
const notFoundJson = { ...quietJson, text: JSON.stringify({ notFound: true }) }
const signInJson = { ...quietJson, text: JSON.stringify({ signIn: true }) }

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    key: 'guards',
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('scan-guards'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'handle', type: 'text' }, { name: 'staffOf', type: 'text', hasMany: true }] },
        { slug: 'devices', auth: true, fields: [{ name: 'handle', type: 'text' }, { name: 'staffOf', type: 'text', hasMany: true }] },
      ],
      plugins: [
        scanPlugin({
          kinds: { k: kitKind, w: wideKind },
          perMinute: LIMIT,
          onRefusal: ({ kind, outcome }) => {
            refusals.push(`${kind}:${outcome}`)
            if (refusalThrows) throw new Error('made-up failure')
          },
        }),
      ],
    }),
  } as never)
  await account('buyer', 'users', { handle: 'buyer' })
  await account('someone', 'users', { handle: 'someone' })
  await account('staff-a', 'users', { staffOf: ['A'] })
  // The buyer's handle and staff of both sites, but signed in to another collection.
  await account('device', 'devices', { handle: 'buyer', staffOf: ['A', 'B'] })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

beforeEach(() => {
  calls.length = 0
  refusals.length = 0
  failing = ''
  refusalThrows = false
})

describe('who gets what, through the endpoint with a real sign-in', () => {
  it('sends the buyer and the site’s staff to their own pages', async () => {
    expect(await get(`/scan/k/${A_KIT}`, 'buyer')).toEqual({ ...quietJson, text: JSON.stringify({ to: `/my-tests/activate?kit=${A_KIT}` }) })
    expect(await get(`/scan/k/${A_KIT}`, 'staff-a')).toEqual({ ...quietJson, text: JSON.stringify({ to: `/kits/${A_KIT}` }) })
  })

  it('gives a signed-in person the same response for someone else’s code, a missing code and a malformed one', async () => {
    for (const code of [A_KIT, B_KIT, MISSING, 'not-a-code', '%7B%22%24ne%22%3Anull%7D']) expect(await get(`/scan/k/${code}`, 'someone'), code).toEqual(quietJson)
    expect(await get(`/scan/no-such-kind/${A_KIT}`, 'someone')).toEqual(quietJson)
    // The buyer of one kit learns nothing about another.
    expect(await get(`/scan/k/${B_KIT}`, 'buyer')).toEqual(quietJson)
  })

  it('gives staff of one site the same Not found for another site’s code as for a missing or malformed one', async () => {
    for (const code of [B_KIT, MISSING, 'not-a-code']) expect(await get(`/scan/k/${code}`, 'staff-a'), code).toEqual(notFoundJson)
  })

  it('asks for sign-in without a session, with a bad token, or with an account from another collection', async () => {
    for (const code of [A_KIT, MISSING, 'not-a-code']) expect(await get(`/scan/k/${code}`), code).toEqual(signInJson)
    expect(await get(`/scan/k/${A_KIT}`, 'not.a.token')).toEqual(signInJson)
    expect(await get(`/scan/k/${A_KIT}`, 'device')).toEqual(signInJson)
  })

  it('looks nothing up and stores nothing for a signed-out scan', async () => {
    const rows = async () => (await payload.count({ collection: 'scan-attempts' as never, overrideAccess: true })).totalDocs
    const before = await rows()
    for (const code of [A_KIT, MISSING, 'not-a-code']) expect(await scan(null, code)).toEqual({ outcome: 'signIn' })
    expect(await scan({ id: 'x', collection: 'devices', staffOf: ['A'] }, A_KIT)).toEqual({ outcome: 'signIn' })
    expect(calls).toEqual([])
    expect(await rows()).toBe(before)
  })
})

describe('odd input', () => {
  it('refuses a code that isn’t a plain string, even one that would match once turned into text', async () => {
    const buyer = person({ handle: 'buyer' })
    expect(await scan(buyer, A_KIT)).toEqual({ outcome: 'to', to: `/my-tests/activate?kit=${A_KIT}` }) // the control
    calls.length = 0
    for (const code of [[A_KIT], { toString: () => A_KIT }, Number(A_KIT), { $ne: null }, null, undefined]) expect(await scan(buyer, code), JSON.stringify(code)).toEqual({ outcome: 'nothingHere' })
    expect(lookups()).toEqual([])
  })

  it('never hands the provider a code dressed up as a query, a second code or other digits', async () => {
    const buyer = person({ handle: 'buyer' })
    const dressed = ['{"$ne":null}', '[$ne]=1', `${A_KIT}' OR '1'='1`, `${A_KIT}\n${B_KIT}`, `${A_KIT}\u0000`, `${A_KIT}/../${B_KIT}`, '１００００００００００１', `${A_KIT}0`, '']
    for (const code of dressed) expect(await scan(buyer, code), JSON.stringify(code)).toEqual({ outcome: 'nothingHere' })
    expect(lookups()).toEqual([])
  })

  it('reads a code with a scanner’s trailing newline, and gives the provider the clean code', async () => {
    expect(await scan(person({ handle: 'buyer' }), ` ${A_KIT}\r\n`)).toEqual({ outcome: 'to', to: `/my-tests/activate?kit=${A_KIT}` })
    expect(lookups()).toEqual([`scopeOf:${A_KIT}`, `resolve:${A_KIT}`])
  })

  it('stops a code over 200 characters before the provider, whatever the kind’s pattern allows', async () => {
    const someone = person()
    expect(await scan(someone, 'a'.repeat(200), 'w')).toEqual({ outcome: 'to', to: '/wide' }) // the control
    calls.length = 0
    for (const length of [201, 100_000]) expect(await scan(someone, 'a'.repeat(length), 'w'), String(length)).toEqual({ outcome: 'nothingHere' })
    expect(lookups()).toEqual([])
  })

  it('treats names every object has as unknown kinds, and never passes a made-up kind name to onRefusal', async () => {
    const someone = person()
    const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'k\nforged line', 'x'.repeat(5_000)]
    for (const kind of names) expect(await scan(someone, A_KIT, kind), kind).toEqual({ outcome: 'nothingHere' })
    expect(refusals).toEqual(names.map(() => '(unknown kind):nothingHere'))
    expect(lookups()).toEqual([])
  })
})

describe('checks that fail closed', () => {
  it('answers quietly when the provider’s lookup fails, even for the person the code belongs to', async () => {
    const buyer = person({ handle: 'buyer' })
    const staffA = person({ staffOf: ['A'] })
    for (const part of ['resolve', 'scopeOf'] as const) {
      failing = part
      expect(await scan(buyer, A_KIT), part).toEqual({ outcome: 'nothingHere' })
      expect((await scan(staffA, A_KIT)).outcome, part).not.toBe('to')
    }
    failing = ''
    expect(await scan(buyer, A_KIT)).toEqual({ outcome: 'to', to: `/my-tests/activate?kit=${A_KIT}` }) // back to normal
  })

  it('answers quietly, and asks the provider nothing, when the rate limit can’t be checked', async () => {
    const count = vi.spyOn(payload, 'count').mockRejectedValueOnce(new Error('made-up outage'))
    try {
      expect(await scan(person({ handle: 'buyer' }), A_KIT)).toEqual({ outcome: 'nothingHere' })
      expect(calls).toEqual([])
    } finally {
      count.mockRestore()
    }
  })

  it('gives the same answers when onRefusal fails', async () => {
    refusalThrows = true
    expect(await scan(null, A_KIT)).toEqual({ outcome: 'signIn' })
    expect(await scan(person(), A_KIT)).toEqual({ outcome: 'nothingHere' })
    expect(await scan(person({ staffOf: ['A'] }), B_KIT)).toEqual({ outcome: 'notFound' })
    expect(refusals).toEqual(['k:signIn', 'k:nothingHere', 'k:notFound'])
  })

  it('stops the site at start-up over a kind with an unusable name or a missing part', () => {
    const site = (kinds: Doc, scanKinds?: unknown) => ({ config: { custom: { scan: { kinds }, scanKinds } } }) as unknown as Payload
    expect(Object.keys(kindsOf(site({ k: kitKind, 'box-2': kitKind })))).toEqual(['k', 'box-2']) // the control
    for (const name of ['K', 'a b', '', '2k', '../k', 'k/x', 'a'.repeat(17)]) expect(() => kindsOf(site({ [name]: kitKind })), name).toThrow(/isn't a usable kind/)
    const broken: Doc[] = [{ ...kitKind, pattern: '^\\d{12}$' }, { ...kitKind, pattern: undefined }, { ...kitKind, isStaff: undefined }, { ...kitKind, resolve: undefined }, {}]
    for (const kind of broken) expect(() => kindsOf(site({ k: kind })), JSON.stringify(Object.keys(kind))).toThrow(/needs pattern, isStaff and resolve/)
    expect(() => kindsOf(site({}, [{ owner: 'boxes', kinds: { b: { ...kitKind, isStaff: true } } }]))).toThrow(/"b" from boxes needs/)
  })

  it('refuses a rate limit that would switch the limit off', () => {
    for (const perMinute of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '30' as never]) expect(() => scanPlugin({ perMinute })({} as never), String(perMinute)).toThrow(/perMinute must be 1 or more/)
    expect(() => scanPlugin({ perMinute: 1 })({} as never)).not.toThrow()
  })
})

describe('the rate limit and what it stores', () => {
  it('counts one limit per person across every kind, unknown kinds included, and quiets staff too', async () => {
    const staffA = person({ staffOf: ['A'] })
    for (let i = 0; i < LIMIT; i++) await scan(staffA, MISSING, i % 2 ? `made-up-${i}` : i % 4 ? 'w' : 'k')
    calls.length = 0
    expect(await scan(staffA, A_KIT)).toEqual({ outcome: 'nothingHere' }) // their own site's kit, and not even "Not found"
    expect(await scan(staffA, MISSING)).toEqual({ outcome: 'nothingHere' })
    expect(calls).toEqual([])
  })

  it('lets no more than the limit through when one person sends a burst at the same moment', async () => {
    const someone = person()
    const answers = await Promise.all(Array.from({ length: LIMIT * 3 }, () => scan(someone, 'burst', 'w')))
    const through = answers.filter((a) => a.outcome === 'to').length
    expect(through).toBeGreaterThan(0)
    expect(through).toBeLessThanOrEqual(LIMIT)
  })

  it('stores a hash for the person, never their id or the code', async () => {
    const who = person({ id: 'person-with-a-recognizable-id', handle: 'buyer' })
    await scan(who, A_KIT)
    await scan(who, 'recognizable-malformed-code')
    const { docs } = await payload.find({ collection: 'scan-attempts' as never, limit: 0, pagination: false, overrideAccess: true })
    const stored = JSON.stringify(docs)
    expect(docs.length).toBeGreaterThan(0)
    for (const secret of ['recognizable', A_KIT, 'test-secret-not-for-production']) expect(stored).not.toContain(secret)
    for (const d of docs as Doc[]) expect(Object.keys(d).sort()).toEqual(['at', 'id', 'keyHash'])
    for (const d of docs as Doc[]) expect(d.keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the attempts table closed to everyone, staff included, in code and over the API', async () => {
    const user = { ...person({ staffOf: ['A', 'B'] }) }
    const collection = 'scan-attempts' as never
    const [row] = (await payload.find({ collection, limit: 1, overrideAccess: true })).docs as Doc[]
    const data = { keyHash: 'made-up', at: new Date().toISOString() } as never
    await expect(payload.find({ collection, overrideAccess: false, user })).rejects.toThrow(/not allowed/i)
    await expect(payload.create({ collection, data, overrideAccess: false, user })).rejects.toThrow(/not allowed/i)
    await expect(payload.update({ collection, id: row!.id, data, overrideAccess: false, user })).rejects.toThrow(/not allowed/i)
    await expect(payload.delete({ collection, id: row!.id, overrideAccess: false, user })).rejects.toThrow(/not allowed/i)
    expect((await get('/scan-attempts', 'staff-a')).status).toBe(403)
    expect((await get('/scan-attempts')).status).toBe(403)
    expect(payload.collections['scan-attempts' as never]!.config.admin.hidden).toBe(true)
  })

  it('writes no code and no person to the log, whether the scan works, is refused or fails', async () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    const spies = [...levels.map((l) => vi.spyOn(payload.logger, l)), ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((l) => vi.spyOn(console, l).mockImplementation(() => undefined))]
    try {
      const who = person({ id: 'person-with-a-loggable-id', handle: 'buyer' })
      await scan(who, A_KIT)
      await scan(who, B_KIT)
      await scan(who, 'loggable-malformed-code')
      failing = 'resolve'
      await scan(who, A_KIT)
      const written = JSON.stringify(spies.flatMap((s) => s.mock.calls).map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a))))
      for (const secret of [A_KIT, B_KIT, 'loggable']) expect(written).not.toContain(secret)
    } finally {
      for (const s of spies) s.mockRestore()
    }
  })
})
