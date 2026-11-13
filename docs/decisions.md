# Decisions

Dated decisions for this repo, newest last.

- 2026-11-10: created from the standard repo starter kit.
- 2026-11-10: name approved by the owner: Scan, `@extantape/payload-plugin-scan`, tags barcode and qr. Built with the kits work. Design: `docs/architecture/0001-design.md`.
- 2026-11-10: MIT (a general Payload plugin); public from the first push after the audit, which the owner approves. No family tag.
- 2026-11-10: scan links answer by who is signed in: "Sign in" alike for signed out, unknown, forbidden and malformed; "Not found" only for staff (the platform team, 2026-11-10). Activation secrets never travel through Scan: they stay in the link's fragment, which browsers don't send.
- 2026-11-10: signed-out scans never look anything up, so they need no rate limit and no client address; signed-in lookups are limited per person. Client choices where the design was silent: repeat suppression for camera reads only, Tab submits only with text, Undo only when the site handles it, offline scans queue behind any waiting ones, and a "Try sending now" button.
- 2026-11-10 (security read of a858ef3): the sign-in page keeps the fragment as its own link's fragment, since a fragment inside the encoded redirect query reaches the server, and secrets must stay in the fragment; answers are resolved like a browser would and refused unless they stay on the site; both isStaff calls are made every time; a flooder past the limit adds no rows; route params aren't decoded twice. Keywords follow the shared plugin tag list (`ecommerce`).
