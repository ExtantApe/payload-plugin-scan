# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-10: 0.1.0 (K291)

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
