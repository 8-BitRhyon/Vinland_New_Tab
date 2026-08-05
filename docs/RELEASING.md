# RELEASING — Cutting a Vinland Release

> How to cut a store-ready release of Vinland and publish it as a GitHub Release.
> This is the exact checklist we follow — including the gotchas we've hit in the
> wild (tag-vs-zip drift, moving tags on existing releases, visibility flips).

## 0. TL;DR

1. Bump `manifest.json` (authoritative) + mirror `package.json`, update `CHANGELOG.md`.
2. Commit + push. Wait for the full CI matrix to go green.
3. `./scripts/package-release.sh` → `dist/vinland-v<version>.zip`.
4. Push — the release workflow auto-tags + builds + **drafts** v<version>; review and publish.
5. Verify the **tag ref** (not the release metadata) points at the intended commit.

## 1. Version sources

| File | Role |
|---|---|
| `manifest.json` → `version` | **Authoritative** — this is what the Chrome Web Store shows |
| `package.json` → `version` | Mirror — keep in sync (format `x.y.z`) |
| `CHANGELOG.md` | Release history — add an entry every release |

## 2. Step-by-step

### 2.1 Bump the version

```bash
# manifest.json (source of truth — e.g. 19.58):
#   "version": "19.58"
# package.json mirror:
#   "version": "19.58.0"
```

Move the `[Unreleased]` section of `CHANGELOG.md` under a new `## [19.58]` heading
(with a `- 2026-…` date), then start a fresh `[Unreleased]`.

### 2.2 Validate locally before pushing

```bash
npm test                 # all unit suites (tests/run-all.mjs)
npx playwright test tests/<affected-spec>.playwright.spec.mjs   # E2E for changed areas
npm run docs:check       # inventory drift gate (CI enforces this anyway)
```

### 2.3 Commit + push, then wait for the full CI matrix

The `ci.yml` matrix (all must be green before releasing):

| Job | What it proves |
|---|---|
| `unit-tests` | Unit suites + `npm run docs:check` drift gate |
| `e2e` (4 shards) | Playwright E2E across the app |
| `cli-sweep` | `tests/cli-commands.playwright.spec.mjs` — all CLI commands |
| `release-candidate` | Real-extension gate (MV3 service worker, `chrome.identity`, new-tab override) |
| `package-check` | Builds the store zip on push; fails on bloat |
| `firefox-build` + `firefox-smoke` | Firefox/Zen merge + headless-Firefox load test |

```bash
gh run watch            # wait until green
```

### 2.4 Build the store zip

```bash
./scripts/package-release.sh
```

- Reads the version from `manifest.json` → writes `dist/vinland-v<version>.zip`.
- **Size guard:** fails loudly above 80 MB (the Chrome Web Store hard-caps at 100 MB).
- Prints a **composition report** (10 largest included paths) — review it for asset bloat.
- Excludes dev/test tooling (`docs/`, `scripts/`, `tests/`, `node_modules/`, `package.json`, `.git/`).
  Note the `.Git/` (capital-G) exclusion — that's the `.git/` variant on case-insensitive
  APFS; the case-sensitive `*.git*` pattern alone misses it (it once shipped a 17 MB pack file).

Sanity-check the zip:

```bash
unzip -l dist/vinland-v<version>.zip | grep -E 'manifest.json|CHANGELOG|README'   # manifest in, docs out
unzip -p dist/vinland-v<version>.zip manifest.json | grep '"version"'              # version matches
```

### 2.5 Create the release (new version)

**Automated path (default).** `.github/workflows/release.yml` drafts the release for
you whenever `manifest.json`'s version changes on `main`:

1. Detects the bump by diffing the version against the last `v*` tag.
2. Creates/pushes the `v<version>` tag on the pushed commit (skips if it exists).
3. Builds the zip via `./scripts/package-release.sh`.
4. Generates notes via `scripts/make-release-notes.sh <old> <new>` (template + commit list).
5. Creates a **draft** release with the zip attached — never publishes automatically.

Then review the draft (add a "What's new" section), confirm CI on `main` is green,
and hit **Publish**. Re-run a failed attempt with `workflow_dispatch` + `force: true`.

**Manual fallback** (same shape the workflow runs):

```bash
bash scripts/make-release-notes.sh 19.57 19.58 > /tmp/vinland-release-notes.md
gh release create v19.58 \
  --title "Vinland v19.58" \
  --notes-file /tmp/vinland-release-notes.md \
  --draft \
  dist/vinland-v19.58.zip
```

`gh release create` tags `main` automatically — the tag **is** the release. If a tag
with that name already exists remotely (you're fixing an old release), see §3.

### 2.6 Verify

```bash
gh release view v<version> --json tagName,targetCommitish,isDraft,isPrerelease,name
git ls-remote --tags origin | grep v<version>       # ← the ref users actually get
gh repo view <owner>/<repo> --json visibility
```

`git ls-remote` **must** show the commit you intended. That ref is what a
`git clone --branch v<version>` resolves — not the release's `targetCommitish` field.

## 3. Gotcha: fixing an existing release (tag vs zip drift)

**The incident (v19.57):** the `v19.57` tag pointed at the old RC commit (~20 commits
behind `main` — pre-encryption, pre-scheduled-pull, pre-hygiene-sprint), while the
uploaded zip contained the *new* code. Anyone cloning `--branch v19.57` got stale code.

**Why it happens:** a release's `targetCommitish` is **frozen at creation**.
`gh release edit --target <sha>` fails with `Release.target_commitish is invalid`.
Moving the **tag ref** is the only fix — and the tag ref is what governs checkout/clone,
so it's the thing that actually matters.

**Fix — move the tag, rebuild, re-upload:**

```bash
# 1. Move the tag (local way):
git tag -f v19.57 <full-sha> && git push -f origin v19.57

# 1b. Or via the API — use this if local `git tag` hangs (we hit exactly this):
gh api -X PATCH repos/<owner>/<repo>/git/refs/tags/v19.57 \
  -f sha=<full-sha> -F force=true
#    ^ `-F` (typed value) NOT `-f` (string) — `-f force=true` gets a 422:
#      "'true' is not a boolean."

# 2. Rebuild the zip from the correct tree, then replace the asset:
./scripts/package-release.sh
gh release upload v19.57 dist/vinland-v19.57.zip --clobber
#    ^ `--clobber` is required to replace an existing asset.

# 3. Verify the tag ref moved:
git ls-remote --tags origin | grep v19.57   # → must now show the new sha
```

**Notes & risks**

- After a tag move, the release page's `targetCommitish` metadata still displays the
  **original** creation commit. Cosmetic only — the tag ref is authoritative.
- If anyone already fetched the old tag, force-moving it can confuse their clones
  (fetch warnings like `tags have diverged`). Consumers can resolve with
  `git fetch --tags --force`. Going forward, prefer cutting a **new version tag**;
  only move a tag when it was never really consumed publicly (e.g. a pre-public RC).

## 4. Gotcha: flipping a repo public

```bash
gh repo edit <owner>/<repo> --visibility public \
  --accept-visibility-change-consequences
```

The `--accept-visibility-change-consequences` flag is **mandatory** — without it gh
prints usage and exits without doing anything. Verify with
`gh repo view <owner>/<repo> --json visibility` (expect `PUBLIC`). Before flipping,
scan for secrets: `grep -rInE '(api[_-]?key|secret|token|password)' --include='*.js' --include='*.json' .`

## 5. Release-notes template

```markdown
# Vinland v<version>

**Terminal-style new-tab command center by Rhyon** — notes, canvas boards, tasks,
search, templates, Google Drive sync, and 34 CLI commands in your new tab.

## What's new

- **<Feature headline>** — 1–2 sentences of user value.
- **<Second feature>** — same pattern. Keep bullets tight; group under bold lead-ins.
- _(Structure sections the way the change deserves: features, fixes, hardening, docs.)_

## Install (easy)

1. Download `vinland-v<version>.zip` below.
2. Unzip it anywhere (e.g. `~/Downloads/vinland-v<version>/`).
3. Open **chrome://extensions**, toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.
5. Open a new tab — Vinland boots.

**Firefox / Zen:** unzip, open `about:debugging#/runtime/this-firefox`, click
**Load Temporary Add-on**, and select `manifest.json` from the unzipped folder.

That's it. No build step, no dependencies to install.

## Notes & honest caveats

- **Google Drive sync** requires you to bring your own OAuth Client ID (see
  `docs/google-drive-sync.md`) — the store build ships without embedded credentials.
  Firefox/Zen use the `launchWebAuthFlow` path.
- Encryption is optional and opt-in; without a passphrase backups are plaintext JSON.
- Full history: [`CHANGELOG.md`](https://github.com/<owner>/<repo>/blob/main/CHANGELOG.md)
```

## 6. Release checklist (final gate)

- [ ] `manifest.json` bumped; `package.json` mirrored; `CHANGELOG.md` updated
- [ ] Local validation green (`npm test`, affected E2E, `npm run docs:check`)
- [ ] Pushed; full CI matrix green (incl. `package-check`, `firefox-smoke`, `release-candidate`)
- [ ] `./scripts/package-release.sh` built the zip; composition report reviewed; size < 80 MB
- [ ] Release drafted (automatically by `.github/workflows/release.yml`, or manually per §2.5) with the zip attached
- [ ] `git ls-remote --tags origin | grep v<version>` shows the intended commit
- [ ] Release notes cover: what's new, install instructions (Chrome + Firefox), honest caveats
