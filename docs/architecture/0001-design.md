# 0001: Scan design record

Status: **built** (2026-11-10), 0.1.0, task K291. Changes since this record: signed-out scans never look anything up, so there's no client-address limit; a hidden `scan-attempts` collection holds the per-person rate limit; the endpoint also answers `{ nothingHere: true }`; and `ScanSignIn` keeps the fragment as the sign-in link's own fragment. See docs/decisions.md.

## Context

The Captive Origins site scans in three places: receiving stock, packing, and kit activation. The scanner is one
component, `src/components/Kits/Scanner.tsx` (about 280 lines), and it does the following:
- reads codes continuously from the camera: Code 128 (tube barcodes) and QR (slips and labels);
- uses the browser's native `BarcodeDetector` where there is one, and otherwise the ZXing WebAssembly reader, served
  from the site's own `/vendor` folder, never a CDN;
- beeps and buzzes, shows a large result in words (never colour alone), and keeps a running count;
- offers undo and typed entry;
- waits with scans that can't reach the server, and sends them again when the connection is back.

The planned kit work adds two more things:
- **scan links** (`…/k/<code>` on kit boxes and `…/b/<box>` on shipping boxes), where what a scan opens depends on
  who's signed in;
- a camera button for Kitting's packing station.

Name approved by the owner on 2026-11-10 (`~/Code/ops/plugin-names.md`): **Scan**, `@extantape/payload-plugin-scan`,
tags barcode and qr. Agnostic under D2: no imports of Kitting, Sample Kits or any other plugin of ours.

## Decision

Scan owns **reading codes** and **answering scan links**. What a code means belongs to whoever registers it.

MIT, as a general Payload plugin. Public from its first push, after the audit (D5); the `gh repo create … --public`
command goes to Helm. 0.x until it has seen real use.

## 1. Reading codes (client)

- **`<Scanner onScan={(code) => Promise<{ ok, message }>} formats={['code_128','qr_code']} />`**: today's component,
  generalized.
  - Continuous camera reading, with repeat suppression: the same code within `repeatMs` counts once. It defaults to
    2.5 s, and `0` turns it off, so scanning one supply SKU per item doesn't drop real scans.
  - Typed entry that always works. A USB scanner is a keyboard, so Enter submits.
  - Undo, a running count, and sound and vibration that can be switched off.
  - Results announced through a polite live region, in words.
  - Offline: scans are queued in memory and sent in order when the connection returns. Nothing is written to storage,
    so codes don't linger on a shared device. While any are waiting, the screen says "3 scans waiting to send. Keep
    this page open", because a reload loses them.
  - A `terminators` option for hardware scanners, Enter and Tab by default.
- **`<CameraScanButton onResult={(code) => void} formats={…} />`**: a button that opens the camera in a dialog,
  reads one code, closes, and calls `onResult(code)`. This is the station's adapter (Kitting `docs/station-design.md`,
  "Open points").
  - Kitting renders it only when the site names it in Kitting's config: `custom.kitting.station.cameraComponent:
    '@extantape/payload-plugin-scan/client#CameraScanButton'`. That's a Payload import-map path, so neither plugin
    imports the other.
  - The station's own field stays the default input.
- **`useScanner({ formats, onCode })`**: a headless hook for other screens.
- **Camera access:** asked for only when the person presses "Use camera". If it's refused or there's no camera, the
  component says so in plain words and typed entry stays. The rear camera is preferred (`facingMode: 'environment'`).
- **The WebAssembly reader:** the package ships `zxing_reader.wasm`. The site copies it into `public/vendor` with the
  package's own `scan-vendor` script (today's `prebuild` step, moved). It's never loaded from a CDN. The path is
  configurable.
- **Formats:** Code 128 and QR by default. EAN-13, Data Matrix and the others the reader supports are opt-in.

## 2. Scan links (server)

A **kind** is a short prefix that a provider registers:

```ts
scan({
  kinds: {
    k: {                                        // registered by Sample Kits: …/k/<code>
      pattern: /^\d{12}$/,                      // checked before any lookup
      isStaff: ({ user, req }) => Promise<boolean>,
      resolve: ({ code, user, req }) => Promise<{ to: string } | null>,   // null: nothing this person may see
    },
    b: { … },                                   // …/b/<order ref>-<box n>
  },
  rateLimit: { perMinute: 30 },                 // per signed-in user, or per IP when signed out
})
```

Answers, decided only on the server from who is signed in, never from the link:

| Who | Code exists and they may see it | Code exists, not theirs | Code doesn't exist, or bad pattern |
|---|---|---|---|
| Signed out | "Sign in" | "Sign in" | "Sign in" |
| Signed in, not staff of that kind | where `resolve` sends them | "Nothing here for this account" (one shared page) | "Nothing here for this account" (the same page) |
| Staff of that kind, code in their own site or scope | where `resolve` sends them | where `resolve` sends them | "Not found" (Platform, 2026-11-10) |
| Staff of that kind, code in another site or scope | | "Not found" (the same as a code that doesn't exist) | "Not found" |

For staff, "theirs" means in their own site or scope (`isStaff({ user, scope, req })` is asked about the code's scope,
never staff anywhere). On a multi-site install, staff of site A scanning site B's code get exactly the "Not found" of a
code that doesn't exist.

The signed-in, not-staff page reads "Nothing here for this account", with a "Use another account" link. It's one shared
page for unknown, forbidden and malformed codes, so probing still learns nothing. "Sign in" is only for people who are
signed out.

- **No probing:** for anyone but staff in that scope, unknown, forbidden and malformed codes get the same page, with the same status
  (200) and the same body. No timing gap is made on purpose; the pattern check runs first in every case. Lookups are
  rate-limited, and over the limit the answer is the same page. Rate limits are per signed-in user, or per client
  address when signed out. The address comes from a `clientAddress(req)` option, as in Sign-up: never the first
  `x-forwarded-for` entry, which can be faked. On Vercel the site passes `x-real-ip`.
- **Nothing is logged** with the code next to a person. A count of refusals per kind is enough for abuse alerts.
- **A secret never travels in a scan link.** The kit bag's activation QR carries its secret in the link's fragment
  (D13), which browsers don't send to servers. Scan never sees it, and the activation wizard reads it in the browser.
- **The fragment across sign-in.** A signed-out buyer scans the bag QR and gets "Sign in". Server-side return URLs
  never carry a fragment, so Scan's "Sign in" page owns keeping it:
  - its own small script copies `location.hash` onto the return URL's fragment;
  - it never puts the fragment in a query string, cookie or storage;
  - after sign-in the browser lands on the same link with its fragment.

  The Sample Kits wizard reads the secret and then clears it from the address bar with `history.replaceState`, so it
  doesn't stay in history on a shared device. The secret may still sit in the history entry made before sign-in; the
  wizard's done screen says so on shared devices ("If this isn't your device, clear its browsing history").
- **Routes:**
  - Scan provides the server function `resolveScan({ kind, code, req })` and a page component.
  - The site keeps thin routes (`/k/[code]`, `/b/[box]`) that call it. A plugin can't add Next routes (as in Sample
    Kits' design).
  - There's also a Payload endpoint, `GET /api/scan/:kind/:code`, for apps (the iOS app later). It gives the same
    answers as JSON: `{ to }`, `{ signIn: true }` or `{ notFound: true }`.

## Adapters

- **Sample Kits** registers the kinds `k` and `b`: the patterns, kit staff of the site as `isStaff`, and the
  resolvers.
  - `k`: staff go to the kit's record, and the buyer or activator to the activation wizard on that kit.
  - `b`: staff go to the order with its expected kits, for returns that arrive unopened; the buyer goes to their
    order.
- **Kitting** gets `CameraScanButton` by its import-map path.
- **Wizards** (`payload-plugin-wizards`) can use `<Scanner>` or `CameraScanButton` in a step (the wizard's "find the
  kit"), named by path in the step's config.
- **No collections**, so nothing goes to Seed World (D8).

## Tests

- **The resolver table above,** row by row:
  - the same status and body for signed out, unknown, forbidden and malformed;
  - "Nothing here for this account" alike for signed-in people;
  - "Not found" for staff, including staff of another site scanning this site's code;
  - the rate limit giving the same answer;
  - `clientAddress` used, and a faked `x-forwarded-for` ignored.
- **The fragment survives sign-in:** the "Sign in" page's return link keeps `#…` and never moves it into a query.
  The wizard's `replaceState` is tested in Sample Kits.
- **Patterns are checked before lookups,** and providers aren't called on a malformed code.
- **The JSON endpoint gives the same answers** as the page.
- **The client:** typed entry, repeat suppression, the offline queue sends in order, refused camera falls back to
  typing (component tests with a fake detector).
- **A browser check at 375px:** big targets, the live region announces, keyboard only.

## Agreed (Plugins Lead, 2026-11-10)

- **One provider per kind.** Registering a kind twice is an error at startup.
- **A `terminators` option,** Enter and Tab by default.
- **Kitting takes `cameraComponent` as an import-map path** when it builds the station (its K10).
