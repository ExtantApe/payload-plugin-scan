# Test audit

Kept by this repo's maintainers: after each feature or fix, and at least every 14 days while it changes. Newest first.

## 2026-11-26: sweep after 0.1.0

Scope: every promise in the README and `docs/decisions.md`, mapped to the test that proves it. 20 server tests added in `test/guards.test.ts`, none removed. 64 tests now: 34 server, 30 component and page.

- **Promises**
  - Answers: the table of who gets what (signed out, signed in, staff of the code's site, staff of another site).
  - No probing: one answer for unknown, forbidden and malformed codes; a signed-out scan looks nothing up; a malformed code never reaches the provider.
  - Rate limit: 30 a minute per signed-in person, the quiet answer over it for staff too, hashed keys only, no table growth under a flood, a burst never let through.
  - Fails closed: a provider that fails, or a lookup that can't be checked, answers quietly.
  - Never sends anyone off the site.
  - Nothing is logged with the code next to a person; `onRefusal` gets the kind and the outcome only.
  - The JSON endpoint gives the same answers, never cached.
  - Kinds from other plugins in any order; a kind registered twice stops start-up.
  - `ScanSignIn` keeps the fragment as a fragment.
  - The client: camera only after "Use camera", a site-provided reader, typed and USB entry, repeats, announcing, count and Undo, the offline queue in memory only, switches for sound and vibration, keyboard paths and 44px targets, `CameraScanButton` and `useScanner`.
- **Covered**
  - Signed out, or signed in to another collection: Sign in, by `test/scan.test.ts: asks a signed-out person…` and `test/guards.test.ts: asks for sign-in without a session, with a bad token, or with an account from another collection` (real tokens through the endpoint).
  - A signed-out scan looks nothing up and stores nothing, by `test/guards.test.ts: looks nothing up and stores nothing for a signed-out scan`.
  - The buyer's link and the staff record, by `test/scan.test.ts: sends the buyer…`, `sends staff…` and `test/guards.test.ts: sends the buyer and the site’s staff to their own pages`.
  - One quiet answer for anyone signed in, byte for byte with its headers, by `test/guards.test.ts: gives a signed-in person the same response…`.
  - Staff of another site get the Not found of a missing code, by `test/scan.test.ts: sends staff…`, `never tells resolve a person is staff for a code that has no site` and `test/guards.test.ts: gives staff of one site the same Not found…`.
  - A malformed code never reaches the provider, by `test/scan.test.ts: never asks the provider about a malformed code` and `test/guards.test.ts: refuses a code that isn’t a plain string…`, `never hands the provider a code dressed up as a query…`, `stops a code over 200 characters…`.
  - A scanner's trailing newline, by `test/guards.test.ts: reads a code with a scanner’s trailing newline…`.
  - Rate limit per person, by `test/scan.test.ts: rate-limits lookups…`, `doesn’t grow the attempts table…` and `test/guards.test.ts: counts one limit per person across every kind…`, `lets no more than the limit through…`.
  - Hashed keys only and a closed table, by `test/guards.test.ts: stores a hash for the person…` and `keeps the attempts table closed to everyone…`.
  - Fails closed, by `test/scan.test.ts: answers quietly when a provider fails` and `test/guards.test.ts: answers quietly when the provider’s lookup fails…`, `answers quietly, and asks the provider nothing, when the rate limit can’t be checked`, `gives the same answers when onRefusal fails`, `stops the site at start-up over a kind with an unusable name or a missing part`, `refuses a rate limit that would switch the limit off`.
  - Never off the site, by `test/scan.test.ts: never sends anyone off the site` and `keeps every answer on the site, however the path is dressed up`.
  - Nothing logged, by `test/scan.test.ts: counts refusals by kind and outcome only…`, `answers an odd code in the URL…` and `test/guards.test.ts: writes no code and no person to the log…`, `treats names every object has as unknown kinds…`.
  - The JSON endpoint, by `test/scan.test.ts: gives apps the same answers as JSON, never cached` and the four endpoint tests in `test/guards.test.ts`, which cover all four shapes.
  - Kinds from other plugins and duplicates, by `test/scan.test.ts: takes kinds from other plugins, and refuses a kind registered twice`.
  - The fragment, by `test/pages/ScanSignIn.test.tsx: keeps the link’s fragment as a fragment…`.
  - The client, by `test/client/Scanner.test.tsx` (22), `test/client/CameraScanButton.test.tsx` (5) and `test/client/useScanner.test.tsx` (2). No change this sweep.
- **Gaps added** (all in `test/guards.test.ts`; each was seen to fail under a one-line change to the source, 26 changes in all, then pass again with the source restored)
  - Access through the endpoint with real sign-in: five tests. Before this, the endpoint was only tested signed out, so three of its four JSON shapes had no test.
  - Input: codes that aren't strings, codes shaped like queries, the 200-character cap on its own, trimming, and kind names every object has.
  - Fail closed: `resolve` or `scopeOf` failing, the rate limit store failing, `onRefusal` failing, broken kinds at start-up, and a `perMinute` that would switch the limit off.
  - The rate limit: one limit across kinds (unknown ones included), staff quieted over it, a burst at the same moment, hashed keys, the closed attempts table, and no code or person in the log.
- **Gaps skipped**
  - A real camera, a real browser and a real site: the component tests use fakes, as the README says.
  - The fragment surviving a real sign-in: the site's own sign-in page decides that.
  - Timing between a real code and a missing one: the README doesn't promise it. The equal calls are covered by the call lists in the tests above.
  - "Nothing loads from a CDN": the package has no network code to test. Checked by reading `src/client`.
  - Sound and vibration switches: not tested, since jsdom has neither. Small, and worth adding with fakes in the next client change.
  - Rows older than ten minutes being cleared: housekeeping, with no promise attached.
  - A kind without `scopeOf` on a multi-site install: the README states it as a limit of the setup, so there is no guard to test.
  - Sample Kits, Wizards and Kitting working with Scan: those belong to their own repos.

## 2026-11-10: 0.1.0

| Promise | Test |
| --- | --- |
| Signed out: Sign in, no lookup; another sign-in collection counts as signed out | `the answer table > asks a signed-out person…` |
| Signed in: the buyer's link; one quiet answer for everything else, unknown kinds included | `the answer table > sends the buyer…` |
| Staff: the record in their site; Not found for another site, unknown and malformed | `the answer table > sends staff…` |
| A malformed code never reaches the provider | `the answer table > never asks the provider…` |
| A failing provider answers quietly; kinds from other plugins; duplicates stop start-up | `the answer table` (2) |
| Never off-site (with a control case) | `the answer table > never sends anyone off the site` |
| Rate limit per person, quiet over it | `limits and logging > rate-limits…` |
| Refusals counted by kind and outcome only | `limits and logging > counts refusals…` |
| The JSON endpoint, never cached | `limits and logging > gives apps…` |
| The client: typed and USB entry, Tab, repeats, the live region, a refused camera, the offline queue, no web storage, the dialog, stopping tracks | `test/client/*` (29) |

Mutation check on the server's guards: 8 of 8 caught, two only after tests were added (a call counter for malformed codes, and a control case for the off-site check).

Gaps skipped: a real camera and browser (the component tests use fakes), and the fragment surviving a real sign-in (the site's sign-in page decides).

## 2026-11-10: after the security read of a858ef3

Added: the fragment stays a fragment (jsdom), answers that would leave the site in any dressing, no staff flag for a code without a site, a flood adds no rows past the limit, an odd URL code answers without an error, and unknown kinds are labeled as unknown. A mutation check catches all four new guards.
