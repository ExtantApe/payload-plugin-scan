# Changelog

## 0.1.0 (unreleased)

First version, from design 0001 after review: scan-link answers by who is signed in with no probing, rate limits, a JSON endpoint, kinds from other plugins, the sign-in page that keeps the link's fragment, and the client Scanner, CameraScanButton and useScanner with typed and USB entry, repeat suppression, an in-memory offline queue and accessible announcements.

After the security read: the fragment kept as a fragment through sign-in, a browser-accurate off-site check, equal calls for real and missing codes, no table growth under a flood, and no double decoding.

After the second security read (2026-11-26): a site answer counts only when it's a non-empty string or a whole number of 1 or more, so a loose answer such as `''`, `0` or `undefined` can't make staff of one site staff of another. Patterns with the g or y flag match the same on every scan, and the host's pattern is never written to, so a frozen pattern works too. A `scopeOf` that isn't a function stops start-up. The README says how a burst can store a few extra attempt rows.

Tested: 49 tests (19 server on in-memory MongoDB, 30 components and pages in jsdom). Not tested: a real camera, a real browser, a real site.
