# Vinland — Developer Guide

This guide is the home for the architectural and "why" knowledge that used to
live as multi-line comments inside the source. The codebase is intentionally
comment-lean: short single-line `//` comments stay where they clarify the
immediate line, and everything of substance lives here (and in
`docs/design.md`, which remains the canonical design document).

---

## 1. Architecture overview

Vinland is a **Manifest V3 Chrome extension** with zero build step: no
framework, no bundler, no npm artifacts shipped.

- `manifest.json` — MV3, `chrome_url_overrides.newtab = index.html`.
- `index.html` — the entire shell + CSS + the two script tags that bootstrap
  the app: `./d3.v7.min.js` (vendored, for graph/canvas) and
  `js/boot.js` (ES module).
- `js/boot.js` — the **only** entry module. It imports and mounts every
  subsystem onto `window` (e.g. `State`, `Storage`, `ModalManager`,
  `BlockEditor`, `NotesController`, …) and wires global keybindings.
- Everything else is a plain ES module that attaches itself to globals at
  import time — no framework DI, no import graph beyond direct imports.

> **Golden rule for contributors:** the app runs entirely from globals mounted
> by `boot.js`. A new feature module is a file that defines an object, mounts
> it on `window`, and is imported from `boot.js` (or from the module that owns
> its lifecycle).

### Boot order (high level)

1. `index.html` loads d3 + `js/boot.js`.
2. `boot.js` imports core (State, Storage, MetadataCache, …), then features
   (HUD, command registry, CLI), then the workspace (BlockEditor,
   NotesController, CanvasManager, GraphManager), then UI (ModalManager,
   SettingsUI, Sidebar, …).
3. Modules call their `init()` during import or on `DOMContentLoaded` —
   each module documents when it expects to run.

### Directory map

| Path | Purpose |
|---|---|
| `js/background/` | MV3 background service worker (bookmark indexing, context menus) |
| `js/core/` | State, storage, metadata/query engines, global input, command registry, utils |
| `js/editor/` | BlockEditor engine + PageManager (markdown ↔ blocks) + HistoryManager (undo/redo) |
| `js/features/` | Feature modules: HUD widgets, PKM tools (calendar, kanban, flashcards, quick-open, dataview, version history, backup, importer, …) |
| `js/modules/` | NotesController, CanvasManager, GraphManager, KanbanManager |
| `js/ui/` | ModalManager, Sidebar, SettingsUI, hover previews, format toolbar, autocomplete, tab manager |
| `js/config/` | Static configuration + the CLI command definitions (SystemCommands) |

---

## 2. Core layer (`js/core/`)

### State + Store

- One global `State` object on `window` is the source of truth
  (`State.NOTES`, `State.SETTINGS`, …).
- **`State.NOTE_MAP` (id→note) + `State.NOTE_TITLE_MAP` (lowercased
  title→note)** are O(1) lookup maps over `State.NOTES`:
  - Maps hold **references** to the same note objects — in-place edits
    (content, blocks, title) need zero sync.
  - **Lazy rebuild:** maps rebuild O(n) only when the array reference changed,
    the length changed, or a dirty flag is set.
  - **Split invalidation:** the id map stays warm across saves (ids never
    mutate in place); the title map is marked stale by `Storage` after saves
    and imports (catches in-place renames).
  - Use `State.getNote(id)` / `State.getNoteByTitle(title)` instead of
    `State.NOTES.find(...)` — the hot paths were migrated for a reason.

### Storage

- **localStorage** is sharded by a key prefix (per-note keys + an index).
  Writes go through `saveData`/`saveAllNotes`, which update the dirty-set and
  throttle full-index writes (see `MetadataCache` for the debounced index).
- **IndexedDB (`OPERATOR_VAULT`)** holds media assets, canvas offload, and
  version history. Version history is compacted (see
  `VersionHistoryManager` in §4): per-note cap of 50 snapshots, plus a
  boot-time `prune()` that removes orphaned stores and trims oversized ones.
- `clearAllNotes`, `saveAllNotes`, `loadData` invalidate the lookup maps.

### MetadataCache

- Builds an index over every note: **frontmatter** (YAML parsed defensively),
  **tags** (#hashtags + frontmatter tags), and **wiki links** (`[[Page]]`,
  `[[Page|Alias]]`).
- Maintains a **backlink index** (`updateLinkIndex`) used by the graph and
  hover previews.
- Persists to localStorage, debounced; on load it only trusts the cache if it
  is schema-valid AND its **vault fingerprint** (note count + newest modified
  timestamp + rolling hash of note ids) matches — otherwise it rebuilds.
- `updateNote`/`removeNote` are called by the notes lifecycle; deletion paths
  must mirror the `MetadataCache` guard pattern.

### QueryEngine + DataviewQuery

- `QueryEngine` parses `FROM … WHERE … SORT …` strings into a structured
  query object, evaluates WHERE conditions against metadata (nested props
  like `file.name` supported), formats results (list/table/task), and
  **always escapes HTML** before rendering.
- `DataviewQuery` (in `js/features/`) is the user-facing modal that composes
  queries against `MetadataCache` — property lookup checks frontmatter first,
  then computed fields (title, path, modified, created).

### AttachmentsManager

- Uploads files into IndexedDB; exposes **cached object URLs** for fast
  access, **data URLs** for block renderers that need `src`, and
  **thumbnail object URLs** (canvas-scaled downscales) for grids.
- Deletion revokes cached object URLs. Tracks total storage usage.

### CommandRegistry + SafeCalculator + Input + Audio

- Command registry: fuzzy match (`score` + aligned `matched` mask), register
  and query — powers the command palette and the CLI.
- SafeCalculator is a **CSP-compliant** arithmetic evaluator (no `eval`).
- `Input.js` — global keyboard shortcuts (extracted from the original
  single-file `vinland.js`); capture-phase handlers for tab switching etc.
- Audio — "better sounds" module; wraps WebAudio, no external assets.

---

## 3. Editor (`js/editor/`)

### BlockEditor

The core editing engine. Key responsibilities:

- **`markdownToHtml`** — block-level markdown renderer. **Security-critical:**
  link URLs are sanitized (dangerous schemes like `javascript:` are rejected
  and the link renders as plain text; quoted-URL attribute breakout is
  neutralized). This is covered by unit tests (`security-unit-tests`,
  `blockeditor-xss-guard`) and E2E (`paste-smoke` P5/P6) — do not regress it.
- **`highlightSyntax`** — inline code highlighting; extended per-language by
  `CodeBlockTools`.
- **`renderBlock`** — builds the shared block chrome (drag handle, type
  badge, duplicate button, level indent, alignment, color) per block.
- Blocks are contenteditable; typing stays raw text until a re-render
  (Enter-split, paste, command) sends content through `markdownToHtml`.
- Per-block listeners are the current architecture (container delegation is a
  known optimization opportunity — see the audit doc).

### PageManager

- **`parseMarkdownToBlocks`** — converts note markdown into the block array.
- Extracts `[[wiki links]]`; sanitizes file paths.
- `addBlock`/`updateBlock`/`deleteBlock` are the per-block mutation
  chokepoints — all use `State.getNote()` for O(1) page lookup.

### HistoryManager (inside BlockEditor)

- Git-style undo/redo over block snapshots, wired into the editor keybindings.

---

## 4. Features (`js/features/`)

| Module | What it does |
|---|---|
| **QuickOpen** | VS Code-style palette (Cmd+P) — unified search across notes, tags, and commands; content-search mode (Cmd+Shift+F). |
| **VersionHistoryManager** | Git-style note versioning in IndexedDB: captures snapshots (cap 50/note), computes diffs, supports rollback. `prune()` = boot-time compaction (orphans + oversized stores); `removeNote()` purges a note's history on deletion. |
| **FlashcardManager** | Spaced repetition (SM-2): cloze parsing (`{c1::text::hint}` and `::text::`), incremental extraction from notes (per-note rescan when a noteId is given), review sessions with promise chaining (not setTimeout), stats. |
| **Calendar / DailyAgenda** | Date-indexed note views: month grid (Calendar) and week/month agenda (DailyAgenda); keyboard navigation, note pickers, day-cell links. |
| **DataviewQuery** | See §2. |
| **BackupManager** | Auto-backup timer, full-vault backup to JSON, download, and **Google Drive sync** (OAuth2, `drive.file` scope; state persisted in localStorage). |
| **ObsidianImporter** | Imports Obsidian-style vaults (markdown + attachments). |
| **Bookmarks / Dock** | Chrome bookmarks index into a bottom bar; Dock = quick-launch links (config lists). |
| **CanvasSearch** | Find-in-canvas overlay (Cmd+F) over CanvasManager: search nodes by title/content/label, keyboard navigation, scroll-to-node. |
| **CodeBlockTools** | Code blocks get line numbers, copy button, Tab/Shift+Tab indent/unindent, language cycling, and extended syntax highlighting (JS, Python, HTML, CSS, Bash). |
| **TagBrowser** | Browse/filter by tag. |
| **CommandLineInterface** | The CLI layer that dispatches typed commands (wired to the command registry). |
| **WorkspaceManager** | Tab/session persistence for the workspace. |

---

## 5. Modules (`js/modules/`)

- **NotesController** — note CRUD, `openByTitle`, transclusion, template
  resolution, frontmatter injection. Contains standalone helpers (HTML
  escaping, line-break handling). Guards against `sessionStorage` full.
- **CanvasManager** — infinite spatial canvas: nodes/edges, lasso select,
  undo/redo, minimap, zoom slider, tag filter bar, auto-save status
  indicator, toolbar collapse toggle, edge hover glow. Node pinning
  (fx/fy freeze), layout reset, camera fit.
- **GraphManager** — D3 force-directed knowledge graph derived from wiki
  links: pin/unpin/reset layout, zoom-to-fit, single-click zooms to the
  clicked node's connected subgraph (BFS full chain), folder filter dropdown,
  hover previews.
- **KanbanManager** — multi-column boards with vim nav and drag-and-drop.

---

## 6. UI layer (`js/ui/`)

- **ModalManager** — the core modal stack (open/close, stack ordering).
- **Sidebar** — builds a logical folder tree from the flat notes list
  (recursive helpers: `buildFolderStructure`, `filterTree`, `renderFileTree`),
  main renderer, and a dedicated **trash view** (V88).
- **SettingsUI** — theme presets UI (11 presets), dynamic config lists
  (dock/commands), backup & restore (V101), settings search filter, nav
  badges & updates, sync/backup controls.
- **HoverPreview** — wiki-link hover previews; styles injected via a style
  tag whose CSS lives in a template literal (section markers like
  `/* Wiki Links */` inside that template are CSS comments — they must stay).
- **FormatToolbar** — floating B/I/U/L bar on text selection in the editor.
- **WikiLinkAutocomplete** — detects `[[` before the cursor in a
  contenteditable, extracts the query, searches titles, and inserts the
  selected note title as a `[[wiki link]]`.
- **SlashMenu** — block-editor command palette (extracted from the original
  single file).
- **TabManager** — V63.2: multiple open notes as tabs with close/split.

---

## 7. State, storage & theming invariants

- **One `State`, mounted on `window`.** Mutate through the owning module's
  APIs; structural array changes invalidate the lookup maps automatically.
- **Never store secrets in the client.** The only OAuth surface is Google
  Drive (`drive.file`, user-scoped). The extension is local-first: all note
  data lives in the user's browser.
- **Theming:** 11 editable presets exposed as CSS variables (design tokens).
  Theme packages were introduced in V17.0 — they are complete objects
  (colors + fonts + densities), not just hue swaps.
- **CSP:** `manifest.json` + meta CSP are strict. No inline script tags beyond
  the two module/d3 tags; `SafeCalculator` exists because `eval` is banned.
- **CSS-in-JS template literals:** several UI modules inject styles via
  template literals (`style.textContent = \`…\``). CSS comments inside them
  look like `/* … */` but are **not** JS comments — keep them when editing.

---

## 8. Testing

- **Unit suites** (`node tests/run-all.mjs`, = `npm test`): pure-logic suites
  per subsystem (note maps, metadata cache, version history, attachments,
  backup, dataview, fuzzy, snap-grid, security/XSS, package exclusions, …).
  Suites register in `tests/run-all.mjs`.
- **E2E** (`npx playwright test`): Playwright against a local HTTP server
  auto-started by `playwright.config.mjs`. Organized by feature
  (notes, paste-smoke, dataview-query, local-graph, backlinks, quickopen,
  kanban-persist, settings-ui, tasks, canvas-search, cli-commands,
  release-candidate, …).
- **CLI sweep** (`tests/cli-commands.playwright.spec.mjs`) runs all 34
  registered commands with deterministic assertions (weather APIs mocked via
  route interception).
- **Release candidate** (`tests/release-candidate.playwright.spec.mjs`) is
  the only suite that loads the real unpacked extension in a persistent
  Chromium profile (`chrome-extension://` origin, MV3 service worker,
  `chrome.identity`/`storage` present).
- CI runs: unit → E2E (4 shards) → cli-sweep → release-candidate →
  package-check. See `.github/workflows/ci.yml`.

---

## 9. Packaging & release

- `scripts/package-release.sh` builds the Chrome Web Store zip with an
  **80 MB size guard** (CWS caps at 100 MB) and prints the 10 largest
  included paths. Excludes dev junk (`tests/`, `docs/`, `node_modules/`,
  `.github/`, `dist/`, `playwright-report/`, `test-results/`, `.venv*`,
  `scripts/`).
- `dist/*.zip` is uploaded as a CI artifact on both success and failure so a
  bloated zip can be inspected.

---

## 10. Known gotchas (learned the hard way)

- **Block comments were removed from source in the 2026-08 open-source pass.**
  `scripts/remove-block-comments.mjs` did the harvest; the knowledge lives in
  this document. If you re-add a block comment, consider whether it belongs
  here instead — but there is no automated gate; be sensible.
- **`/* */` inside template-literal CSS is not a JS comment.** (see §7).
- **Deletion paths must call `VersionHistoryManager.removeNote()`** and the
  `MetadataCache.removeNote()` guard — orphaned data is otherwise permanent.
- **Regexes containing `[` char classes** must be tested after any
  comment-stripping tooling runs — a naive stripper silently corrupts
  `[a-z]` into `[[-z]`.
- **`prune()`/IDB transactions:** resolve in `tx.oncomplete`, reject on
  `tx.onerror`/`tx.onabort` — never at cursor exhaustion.
- **Session storage can fill** (`sessionStorage may be full`) — always
  try/catch and degrade gracefully.

---

## 11. Original single-file heritage

Vinland began as one 400 KB `index.html` ("the command line I always wanted in
a browser"). The modular architecture under `js/` was extracted from that
single file (see `vinland.js`-era extraction notes in `Input.js`,
`SlashMenu.js`, `Sidebar.js`). When adding code, prefer **new modules under
`js/features|ui|core` imported by `boot.js`** over inlining into `index.html`.
