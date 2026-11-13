# payload-plugin-scan

Scan for Payload: read barcodes and QR codes with a phone camera or a USB scanner, and answer scan links by who is signed in, without letting codes be probed.

**Status:** 0.1.0, not on npm yet. 44 tests pass. 14 are server tests, on Payload 3.92 with an in-memory MongoDB replica set: the answer table, no probing, rate limits, refusals and the JSON endpoint. 30 are component and page tests in jsdom, with a fake camera and a fake detector. Nothing has run on a real camera or in a real browser yet, and no site uses it.

## What it does

### Scan links

A **kind** is a short name a provider registers, for links like `…/k/<code>`. Each kind gives:
- a pattern, checked before anything is looked up;
- `scopeOf(code)`, its site (leave it out on a single-site install);
- `isStaff(user, scope)`;
- `resolve(code, user)`: where this person may go, or null.

`resolveScan(payload, { kind, code, req })` answers from who is signed in, never from the link:

| Who | A code they may see | Any other code, or not a code |
| --- | --- | --- |
| Signed out | "Sign in" | "Sign in" |
| Signed in | where `resolve` sends them | one shared "Nothing here for this account" |
| Staff of that kind, in the code's site | the record | "Not found" |
| Staff of another site | | "Not found", the same as a code that doesn't exist |

Over the rate limit, everyone signed in gets the quiet "Nothing here" page, staff included.

- **No probing.** For anyone but staff in that site, unknown, forbidden and malformed codes get the same answer. Signed-out scans never look anything up. A malformed code never reaches the provider. A real code and a missing one make the same calls, so timing says little (not measured, so not promised).
- **Rate limits:** 30 lookups a minute per signed-in person (`perMinute`). Over the limit, the answer is the same quiet page, and nothing more is stored, so a flood can't grow the table.
- **Fails closed:** a provider that fails, or a lookup that can't be checked, answers as if the code didn't exist for that person.
- **Never sends anyone off the site:** an answer is resolved the way a browser would, and refused unless it stays on your site (`//x`, `/\x` and paths with tabs or newlines are refused).
- **On a multi-site install, give every kind `scopeOf`.** Without it, staff of any site count as staff for every code.
- **Nothing is logged** with the code next to a person. `onRefusal` gets the kind and the outcome only, for abuse alerts.
- **For apps,** `GET /api/scan/:kind/:code` gives the same answers as JSON, never cached: `{ to }`, `{ signIn: true }`, `{ nothingHere: true }` or `{ notFound: true }`.
- **Other plugins register kinds** at `config.custom.scanKinds` (`[{ owner, kinds }]`), with no import, in any plugin order. A kind registered twice stops the site at start-up.

A plugin can't add Next routes, so your site keeps thin routes (`/k/[code]`) that call `resolveScan` and redirect, or show one of the pages from `@extantape/payload-plugin-scan/pages`:
- `ScanSignIn` keeps the link's fragment (where an activation secret travels) as the sign-in link's own fragment, so no server ever sees it: never in a query, a cookie or storage. Your sign-in page puts `location.hash` back on the return URL in the browser when it redirects: never in a form post or a query. Keep third-party scripts off that page, since any script there can read the fragment.
- `ScanNothingHere` has a "Use another account" link.
- `ScanNotFound`.

### Reading codes (`@extantape/payload-plugin-scan/client`)

- **`<Scanner onScan={…} />`:**
  - **Camera:** reads continuously once the person presses "Use camera". It uses the browser's `BarcodeDetector`, or a reader your site provides (`detector`), for example a ZXing WebAssembly build served from your own domain. Nothing loads from a CDN, and without a reader the camera isn't asked for.
  - **Typed and USB entry** always work: a USB scanner is a keyboard. Enter or Tab submits, and Tab only when the field has text.
  - **Repeats:** the same code held in view counts once within `repeatMs` (2.5 seconds). Typed entries always count.
  - **Announcing:** results are announced in a polite live region, in words, and a refusal is shown as text, not color alone.
  - **Count and Undo:** a running count, and Undo when you give `onUndo`.
  - **Offline:**
    - scans wait in memory only (never web storage, so codes don't linger on a shared device);
    - they're sent in order when the connection is back;
    - the screen says "N scans waiting to send. Keep this page open", with a "Try sending now" button.
  - **Feedback and targets:** sound and vibration can each be switched off, and every control has a keyboard path and a 44px target.
- **`<CameraScanButton onResult={…} />`:** opens the camera in a dialog, reads one code and closes. Escape closes it, and focus goes back to the button. Kitting's packing station, once it's built, is designed to take it by import-map path.
- **`useScanner({ … })`:** the same, without the UI.

## On its own, and with others

**On its own:** Scan needs only Payload. Your site passes its own link kinds in `kinds` and keeps a thin Next route for each, and the client scanner (`./client`) needs no server part.

**Works with:**
- **Sample Kits:** with `adapters.scan` on, Sample Kits registers the `k` (kit) and `b` (shipping box) kinds at `config.custom.scanKinds`.
- **Wizards:** a flow's code step can show `<CameraScanButton>`, for example to find a kit. Wizards doesn't import Scan; your site renders the step.
- **Kitting** (designed, not built): Kitting's packing station plans to take `<CameraScanButton>` as an optional camera adapter, by import-map path.

**Family:** Scan sits in the Fulfillment family, with Kitting, Restock, Sample Kits, Shipping, Labels, Wizards, Custody and Sequences, though the families are a working draft and Fulfillment is due to be split into different groups.

## Install

```sh
npm install @extantape/payload-plugin-scan
```

```ts
import { scanPlugin } from '@extantape/payload-plugin-scan'

scanPlugin({
  kinds: {
    k: {
      pattern: /^\d{12}$/,
      scopeOf: async ({ code }) => siteOfKit(code),
      isStaff: async ({ user, scope }) => isKitStaff(user, scope),
      resolve: async ({ code, user, staff }) => (staff ? { to: `/kits/${code}` } : buyerLink(code, user)),
    },
  },
})
```

Build the collections' indexes before first use.

## Limits

- The rate limit stores hashed keys only, with each lookup recorded and then counted, so a burst at the same moment can be refused a little early, never let through.
- The fragment survives sign-in only if your sign-in page carries `location.hash` onto the return URL when it redirects.
- Not tried on a real camera yet.

## Commands

```sh
npm test          # server and component tests
npm run typecheck
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
