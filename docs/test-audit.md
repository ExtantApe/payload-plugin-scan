# Test audit

Kept by this repo's maintainers: after each feature or fix, and at least every 14 days while it changes. Newest first.

## 2026-11-26: the second security read

| Promise | Test |
| --- | --- |
| A code with no site, or an undefined site, never makes anyone staff | `what the security read found > never tells resolve…` (2) |
| Loose site answers (`''`, blank, `0`, `-1`, `1.5`, `NaN`, `false`, a list, an object) never count as a site, against a host whose isStaff treats a falsy scope as any site | `what the security read found > never counts a loose site answer…` |
| /g, /y and /gy patterns accept a good code on every scan | `what the security read found > accepts a good code…` |
| A frozen pattern, plain or /g, still matches (it threw before, so every scan answered quietly) | `what the security read found > works with a frozen pattern…` |
| A non-function `scopeOf` stops start-up; `false` and leaving it out are accepted | `what the security read found > refuses to start with a scopeOf…` |
| A flood adds no rows past the limit | `what the security read found > doesn’t grow the attempts table…` |
| An odd code in the URL answers without an error; unknown kinds are labeled unknown | `what the security read found > answers an odd code…` |

Gaps skipped: a burst of truly simultaneous lookups (rows can exceed the limit for an instant, documented in the README, and the let-through count is bounded by the code's own check). Staff telling a throwing `scopeOf` apart from a missing code is a known limit, staff-only. Loose `users` and `onRefusal` options are not yet checked at start-up; noted for the next pass.

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
