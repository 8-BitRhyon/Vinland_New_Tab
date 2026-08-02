# Security Policy

## Supported versions

Vinland is a single active line of development on `main`. Security fixes land
in the latest release and are backported only where practical (it's a small
project — upgrading is the supported path).

| Version | Supported |
|---|---|
| latest release | ✅ |
| older releases | ⚠️ best-effort only |

## Reporting a vulnerability

**Please do not open a public issue for security bugs.**

Email the maintainer privately at the contact address on the repository
profile, or open a **private advisory** via GitHub:
Repository → **Security** → **Report a vulnerability**.

Please include:

- Which version(s) are affected
- A minimal repro (steps, or a snippet)
- Impact (what an attacker could do)
- Whether it's already known/patched upstream

You'll get an acknowledgment within a few days. We'll coordinate a fix and a
release, and credit you in the release notes if you'd like.

## Security model

Vinland is **local-first**: there is no server, no account, and no remote
datastore by default. Notes, tasks, and media stay in the browser
(localStorage + IndexedDB). The security-relevant surfaces are:

- **CSP** — a strict Content-Security-Policy is set in `manifest.json` and a
  meta CSP in `index.html`. `eval` and `new Function` are banned
  (`SafeCalculator` exists precisely because of this).
- **Markdown rendering** — the block editor renders user content through
  `markdownToHtml`, which sanitizes links (`javascript:` and other dangerous
  schemes are rejected and rendered as plain text) and neutralizes
  attribute-breakout payloads. This is covered by unit tests
  (`security-unit-tests`, `blockeditor-xss-guard`) and E2E
  (`paste-smoke` P5/P6).
- **Permissions** — the manifest asks for the minimum Chrome permissions
  needed (`bookmarks`, `storage`, `notifications`, `identity`, …). We do not
  request broad host permissions beyond the domains the weather, Drive, and
  bookmark features need.
- **Optional Google Drive sync** — OAuth2 with the narrow `drive.file` scope;
  the client id is a placeholder in source until you supply your own.

## Dependency policy

Vinland ships one vendored runtime dependency: **D3 v7 (BSD-3-Clause)** — its
copyright notice is preserved in the `d3.v7.min.js` header. Everything else is
vanilla. If you add a dependency, keep it vendored, license-compatible
(Apache-2.0 or permissive), preserve its license notice, and document it in
`docs/DEVELOPMENT.md`.
