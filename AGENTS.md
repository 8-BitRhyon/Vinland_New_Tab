# AGENTS.md - Vinland New Tab Extension

Chrome Manifest V3 new-tab override. Keyboard-first, local-first personal
knowledge management (PKM) hub. Vanilla JS (ES modules) + D3 v7, **no bundler,
no framework, no build step**. Everything persists to `localStorage` (+ IndexedDB
for media).

> **License:** Apache-2.0 (`LICENSE`). **Open-source pass (2026-08):** the
> multi-line comments were harvested out of the source into
> [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — read it before touching code;
> keep new knowledge there, not in block comments.

> The canonical architecture reference is [`docs/design.md`](docs/design.md).
> It is verified against source and is the source of truth for module inventory,
> boot order, command list, and storage schema. `PROJECT_BLUEPRINT.md` was
> **deleted** on 2026-07-26 (stale — still referenced the deleted `main.js`).
> Read `docs/design.md` before making structural changes.

## Commands

```bash
# Unit tests (Node, zero deps, built-in assert) - 20+ suites (723 tests), run
# sequentially by tests/run-all.mjs (see that file for the full suite list):
npm test
#   OR directly: node tests/run-all.mjs
#   Single suite: node tests/notes-unit-tests.mjs

# End-to-end tests (Playwright) - spins up a python http.server on :9999
npm run test:e2e        # npx playwright test
npx playwright test --headed
npx playwright test --ui

# Everything (unit + e2e):
npm run test:all
```

There is **no build, lint, or format step** and no eslint/prettier config.
Loading the extension is done manually in Chrome: `chrome://extensions` →
"Load unpacked" → select the project folder.

CI (`.github/workflows/ci.yml`) runs the unit suites **and** the Playwright
E2E suite (34 specs, split into 4 parallel shards, plus a CLI command sweep and
a real-extension release-candidate smoke) on push/PR to `main`. Run the full
E2E suite locally with `npm run test:e2e`.

## Architecture (the non-obvious parts)

- **`index.html` → `js/boot.js` is the sole entry point.** `js/main.js` was
  **deleted** on 2026-07-26 (dead code, not imported anywhere).
  `index.html` loads `d3.v7.min.js` as a classic `<script>` (so `d3` is a
  global) and `js/boot.js` as `<script type="module">`. All other modules
  are imported by `boot.js`.

- **✅ Module filename casing is now consistent** (fixed 2026-07-26).
  All 52 JS files use PascalCase. 5 files were renamed: `commandregistry.js`→`CommandRegistry.js`,
  `metadatacache.js`→`MetadataCache.js`, `queryengine.js`→`QueryEngine.js`,
  `dock.js`→`Dock.js`, `clock.js`→`Clock.js`. See `docs/design.md` §12.

- **`window.*` service-locator pattern is load-bearing, NOT a mistake.**
  `index.html` has inline `onclick=""` handlers and the app deliberately avoids
  import-ordering complexity in a non-bundled setup. `boot.js` exports managers
  and many functions onto `window.*` (~270 cross-module references). Do NOT
  "clean this up" by converting to direct imports everywhere without adding a
  bundler. New code may use module imports internally, but if HTML handlers or
  other modules depend on a symbol, expose it on `window`.

- **`State` (`js/core/Store.js`) is the single global state singleton** — holds
  `CONFIG`, `NOTES`, `TASKS`, `BOARDS`, `CANVASES`, `COMMAND_HISTORY`,
  `FLAT_BOOKMARKS`, `WEATHER_CACHE`, plus auxiliary fields
  (`DYNAMIC_ICON_URL`, `ROOT_ID`, `NAV_STACK`, `SESSION_START`, `POMODORO`,
  etc.). Modules read/write `State` in memory and persist through `saveData()`.

- **`CommandRegistry` (`js/core/commandregistry.js`) is the command bus.** All
  **34 CLI commands** are registered in `js/config/SystemCommands.js`. To add a
  command, register it there; do not wire HTML handlers directly.

- **Layer layout** (`js/`):
  - `core/` — foundation: `Store`, `Storage`, `Config`, `CommandRegistry`,
    `Audio`, `MetadataCache`, `QueryEngine`, `SafeCalc`, `Input`, `utils`.
  - `modules/` — PKM logic: `NotesController`, `CanvasManager`, `GraphManager`.
  - `features/` — HUD widgets + tools: `CommandLine`, `Missions`, `KanbanManager`,
    `Pomodoro`, `Bookmarks`, `Weather`, `Dock`, `taskaggregator`, `QuickOpen`,
    `Calendar`, `DailyAgenda`, `TagBrowser`, `TemplateBrowser`, `QuickCapture`,
    `BackupManager`, `DataviewQuery`, `CanvasSearch`, `CodeBlockTools`,
    `FlashcardManager`, `ObsidianImporter`, `VersionHistoryManager`,
    `WorkspaceManager`, `Clock`.
  - `ui/` — views/overlays: `SettingsUI`, `ModalManager`, `Sidebar`,
    `SlashMenu`, `hoverpreview`, `PageActions`, `calloutmodal`, `TabManager`,
    `background`, `PropertiesPanel`, `WikiLinkAutocomplete`.
  - `editor/` — `BlockEditor`, `PageManager`.
  - `config/` — `SystemCommands`.
  - `background/` — `service-worker.js` (SW for OS notifications + pomodoro).

## Conventions & gotchas

- **✅ Module specifier casing is now consistent** (fixed 2026-07-26).
  All 52 JS files use PascalCase. See `docs/design.md` §12.
- **`saveData()` is the ONLY function that writes state to storage.** Never
  write to `localStorage` directly for state data. The only exceptions are pure
  UI preferences (`VINLAND_SIDEBAR_COLLAPSED`, `VINLAND_TABS`,
  `OPERATOR_EXPANDED_FOLDERS`, etc.). Per-keystroke note autosave is debounced
  at 500ms in `Notes.autoSave()`.
- **Notes are sharded per-note** as `OPERATOR_NOTE_<id>` plus an
  `OPERATOR_NOTES_INDEX`. `saveData()` diff-writes only changed note shards.
  Never assume notes live in one blob (legacy `OPERATOR_NOTES_V2` is migrated
  once on load then deleted).
- **Vestigial keys you will see but should not rely on:**
  `State.CANVASES` / `OPERATOR_CANVASES_V1` (canvas data actually lives in
  `note.canvasData`); `note.links[]` (the graph recomputes `[[wiki links]]` from
  `note.content`/`note.blocks[].content` every render); `VINLAND_GRAPH_LAYOUT`
  holds saved graph node positions and is applied + **pinned** in
  `GraphManager.render()` so the layout persists across opens (new nodes with no
  saved position are still free and arranged by the simulation).
- **Cross-tab sync is limited to the Pomodoro timer** (via `chrome.storage.local`).
  Everything else is per-tab: each tab rehydrates `State` from `localStorage` on
  boot. Don't expect other state to stay in sync across tabs.
- **CSP is strict:** `script-src 'self'` — no inline `<script>`, no `eval`.
  Math is evaluated by `SafeCalc` (recursive-descent parser) specifically to
  avoid `eval`. `style-src` allows `'unsafe-inline'` so inline styles/CSS vars
  are fine.
- **`rules.json` uses `declarativeNetRequest`** to spoof `Origin`/`Referer` and
  strip `X-Frame-Options`/`CSP` headers on YouTube `sub_frame` requests, so
  embeds work inside canvas/iframe nodes. Editing it affects embed behavior.
- **`first_run` defaults to `true`** in `Store.js`. The welcome modal opens on
  first boot and flips it off. Beware when testing — clearing storage re-triggers
  onboarding.
- **Z-index tiers** are documented in `docs/design.md` §7. Modal stacking uses
  `21000 + stack.length` via `ModalManager`; the editor maximized is `25000`;
  pomo HUD is `35000`; context menus are `30000`; toasts are `40000`.
  Respect these when adding overlays.

## Testing patterns

Two distinct test families — do NOT confuse them:

1. **Node unit tests** (`tests/*.test.mjs`, `tests/*-unit-tests.mjs`, `tests/helpers.mjs`):
   - Zero dependencies, use Node's built-in `node:assert/strict`.
   - `notes-unit-tests.mjs` copies pure-logic function extracts from source and
     tests them in isolation (deliberate drift risk — keep in sync when changing
     the source function).
   - `storage-shard.test.mjs` imports the **real** `js/core/Storage.js` and
     `js/core/Store.js` after installing `globalThis.localStorage` /
     `globalThis.document` shims — the shims MUST be set before the import.
   - `notes-editor-open.test.mjs` is a static-analysis guard: it enforces that
     `Notes.open()` opens the editor modal BEFORE calling `BlockEditor.render()`
     (wrapped in try/catch). Changing that ordering will fail the test.
   - Other unit suites: `canvas-unit-tests.mjs`, `dataview-unit-tests.mjs`,
     `metadata-cache-unit-tests.mjs`, `quickopen-unit-tests.mjs`, `import-unit-tests.mjs`.
   - Aggregate runner: `tests/run-all.mjs` (run with `npm test`).
2. **Playwright E2E** (`tests/*.playwright.spec.mjs` — **34 files**): runs against
   a static server. Playwright config auto-starts `python3 -m http.server 9999`
   (killing any process on 8080/8181/9999 first) and serves the repo root.
   `reuseExistingServer` is true. Reports go to `playwright-report/`.
