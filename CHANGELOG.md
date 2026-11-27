# Changelog

## Unreleased

- Test audit after 0.1.0 (`docs/test-audit.md`): 20 server tests added for access through the endpoint with real sign-in, odd input, the checks that fail closed, and what the rate limit stores. No change to the plugin's code. Tested: 64 tests (34 server on in-memory MongoDB, 30 components and pages in jsdom), and each new test was seen to fail under a one-line change to the source. Not tested: a real camera, a real browser, a real site.

## 0.1.0 (unreleased)

First version, from design 0001 after review: scan-link answers by who is signed in with no probing, rate limits, a JSON endpoint, kinds from other plugins, the sign-in page that keeps the link's fragment, and the client Scanner, CameraScanButton and useScanner with typed and USB entry, repeat suppression, an in-memory offline queue and accessible announcements.

After the security read: the fragment kept as a fragment through sign-in, a browser-accurate off-site check, equal calls for real and missing codes, no table growth under a flood, and no double decoding.

Tested: 44 tests (14 server on in-memory MongoDB, 30 components and pages in jsdom). Not tested: a real camera, a real browser, a real site.
