# Changelog

All notable changes to **Vinland** are tracked here. Version numbers follow
`manifest.json` (the Chrome Web Store version).

## [Unreleased]

### Added
- **Encryption at rest** (optional passphrase) — AES-256-GCM + PBKDF2-SHA256
  (600k iterations), self-describing `vinland-enc-v1` envelope that records its
  own KDF parameters, passphrase stored in `chrome.storage.local` (never in the
  exported config), anti-downgrade guard that refuses plaintext when encryption
  is enabled but no passphrase resolves.
- **Scheduled pull from Drive** — diff-aware auto-merge (notes/boards/canvases
  by `id`, tasks by `text`, newer `modified` wins; config never auto-merged),
  `AUTO PULL` interval + `LAST AUTO PULL` status in Settings → SYNC.
- **Proactive backup reminders** — nudge when no backup has run in a while.

### Changed
- **Sprint E hygiene (L1–L8)** — documented legacy config key, explicit
  coercion in `QueryEngine.evaluateCondition`, deduped boot comment, Pomodoro
  tick 100ms → 250ms, Clock interval aligned to second boundary,
  `GraphManager` uses `State.BOARDS`, calc-preview extracted into
  `js/editor/CalcPreview.js`.

## [V19.57] — 2026-08-01

### Added
- **Release-candidate gate**: `tests/release-candidate.playwright.spec.mjs`
  proves the extension works as a REAL Chrome extension (MV3 service worker,
  `chrome.identity`/`chrome.storage`, new-tab override).
- **Cloud Sync overhaul (V19.56)**: OAuth setup guide, token re-validation on
  init, canvas parity in backups, 401/403-aware Drive updates
  (refresh-once-then-retry, no duplicate files), canonical backup builder,
  honest Drive error messages, Drive-first auto-backup.
- **Packaging script**: `scripts/package-release.sh` builds the store-ready zip
  with an 80MB size guard + composition report.
- CI: dedicated `release-candidate` job in GitHub Actions.

### Fixed
- Missing `background.mp4` 404 on boot when no backgrounds configured — now
  falls back to a solid color.

## [V19.55] — 2026-07-31

### Added
- **Attachment Manager** — IndexedDB store + browser modal + insert flow.

### Refactored
- Editor/notes/canvas monoliths decomposed: `renderBlock()` dispatcher,
  `handleKeydown()` 21-helper dispatcher, `open()` and `bindEvents()` in
  NotesController split into extracted helpers (Phases 1–2f).

## [V19.47+ era] — 2026-07-26 → 2026-07-29

### Added
- **Settings UX overhaul** — live search across all config tabs, match-count
  badges, keyboard shortcuts (Cmd+, / Cmd+W), highlight animations, persisted
  search query.
- **Canvas**: auto-layout, zoom slider (10–500%), snap-to-grid + alignment
  tools, edge style picker (color/width/dashed), edge waypoints, auto-save +
  crash recovery, collapsible toolbar, empty-area context menu, tag filter bar,
  rich-text toolbar + block comment threads, keyboard nudging, node alignment.
- **Editor**: SlashMenu v2 (categories, recently used, always-visible search),
  floating formatting toolbar, in-editor find/replace (Cmd+F), block duplicate
  (Cmd+D), block-type badges, drag-to-reorder drop indicator, table column
  resize handles + reset, `/color` slash command, code block language selector,
  wiki-link autocomplete (creates new note when no match), note statistics
  panel, local D3 knowledge graph with hover effects + tooltips.
- **Graph**: live search/filter, rich DOM tooltips, zoom-to-fit connected
  subgraph on click, folder-based graph scoping dropdown.
- **Tasks**: recurring tasks (+daily/+weekly/+monthly), recurrence config
  panel, upgraded drag-to-reorder with grip handle + ghost + glow.
- **Nav**: browser history pushState/popState, breadcrumbs, side-by-side
  sidebar (drag-resizable), modal stack pill tabs.
- **QuickOpen**: 70 unit tests for search scoring/sorting/filtering/excerpts,
  canvas node search (Cmd+Shift+F).
- **CLI**: fuzzy command matching + match highlighting, CommandRegistry
  centralized, 41 unit tests.
- **Storage**: per-note sharding + orphaned shard recovery, onboarding.
- **Notifications**: OS-level pomodoro notifications, unhandledrejection
  handler, boot loader spinner.

## [2026-02 era] — earlier foundation

- Modular architecture (core / UI / feature / editor modules), CommandRegistry
  + Zen Mode, block schema migrations, weather via open-meteo, Smart Cards with
  interactive iframe shields, keyboard spawning, Phase 4/5 polish, initial
  README + design docs.

[Unreleased]: https://github.com/8-BitRhyon/Vinland_New_Tab
