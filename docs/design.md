# Vinland — Design & Architecture

> Single source of truth for the Vinland Chrome new-tab extension.
> All facts verified against source code (`js/*` and `index.html`).
> Last verified: 2026-07-16.

## 1. What Vinland is

A Manifest V3 Chrome **new-tab override** — a keyboard-first personal
command center. Vanilla JS + D3 (v7), no bundler, no framework. Local-first
storage (localStorage + IndexedDB).

It combines a central HUD (clock, pomodoro, missions, weather, command line,
dock, bookmarks) with a local-first PKM workspace (block editor, spatial
canvas, D3 knowledge graph, metadata cache, Dataview-lite query engine).

## 2. Entry point & boot order (AUTHORITATIVE)

- **`index.html` → `js/boot.js` is the sole entry.** `js/main.js` has been
  deleted — it is dead code. Do not re-add it or treat it as an entry point.
- The `PROJECT_BLUEPRINT` doc listed `main.js` as "the entry point"; that doc
  is stale for its directory listing.

**Boot sequence (`boot()`, async):**

1. `Config.load()` — read `OPERATOR_CONFIG_V3` into `State.CONFIG`
2. `await loadData()` — hydrate `State.TASKS/NOTES/BOARDS/HISTORY` from storage
3. `ModalManager.init()` — set up modal close from `Esc` / overlay click
4. `TabManager.init()` — restore editor tabs from `VINLAND_TABS` localStorage
5. `MetadataCache.init()` — build tag/link/backlink indexes from `State.NOTES`
6. `CanvasManager.init()` — bind canvas event listeners
7. `HoverPreview.init()` — attach wiki-link hover handlers
8. `Notes.init()` + `renderNotes()` + `renderSidebar()`
9. `KanbanManager.init()`
10. `SettingsUI.init()` — bind config modal events + background init
11. `SystemCommands.register()` — populate `CommandRegistry` with all 17 commands
12. Feature `init()` calls: `CommandLine`, `Pomodoro`, `Bookmarks`,
    `PageActions`, `SlashMenu`, `Clock`, `CalloutModal`
13. `initKeyboardShortcuts()` — global keybinds (Cmd+S, Cmd+E, tab nav)
14. Renders: `renderMissions()`, `checkStreakReset()`, `renderDock()`
15. `Config.applyTheme()` + `fetchWeather()` (if location set)
16. `bindGlobals()` — wire static HTML buttons (gear, help, config-save, etc.)
    to `window.*` functions
17. First-run: if `State.CONFIG.first_run`, `ModalManager.open('welcome-modal')`
18. `beforeunload` → `saveData()`

## 3. Module inventory (every `.js` file)

### `js/core/` — Foundation layer

| File | Exports | Purpose |
|---|---|---|
| `store.js` | `State` | Global singleton: `CONFIG`, `NOTES`, `TASKS`, `BOARDS`, `CANVASES`, `COMMAND_HISTORY`, `FLAT_BOOKMARKS`, `WEATHER_CACHE` |
| `storage.js` | `DB`, `VinlandDB`, `loadData`, `saveData`, `saveAllNotes`, `clearAllNotes` | IndexedDB for media; localStorage via `VinlandDB` (5 collections + per-note sharding). `saveData()` writes TASKS/BOARDS/CANVASES/HISTORY in full; NOTES diff-writes per-note shards (`OPERATOR_NOTE_<id>`) + `OPERATOR_NOTES_INDEX`. |
| `config.js` | `Config`, `THEME_PRESETS`, `loadConfig`, `saveConfig` | `Config.load()`/`save()` reads/writes `OPERATOR_CONFIG_V3`. `applyTheme()` sets CSS vars, filter, icon. 11 theme presets. |
| `commandregistry.js` | `CommandRegistry` | Command bus: `register({id,trigger,title,action,hint})`, `search(query)` (exact-trigger or fuzzy), `execute(id, args)`. |
| `audio.js` | `Audio`, `playTypingSound`, `play8BitSound`, `playClickSound`, `playModalSound`, `playNotificationSound` | Web Audio API sound effects. Respects `State.CONFIG.typing_sounds` and `ui_sounds`. |
| `metadatacache.js` | `MetadataCache` | Indexes tags, wiki links (`[[Page]]`), backlinks, YAML frontmatter. Persists to `VINLAND_METADATA_CACHE`. |
| `queryengine.js` | `QueryEngine` | Dataview-lite: `LIST/TABLE/TASK/COUNT FROM #tag WHERE ...` parsed and run against `MetadataCache`. |
| `safecalc.js` | `SafeCalc` | CSP-compliant math expression evaluator, recursive-descent parser. |

### `js/modules/` — PKM business logic

| File | Exports | Purpose |
|---|---|---|
| `notescontroller.js` | `Notes` | Central PKM controller: `create`, `open`, `save`, `delete`, `renderNotes` (Quick Notes list), `toggleSidebar`, `openByTitle`, `togglePreview`, `togglePin`, tag extraction, markdown parsing helpers. 78KB. |
| `canvasmanager.js` | `CanvasManager` | Infinite spatial canvas: nodes (text/file/embed/group), edges (Shift+drag), zoom/pan, lasso marquee, multi-select, undo/redo (50 states), clipboard (`Cmd+C/V/D`), minimap, context menus. Canvas data lives in `note.canvasData`. 91KB. |
| `graphmanager.js` | `GraphManager` | D3 force-directed knowledge graph: nodes = notes + boards; edges = `[[wiki links]]` derived from note content. GLOBAL + LOCAL (1-degree) mode. Hover highlights full chain; click opens note/board. Layout resets each open (not persisted). |

### `js/features/` — Productivity widgets (HUD peripherals)

| File | Exports | Purpose |
|---|---|---|
| `commandline.js` | `CommandLine` | Terminal input (`#cmd-input`): autocomplete suggestions, arrow nav, command history (last 50, key `OPERATOR_HISTORY_V2`), fallback search (8 engines). Shows default hint on load. |
| `missions.js` | `renderMissions`, `addTask`, `toggleTaskComplete`, `clearCompletedTasks`, `updateProgressBar`, `checkStreakReset` | Task system with priority (`!!/!/~`), time, `@category`. Progress bar + streak tracking. Empty state with CTA. |
| `kanbanmanager.js` | `KanbanManager` | Multi-board kanban: columns/cards, vim keyboard nav (`h/j/k/l`), drag-and-drop, inline contenteditable editing. 800+ lines of pure state management. |
| `pomodoro.js` | `Pomodoro`, `parseTime`, `startPomodoro`, `loadPomodoroState` | Timer with `chrome.storage.local` cross-tab sync. Supports `25m`, `90s`, `M:SS` formats. 8-bit completion sound + HUD overlay + notification. |
| `bookmarks.js` | `Bookmarks`, `indexBookmarks`, `renderBottomBar` | Chrome bookmarks browser as bottom bar, folder drill-down with `NAV_STACK` back nav, empty-folder hint. Populates `State.FLAT_BOOKMARKS` for `b` command. |
| `weather.js` | `Weather`, `fetchWeather` | Open-Meteo API (geocoding + forecast). 30-min cache in `OPERATOR_WEATHER_CACHE`. `SET_LOCATION` empty-state CTA. C/F toggle. |
| `dock.js` | `Dock` | Quick-launch link bar below HUD. Default links: GMAIL, CAL, GPT. Right-click to delete. `+` opens Settings → dock tab. |
| `taskaggregator.js` | `TaskAggregator` | Aggregates all `task`-type blocks from all notes into a single "Task Manager" view, grouped by page, with inline checkboxes. |

### `js/ui/` — Views and overlays

| File | Exports | Purpose |
|---|---|---|
| `modalmanager.js` | `ModalManager` | Centered modal stacking: `open(modalId)`, `close(modalId)`, `closeAll()`, `openInput()`, `initConfirmModal()`. Z-index: `21000 + stack.length`. One-modal policy for config/help/graph/history. |
| `settingsui.js` | `SettingsUI` | SYSTEM_CONFIG dashboard (7 tabs: INTERFACE/NOTES/SYSTEM/MODULES/MAINTENANCE), theme presets, export/import backup, clear-data, background upload. Also: `toggleHelp()`, `showNotification()` (3s toast). |
| `sidebar.js` | `buildDirectoryStructure`, `filterTreeStructure`, `renderSidebar`, `renderTrashView` | Notes tree view (folder hierarchy, trash excluded). Search filtering. Drag-and-drop folder move. |
| `slashmenu.js` | `SlashMenu` | `/` command palette inside BlockEditor: 20+ commands (h1/h2/h3, bullet, numbered, task, quote, code, kanban, table, image, canvas, query, callout, /time, /weather, /calc). |
| `hoverpreview.js` | `HoverPreview` | Wiki-link hover preview cards (10×5rem CSS-positioned panel with note content). |
| `pageactions.js` | `PageActions` | Note context menu: favorite, fullscreen, export markdown, duplicate, delete (soft→trash, permanent), word count, last edited. Keyboard nav. |
| `calloutmodal.js` | `CalloutModal` | Dynamically-created callout editor modal (type/title/content) for Obsidian-style callout blocks. DOM is injected on init. |
| `tabmanager.js` | `TabManager` | Multi-tab note editing inside the editor modal. Tabs persist to `VINLAND_TABS` (localStorage). Back/forward history. |
| `background.js` | `Background` | Video/image wallpaper player. Handles `backgrounds[]` list from config, random selection, retry on error, color fallback, filter overlay. |

### `js/editor/` — The note editor engine

| File | Exports | Purpose |
|---|---|---|
| `blockeditor.js` | `BlockEditor`, `HistoryManager` | Notion-style block editor: block types (text/h1/h2/h3/task/bullet/code/divider/quote/canvas/kanban/query/callout/image/table/dataview), drag handles, slash command, multi-select, clipboard, indent. 120KB. |
| `pagemanager.js` | `PageManager`, `parseContentToBlocks`, `sanitizePath` | Data model syncing between block format ↔ markdown content. Schema migrations (`migrateNotesToPathSchema`, `migrateNotesToBlockSchema`). |

### `js/config/` — Command population

| File | Exports | Purpose |
|---|---|---|
| `systemcommands.js` | `SystemCommands` | Registers all 17 CLI commands into `CommandRegistry`. |

## 4. The `window.*` service-locator pattern (INTENTIONAL)

`boot.js` and various module files assign functions/objects to `window.*` (e.g.,
`window.Notes`, `window.saveData`, `window.ModalManager`). This is a
**deliberate** pattern, not a mistake — it exists because `index.html` has
inline `onclick=""` handlers that require globals, and it avoids import-ordering
issues in a non-bundled ES-module setup.

Reference count: ~270 cross-module references across ~22 files.
**Do NOT "clean this up"** by switching to direct imports everywhere without
introducing a bundler — the `window.*` pattern is load-bearing. New code may
use module imports internally but should expose public API on `window` if HTML
handlers or other modules depend on it.

## 5. Command system (AUTHORITATIVE list)

Registered in `js/config/SystemCommands.js` (lines 9–242).

| trigger | id | hint | action target |
|---|---|---|---|
| `note` | `notes:create` | `[content]` | `window.Notes.create(args)` |
| `notes` | `notes:toggle` | — | `window.Notes.toggleSidebar()` |
| `canvas` | `canvas:open` | — | Creates canvas note + opens editor |
| `daily` | `nav:daily` | — | Opens/creates `Daily Log YYYY-MM-DD` in /Journal |
| `random` | `nav:random` | — | Opens random non-canvas note |
| `task` | `task:add` | `[text]` | `window.addTask(args)` |
| `clear done` | `task:clear-done` | — | `window.clearCompletedTasks()` |
| `reload` | `sys:reload` | — | `location.reload()` |
| `theme` | `sys:theme` | `[name]` | `SettingsUI.applyThemePreset(args)` |
| `zen` | `ui:zen` | — | Toggles `zen-mode` body class |
| `kill` | `ui:kill` | — | `ModalManager.closeAll()` |
| `board` | `kanban:open` | — | `KanbanManager.open()` |
| `b` | `bm:search` | `[query]` | Navigates to first matching bookmark URL |
| `pomo` | `pomo:start` | `[time]` 25m, 90s, 50:00 | `Pomodoro.start(args)` |
| `weather` | `info:weather` | `[location]` | Sets location + `fetchWeather()` |
| `help` | `info:help` | — | Opens help modal (SettingsUI.toggleHelp) |
| `man` | `info:man` | — | Same as help |

**17 commands total.** No `focus` command exists in the registry. Any help text
or onboarding copy listing `focus` is stale — the timer command is `pomo`.

Fallback (when no trigger matches): custom commands from
`State.CONFIG.custom_commands` (defaults: `gh`→github.com, `reddit`→reddit.com),
raw `http` URLs, or web search (switchable: google/ddg/bing/brave/perplexity/
chatgpt/youtube).

## 6. Storage schema (`js/core/storage.js` + related)

### localStorage keys

| Key | What | Written by |
|---|---|---|
| `OPERATOR_CONFIG_V3` | `State.CONFIG` (merged with defaults) | `Config.save()` |
| `OPERATOR_TASKS_V2` | `State.TASKS` (full-write) | `saveData()` |
| `OPERATOR_NOTE_<id>` | One note object per key (shard) | `saveData()` (diff-write only if changed) |
| `OPERATOR_NOTES_INDEX` | `[id1, id2, ...]` — ordered note id list | `saveData()` (always rewritten) |
| `OPERATOR_BOARDS_V1` | `State.BOARDS` (full-write) | `saveData()` |
| `OPERATOR_CANVASES_V1` | Vestigial — writes `[]` (never populated) | `saveData()` |
| `OPERATOR_HISTORY_V2` | `State.COMMAND_HISTORY` (last 50) | `saveData()` |
| `OPERATOR_SESSIONS` | Session counter (incremented each load) | `loadData()` |
| `OPERATOR_WEATHER_CACHE` | Weather.fetch() cache (30-min TTL) | `Weather.fetch()` |
| `VINLAND_METADATA_CACHE` | MetadataCache tag/link/backlink indexes | `MetadataCache.saveCache()` |
| `VINLAND_TABS` | TabManager open tabs | `TabManager.save()` |
| `VINLAND_SIDEBAR_COLLAPSED` | Sidebar toggle state | `Notes.toggleSidebar()` |
| `OPERATOR_EXPANDED_FOLDERS` | Sidebar tree expand states | `Notes.renderSidebar()` |
| `VINLAND_EXPLICIT_FOLDERS` | Persist empty folders | `Notes` |
| `VINLAND_GRAPH_LAYOUT` | Graph node positions (loaded but NOT consumed by `render()`) | `GraphManager` (bypass) |

**State.CANVASES** is vestigial: canvas data lives inside `note.canvasData`.
**note.links[]** is vestigial: the graph recomputes `[[wiki links]]` from
`note.content` and `note.blocks[].content` on every render.

### IndexedDB

- `OPERATOR_VAULT` (`media_assets` store) — binary media (images/audio) that
  exceeds localStorage quota. Not used in the hot persistence path.

### Migration history

- NOTES migrated from single `OPERATOR_NOTES_V2` blob → per-note shards (V19.36).
  Legacy key, if present on load, is sharded once then deleted.
- Notes schemas: `migrateNotesToPathSchema` → `migrateNotesToBlockSchema` runs
  in `Notes.init()` to migrate legacy flat-content notes to the block format.

## 7. UI layout & z-index tiers

Tiers (lowest to highest):

| z-index | Element | Position |
|---|---|---|
| 0 | CRT/vignette/noise overlays, SVG edge layer, video background | full-screen |
| 2 | Canvas minimap, edge node class | relative |
| 5 | Shortcut hint | `bottom: 60px; right: 20px` |
| 10 | Canvas toolbar, bookmarks folder, status elements | various |
| 20 | Bookmarks bar | `bottom: 0; width: 100%` |
| 30 | Status bar (UPTIME/SESSIONS) | `top: 50%; left: 50%; transform` |
| 40 | Mission log | `top: 100px; left: 30px` |
| 50 | Weather widget | `top: 30px; right: 30px` |
| 60 | Notes panel, notes-discovery-hint | `bottom: 90px; right: 30px` |
| 100 | Overlays, search bar | various |
| 1000 | Canvas minimap, action buttons | various |
| 9000 | `--z-search` (command suggestions) | HUD |
| 9999 | Search results | inside HUD |
| 20000 | `--z-modal-backdrop` (overlay) | full-screen |
| 21000+ | `--z-modal-base` + stack index (ModalManager) | centered |
| 25000 | `--z-modal-maximized` (maximized editor) | centered |
| 26000 | `--z-modal-child` (nested modals inside modals) | centered |
| 35000 | Pomo HUD (`#pomo-hud`) | full-screen |

Notes panel is bottom-right to keep it clear of the weather widget (top-right).
The discovery hint shares the notes-panel position. Canvas has its own internal
z-index stacking for context menus (10000+), nodes and edges (0–10).

## 8. Onboarding (first-run)

- `State.CONFIG.first_run` defaults to `true` (defined in `store.js` line 74).
- `boot.js` line 429 checks this and opens `welcome-modal` if true.
- Dismissing the welcome modal via the "BEGIN SESSION" button sets
  `State.CONFIG.first_run = false` and persists via `Config.save()`.
- `#notes-discovery-hint` shows when `State.NOTES` is empty and not dismissed
  (key `VINLAND_NOTES_HINT_DISMISSED`).
- `#mission-log` and `#notes-panel` show empty-state CTAs with command examples.
- The command line (`#cmd-input`) shows a default hint:
  `Try: task <text> · pomo 25 · note <title> · daily · help`.

## 9. Conventions & gotchas

- **Module specifiers are lowercase** (`'./store.js'`, not `'./Store.js'`).
  macOS filesystem is case-insensitive; Chrome packaging / Linux is case-sensitive.
  Wrong casing raises as a load error on CWS.
- **No bundler.** ES modules are loaded directly by `index.html`. The `window.*`
  service-locator pattern is the intentionally-adopted cross-module communication
  layer for this reason.
- **Persistence sync**: `saveData()` is the one function that writes to storage.
  Never write to `localStorage` directly for state data (UI preferences like
  `VINLAND_SIDEBAR_COLLAPSED` are the exception). Per-keystroke auto-saves are
  debounced at 500ms in `Notes.autoSave()`.
- **Cross-tab sync**: Pomodoro timer state syncs via `chrome.storage.local`.
  Everything else is per-tab (each tab loads state from localStorage on boot).
- **Tests**: `npm test` runs `tests/run-all.mjs`, which aggregates
  `notes-unit-tests.mjs` (pure function extracts) and `storage-shard.test.mjs`
  (real-module storage tests with stubbed localStorage/State).
- **`PROJECT_BLUEPRINT.md`** is stale for directory listings (still listed the
  deleted `main.js`). The canonical file map is `docs/design.md` (this file).

## 10. Recent changes

- **V19.37** (2026-07-16): `Notes.open()` now opens the editor modal BEFORE
  `BlockEditor.render()` and wraps the render call in try/catch. This prevents
  a render error from silently blocking the editor from appearing. A static
  analysis test (`tests/notes-editor-open.test.mjs`) enforces the ordering.

## 11. Known limitations / future

- Graph layout is recomputed fresh every open; `VINLAND_GRAPH_LAYOUT` is loaded
  but never consumed by `GraphManager.render()`.
- Wiki-link auto-routing from text nodes → canvas edges (Phase 0 roadmap
  item 1) is not implemented.
- `js/core/storage.js` has an unused `DB` (IndexedDB) module for media assets
  but `CanvasManager` stores everything in `note.canvasData` (localStorage).
  Large canvas data may hit quota.
- No CI; tests run manually via `npm test`.
- The `KanbanManager` operates on `State.BOARDS` and syncs blocks into notes
  via `syncPage()` — a two-storage concern that occasionally loses consistency
  when `saveData()` breaks the chain.
