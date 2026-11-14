# Security

PageStack holds the keys to a website: a GitHub token that can commit to its repo, and the sign-ins
of the people who edit it. Reports are welcome and taken seriously.

## Reporting a problem

Please don't open a public issue. Use GitHub's private reporting instead: **Security → Report a
vulnerability** on this repository. Include what you found, how to reproduce it, and the version
(`npm ls @pirateandfox/pagestack`). Expect a reply within a few days. Fixes ship as a new beta with a
**Security** note at the top of its CHANGELOG entry.

## Supported versions

PageStack is in beta. Only the newest release gets fixes; upgrade to it before reporting.

## How it is built to be safe

- The public site is static and loads no editor code. The editor runs on its own origin
  (for example `edit.example.com`), only when the host builds it with `EDITOR=1`.
- Sign-in is by passkey only (WebAuthn). There are no passwords to leak or guess. People join with
  a single-use invite link that expires after 3 days.
- The GitHub token stays on the server. The browser never sees it.
- Everything saved is checked against the site's schema, and rich text is sanitised. The sanitiser
  is tested against a spec-compliant HTML parser, including 20,000 generated tags.
- No inline event handlers can run anywhere on the editor's origin (`script-src-attr 'none'`).
  Previews and site pages shown in the editor run the site's own scripts and nothing from
  other origins.
- Sessions are signed cookies (`HttpOnly`, `SameSite=Lax`, `Secure` over https) and end when
  the person or the passkey is removed. Cross-site requests are refused. Sign-in is rate limited.

## Known limits (beta)

- Invite links made with the command-line tool (`pagestack-invite`) aren't listed on the Users
  screen, so they can't be withdrawn there. They expire after 3 days. Links made on the Users screen
  can be withdrawn.
- Editors can't add raw HTML, but they can publish everything else they save on sites without a
  staging branch (`github.live`). With one, only admins can publish.
