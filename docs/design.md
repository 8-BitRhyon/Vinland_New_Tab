# Vinland - Design & Architecture

> Single source of truth for the Vinland Chrome new-tab extension.
> All facts verified against source code (`js/*` and `index.html`).
> Last verified: 2026-07-26.

## 1. What Vinland is

A Manifest V3 Chrome **new-tab override** - a keyboard-first personal
command center. Vanilla JS + D3 (v7), no bundler, no framework. Local-first
storage (localStorage + IndexedDB).

It combines a central HUD (clock, pomodoro, missions, weather, command line,
dock, bookmarks) with a local-first PKM workspace (block editor, spatial
canvas, D3 knowledge graph, metadata cache, Dataview-lite query engine,
flashcards, version history, workspace snapshots, Obsidian import).

## 2. Entry point & boot order (AUTHORITATIVE)

- **`index.html` → `js/boot.js` is the sole entry.** `js/main.js` has been
  deleted - it is dead code. Do not re-add it or treat it as an entry point.
- The `PROJECT_BLUEPRINT` doc listed `main.js` as "the entry point"; that doc
  is stale for its directory listing.

**Boot sequence (`boot()`, async):**

_Verified against `js/boot.js` lines 422–516. 42 steps._

> **Note:** Not every imported module gets an `init()` call. `CanvasSearch`,
> `CodeBlockTools`, and `ObsidianImporter` are assigned to `window` in boot
> but have no explicit `.init()` — they're invoked on demand or are DOM-based.

1. `Config.load()` — read `OPERATOR_CONFIG_V3` into `State.CONFIG`
2. `await loadData()` — hydrate `State.TASKS/NOTES/BOARDS/CANVASES/HISTORY/SESSIONS` from storage (+ IndexedDB canvas offload)
3. `ModalManager.init()` — set up modal close from `Esc` / overlay click
4. `TabManager.init()` — restore editor tabs from `VINLAND_TABS` localStorage
5. `MetadataCache.init()` — build tag/link/backlink indexes from `State.NOTES`
6. `CanvasManager.init()` — bind canvas event listeners
7. `HoverPreview.init()` — attach wiki-link hover handlers
8. `Notes.init()` + `Notes.renderNotes()` + `Notes.renderSidebar()`
9. `KanbanManager.init()`
10. `SettingsUI.init()` — bind config modal events
11. `SystemCommands.register()` — populate `CommandRegistry` with all **33 commands**
12. `QuickOpen.init()`
13. `Calendar.init()`
14. `DailyAgenda.init()`
15. `TagBrowser.init()`
16. `TemplateBrowser.init()`
17. `QuickCapture.init()`
18. `DataviewQuery.init()`
19. `BackupManager.init()`
20. `WorkspaceManager.init()`
21. `PropertiesPanel.init()`
22. `WikiLinkAutocomplete.init()`
23. `VersionHistoryManager.init()`
24. `FlashcardManager.init()`
25. `CommandLine.init()`
26. `Pomodoro.init()`
27. `Bookmarks.init()`
28. `PageActions.init()`
29. `SlashMenu.init()`
30. `Clock.init()`
31. `CalloutModal.init()`
32. `initKeyboardShortcuts()` — global keybinds (Cmd+S, Cmd+E, Cmd+P,
    Cmd+Shift+C, Cmd+Shift+F, Cmd+Shift+I, Cmd+Shift+N, Cmd+Shift+T,
    Cmd+Shift+A, Cmd+Shift+O, tab nav)
33. `renderMissions()`
34. `checkStreakReset()`
35. `window.renderDock()`
36. `SettingsUI.initBackground()` — init dynamic background player
37. `Config.applyTheme()` — apply colors, fonts, filters, overlays
38. `fetchWeather()` (if `State.CONFIG.location` set)
39. `bindGlobals()` — wire static HTML buttons (gear, help, config-save) to `window.*` functions
40. First-run: if `State.CONFIG.first_run`, `ModalManager.open('welcome-modal')`
41. `Config.loadFromSync()` — pull config from Chrome Storage Sync (async)
42. `window.addEventListener('beforeunload', saveData)`

## 3. Module inventory (every `.js` file)

> **✅ Filename casing normalized (2026-07-26):** All 52 JS files now use **PascalCase** consistently.
> The 5 files that were lowercase (`commandregistry.js`, `metadatacache.js`, `queryengine.js`, `dock.js`, `clock.js`)
> have been renamed to `CommandRegistry.js`, `MetadataCache.js`, `QueryEngine.js`, `Dock.js`, `Clock.js`.
> `SafeCalc.js` was already PascalCase. Import paths match filenames exactly — no import changes were needed.

### `js/core/` - Foundation layer

| File | Exports | Purpose |
|---|---|---|
| `Store.js` | `State` | Global singleton: `CONFIG`, `NOTES`, `TASKS`, `BOARDS`, `CANVASES`, `COMMAND_HISTORY`, `FLAT_BOOKMARKS`, `WEATHER_CACHE`, `DYNAMIC_ICON_URL`, `ROOT_ID`, `NAV_STACK`, `CURRENT_BOOKMARK_FOLDER`, `SESSION_START`, `POMODORO`, `IS_PREVIEW_MODE`, `CONFIG_DIRTY`, `HISTORY_INDEX`, `SUGGESTION_INDEX`, `CURRENT_SUGGESTIONS`, `BG_RETRY_COUNT`, `BG_MAX_RETRIES`, `LAST_STREAK_CHECK_DATE`, `DYNAMIC_ICON_URL`. Also exports `DEFAULT_CONFIG` and `getDefaultConfig()`. |
| `Storage.js` | `DB`, `VinlandDB`, `loadData`, `saveData`, `saveAllNotes`, `clearAllNotes` | IndexedDB for media + canvas; localStorage via `VinlandDB` (5 collections + per-note sharding). `saveData()` writes TASKS/BOARDS/CANVASES/HISTORY in full; NOTES diff-writes per-note shards (`OPERATOR_NOTE_<id>`) + `OPERATOR_NOTES_INDEX`. Canvas notes offload `note.canvasData` to IndexedDB (`vinland_canvas_<id>`), leaving only a `{_external:true}` marker in the shard; `loadData()` rehydrates it fire-and-forget. |
| `Config.js` | `Config`, `THEME_PRESETS`, `loadConfig`, `saveConfig` | `Config.load()`/`save()` reads/writes `OPERATOR_CONFIG_V3`. `applyTheme()` sets CSS vars, filter, icon, surface tokens (`--bg-color`, `--danger-color`, `--warning-color`, `--board-color`, `--dim-color`, `--graph-col-*`), and manages retroma body class. **13 theme presets** (matrix, cyberpunk, ocean, sunset, minimal, blood, gold, forest, amber, ice, lavender, retrogreen, retroma). `loadFromSync()` merges from Chrome Storage Sync. |
| `commandregistry.js` | `CommandRegistry` | Command bus: `register({id,trigger,title,action,hint})`, `search(query)` (exact-trigger or fuzzy), `execute(id, args)`. |
| `Audio.js` | `Audio`, `playTypingSound`, `play8BitSound`, `playClickSound`, `playModalSound`, `playNotificationSound` | Web Audio API sound effects. Respects `State.CONFIG.typing_sounds` and `ui_sounds`. |
| `metadatacache.js` | `MetadataCache` | Indexes tags, wiki links (`[[Page]]`), backlinks, YAML frontmatter. Persists to `VINLAND_METADATA_CACHE`. |
| `queryengine.js` | `QueryEngine` | Dataview-lite: `LIST/TABLE/TASK/COUNT FROM #tag WHERE ...` parsed and run against `MetadataCache`. |
| `SafeCalc.js` | `SafeCalc` | CSP-compliant math expression evaluator, recursive-descent parser. |
| `Input.js` | `initKeyboardShortcuts` | Global keyboard shortcut bindings: Cmd+S, Cmd+E, Cmd+P, Cmd+Shift+C/F/I/N/T/A/O, tab nav, Escape. Only imported by `boot.js`. |
| `utils.js` | `safeText`, `validateURL`, `getAudioContext` | Shared utility functions: HTML escaping, URL validation, AudioContext singleton. |

### `js/modules/` - PKM business logic

| File | Exports | Purpose |
|---|---|---|
| `NotesController.js` | `Notes`, `closeNoteEditor`, `legacyRenderNotes` | Central PKM controller: `create`, `open`, `save`, `delete`, `renderNotes` (Quick Notes list), `toggleSidebar`, `openByTitle`, `togglePreview`, `togglePin`, tag extraction, markdown parsing helpers. 78KB. |
| `CanvasManager.js` | `CanvasManager` | Infinite spatial canvas: nodes (text/file/embed/group), edges (Shift+drag), zoom/pan, lasso marquee, multi-select, undo/redo (50 states), clipboard (`Cmd+C/V/D`), minimap, context menus. Canvas data lives in `note.canvasData`. 91KB. Wiki-link auto-routing from text node content. |
| `GraphManager.js` | `GraphManager` | D3 force-directed knowledge graph: nodes = notes + boards; edges = `[[wiki links]]` derived from note content. GLOBAL + LOCAL (1-degree) mode. Hover highlights full chain; click opens note/board. Saved node positions pinned (`fx`/`fy`) via `VINLAND_GRAPH_LAYOUT`. |

### `js/features/` - Productivity widgets (HUD peripherals)

| File | Exports | Purpose |
|---|---|---|
| `CommandLine.js` | `CommandLine` | Terminal input (`#cmd-input`): autocomplete suggestions, arrow nav, command history (last 50, key `OPERATOR_HISTORY_V2`), fallback search (8 engines). Shows default hint on load. |
| `Missions.js` | `renderMissions`, `addTask`, `toggleTaskComplete`, `clearCompletedTasks`, `updateProgressBar`, `checkStreakReset` | Task system with priority (`!!/!/~`), time, `@category`. Progress bar + streak tracking. Empty state with CTA. |
| `kanbanmanager.js` | `KanbanManager` | Multi-board kanban: columns/cards, vim keyboard nav (`h/j/k/l`), drag-and-drop, inline contenteditable editing. 800+ lines of pure state management. |
| `Pomodoro.js` | `Pomodoro`, `parseTime`, `startPomodoro`, `loadPomodoroState` | Timer with `chrome.storage.local` cross-tab sync. Supports `25m`, `90s`, `M:SS` formats. 8-bit completion sound + HUD overlay + notification. |
| `Bookmarks.js` | `Bookmarks`, `indexBookmarks`, `renderBottomBar` | Chrome bookmarks browser as bottom bar, folder drill-down with `NAV_STACK` back nav, empty-folder hint. Populates `State.FLAT_BOOKMARKS` for `b` command. |
| `Weather.js` | `Weather`, `fetchWeather` | Open-Meteo API (geocoding + forecast). 30-min cache in `OPERATOR_WEATHER_CACHE`. `SET_LOCATION` empty-state CTA. C/F toggle. |
| `dock.js` | `Dock` | Quick-launch link bar below HUD. Default links: GMAIL, CAL, GPT. Right-click to delete. `+` opens Settings → dock tab. |
| `taskaggregator.js` | `TaskAggregator` | Aggregates all `task`-type blocks from all notes into a single "Task Manager" view, grouped by page, with inline checkboxes. |
| `QuickOpen.js` | `QuickOpen` | VS Code-inspired quick-open palette (Cmd+P / Cmd+Shift+F): full-text search across note titles, content, tags, and CLI commands. Debounced at 150ms. Results grouped into Notes/Tags/Commands sections with keyboard navigation. |
| `Calendar.js` | `Calendar` | Monthly calendar view (Cmd+Shift+C / `calendar` CLI). Shows date-grid with note dot indicators. Click a day to open/create daily note. Prev/next month navigation, "Today" jump button. |
| `DailyAgenda.js` | `DailyAgenda` | Daily notes aggregation view (Cmd+Shift+A / `agenda` CLI). Shows week/month layout of daily note titles with content previews. Navigate between periods, click cards to open notes. |
| `TagBrowser.js` | `TagBrowser` | Tag browser modal (Cmd+Shift+T / `tags` CLI): lists all tags with counts, real-time search/filter, click-to-filter notes in sidebar. |
| `TemplateBrowser.js` | `TemplateBrowser` | Template browser (Cmd+Shift+N / `template` CLI): opens modal showing all notes in `/Templates` folder, creates new notes pre-populated from selected template. Supports YAML frontmatter in templates. |
| `QuickCapture.js` | `QuickCapture` | Quick Capture overlay (Cmd+Shift+I): minimal input for instantly capturing thoughts into `/Inbox` folder. Inbox preview for triaging captures. Chrome context menu "Send to Vinland Inbox". |
| `BackupManager.js` | `BackupManager` | Auto-backup and Google Drive sync. Configurable interval, "Backup Now" button, backup status display, Drive integration buttons. Persists backup config to `OPERATOR_CONFIG_V3`. |
| `DataviewQuery.js` | `DataviewQuery` | Live Dataview query panel inside the block editor. Executes `QUERY ...` blocks against `QueryEngine`. `init()` sets up keyboard shortcut (`Cmd+Shift+O`). |
| `CanvasSearch.js` | `CanvasSearch` | Full-text search across canvas nodes and edge labels within the active canvas. Exposed as `window.CanvasSearch` (assigned in boot, no `.init()` call — invoked on demand). |
| `CodeBlockTools.js` | `CodeBlockTools` | Code block enhancement tools: copy-button overlay, language badge, line numbers for `<pre><code>` blocks. Exposed as `window.CodeBlockTools` (assigned in boot, no `.init()` call — DOM-based). |
| `FlashcardManager.js` | `FlashcardManager` | Spaced-repetition flashcard system. Parses `Q:: ... A::` blocks in notes. Review sessions with flip/rate (easy/good/hard/again). Stats stored in `OPERATOR_CONFIG_V3.flashcard_stats`. |
| `ObsidianImporter.js` | `ObsidianImporter` | Imports `.md` files from a zipped Obsidian vault. Parses frontmatter, wiki-links, tags. Creates notes with folder structure preserved. |
| `VersionHistoryManager.js` | `VersionHistoryManager` | Git-like version snapshots per note. Stores diffs in IndexedDB (`vinland_version_<noteId>`). Hooked into `Notes.save()` for auto-snapshot. `versions` CLI command opens version browser. |
| `WorkspaceManager.js` | `WorkspaceManager` | Save/load/delete workspace snapshots (canvas layout + open note state). Persisted to `OPERATOR_WORKSPACES` in localStorage. `workspace save|load|delete|list` CLI. |
| `clock.js` | `Clock` | Live clock widget in the HUD (`#clock`). Renders HH:MM:SS, AM/PM format, with date below. Font size controlled by `State.CONFIG.clock_font_size`. |

### `js/ui/` - Views and overlays

| File | Exports | Purpose |
|---|---|---|
| `ModalManager.js` | `ModalManager` | Centered modal stacking: `open(modalId)`, `close(modalId)`, `closeAll()`, `openInput()`, `initConfirmModal()`. Z-index: `21000 + stack.length`. One-modal policy for config/help/graph/history. |
| `SettingsUI.js` | `SettingsUI` | SYSTEM_CONFIG dashboard (7 tabs: INTERFACE/NOTES/SYSTEM/MODULES/MAINTENANCE), theme presets (13), export/import backup, cloud sync config, clear-data, background upload. Also: `toggleHelp()`, `showNotification()` (3s toast), `initBackground()`. |
| `Sidebar.js` | `buildDirectoryStructure`, `filterTreeStructure`, `renderSidebar`, `renderTrashView` | Notes tree view (folder hierarchy, trash excluded). Search filtering. Drag-and-drop folder move. |
| `SlashMenu.js` | `SlashMenu` | `/` command palette inside BlockEditor: 20+ commands (h1/h2/h3, bullet, numbered, task, quote, code, kanban, table, image, canvas, query, callout, /time, /weather, /calc). |
| `hoverpreview.js` | `HoverPreview` | Wiki-link hover preview cards (10×5rem CSS-positioned panel with note content). |
| `PageActions.js` | `PageActions` | Note context menu: favorite, fullscreen, export markdown, duplicate, delete (soft→trash, permanent), word count, last edited. Keyboard nav. |
| `calloutmodal.js` | `CalloutModal` | Dynamically-created callout editor modal (type/title/content) for Obsidian-style callout blocks. DOM is injected on init. |
| `TabManager.js` | `TabManager` | Multi-tab note editing inside the editor modal. Tabs persist to `VINLAND_TABS` (localStorage). Back/forward history. |
| `background.js` | `Background` | Video/image wallpaper player. Handles `backgrounds[]` list from config, random selection, retry on error, color fallback, filter overlay. |
| `PropertiesPanel.js` | `PropertiesPanel` | YAML frontmatter editor panel in the note editor sidebar. Parses `---\nkey: value\n---` frontmatter and renders editable fields: tags (autocomplete), aliases, date, status (preset dropdown), booleans, and custom key:value pairs. `syncToNote()` serializes changes back into `note.content` on save. |
| `WikiLinkAutocomplete.js` | `WikiLinkAutocomplete` | Inline `[[` autocomplete popup inside BlockEditor. Queries `MetadataCache` for note titles. Navigation with arrow keys, Enter to insert. |

### `js/editor/` - The note editor engine

| File | Exports | Purpose |
|---|---|---|
| `BlockEditor.js` | `BlockEditor`, `HistoryManager` | Notion-style block editor: block types (text/h1/h2/h3/task/bullet/code/divider/quote/canvas/kanban/query/callout/image/table/dataview), drag handles, slash command, multi-select, clipboard, indent. 120KB. |
| `PageManager.js` | `PageManager`, `parseContentToBlocks`, `sanitizePath` | Data model syncing between block format ↔ markdown content. Schema migrations (`migrateNotesToPathSchema`, `migrateNotesToBlockSchema`). |

### `js/config/` - Command population

| File | Exports | Purpose |
|---|---|---|
| `SystemCommands.js` | `SystemCommands` | Registers all **33 CLI commands** into `CommandRegistry`. |

### `js/background/` - Extension service worker

| File | Exports | Purpose |
|---|---|---|
| `service-worker.js` | (none — runs as SW context) | Chrome extension background service worker. Handles OS notifications for pomodoro completion, context menu ("Send to Vinland Inbox"). Declared in `manifest.json` as `"background": {"service_worker": "js/background/service-worker.js", "type": "module"}`. |

### Dead / vestigial files

| File | Status | Notes |
|---|---|---|
| `js/main.js` | **Deleted** 2026-07-26 (dead code, not imported anywhere) | `index.html` loads `boot.js` directly. One comment in `boot.js` was updated to remove the reference. |

## 4. The `window.*` service-locator pattern (INTENTIONAL)

`boot.js` and various module files assign functions/objects to `window.*` (e.g.,
`window.Notes`, `window.saveData`, `window.ModalManager`). This is a
**deliberate** pattern, not a mistake — it exists because `index.html` has
inline `onclick=""` handlers that require globals, and it avoids import-ordering
issues in a non-bundled ES-module setup.

Reference count: ~270 cross-module references across ~52 files.
**Do NOT "clean this up"** by switching to direct imports everywhere without
introducing a bundler — the `window.*` pattern is load-bearing. New code may
use module imports internally but should expose public API on `window` if HTML
handlers or other modules depend on it.

Modules boot-assigned to `window.*` include (non-exhaustive): Notes, saveData,
ModalManager, TabManager, CanvasManager, KanbanManager, Bookmarks, Pomodoro,
CommandLine, Clock, PageActions, SlashMenu, fetchWeather, Config, SettingsUI,
Background, renderMissions, addTask, BlockEditor, PropertiesPanel, QuickOpen,
Calendar, DailyAgenda, TagBrowser, TemplateBrowser, QuickCapture,
DataviewQuery, BackupManager, WorkspaceManager, WikiLinkAutocomplete,
VersionHistoryManager, FlashcardManager, ObsidianImporter, CodeBlockTools,
CanvasSearch, initKeyboardShortcuts.

## 5. Command system (AUTHORITATIVE list)

Registered in `js/config/SystemCommands.js`. **33 commands total.**

| Trigger | ID | Hint | What it does |
|---|---|---|---|
| `note` | `notes:create` | `[content]` | Creates new note; `--template X` flag for templates |
| `notes` | `notes:toggle` | — | Toggle notes sidebar |
| `canvas` | `canvas:open` | — | Create/open a canvas note |
| `daily` | `nav:daily` | — | Open/create daily note in /Journal |
| `random` | `nav:random` | — | Open random non-canvas note |
| `task` | `task:add` | `[text]` | Add task |
| `clear done` | `task:clear-done` | — | Clear completed tasks |
| `reload` | `sys:reload` | — | `location.reload()` |
| `theme` | `sys:theme` | `[name]` | Load theme preset |
| `zen` | `ui:zen` | — | Toggle zen mode |
| `kill` | `ui:kill` | — | Close all modals |
| `board` | `kanban:open` | — | Open kanban board |
| `kanban` | `kanban:quick` | — | Open kanban board (alias) |
| `b` | `bm:search` | `[query]` | Navigate to first matching bookmark |
| `pomo` | `pomo:start` | `[time]` | Start pomodoro (25m, 90s, 50:00) |
| `weather` | `info:weather` | `[location]` | Set location + fetch weather |
| `help` | `info:help` | — | Open help manual |
| `man` | `info:man` | — | Same as help |
| `find` | `info:find` | `[query]` | Search notes via QuickOpen |
| `search` | `info:search` | `[query]` | Search notes (alias) |
| `calendar` | `nav:calendar` | — | Open calendar view |
| `agenda` | `nav:agenda` | — | Open daily agenda (week/month) |
| `template` | `nav:templates` | `[name]` | Browse/create from template |
| `tags` | `nav:tags` | `[query]` | Browse/filter by tag |
| `dv` | `dataview:open` | `[query]` | Open Dataview query panel |
| `dataview` | `dataview:open-full` | `[query]` | Open Dataview query panel (alias) |
| `review` | `flashcard:review` | — | Start flashcard review session |
| `flashcards` | `flashcard:stats` | — | Show flashcard stats |
| `versions` | `version:history` | — | View note version history |
| `obsidian-import` | `obsidian:import` | — | Import `.md` from Obsidian vault |
| `workspace` | `workspace:manage` | `save\|load\|delete\|list` | Manage workspace snapshots |
| `export` | `data:export` | — | Download all data as JSON |
| `import` | `data:import` | — | Import from JSON backup |

**Fallback chain** (when no trigger matches):
1. Custom commands from `State.CONFIG.custom_commands` (defaults: `gh`→github.com, `reddit`→reddit.com)
2. Raw `http`/`https` URLs (navigates directly)
3. Web search via selected engine: google / ddg / bing / brave / perplexity / chatgpt / youtube

## 6. Storage schema (`js/core/Storage.js`)

### localStorage keys

| Key | What | Written by |
|---|---|---|
| `OPERATOR_CONFIG_V3` | `State.CONFIG` (merged with defaults) | `Config.save()` |
| `OPERATOR_TASKS_V2` | `State.TASKS` (full-write) | `saveData()` |
| `OPERATOR_NOTE_<id>` | One note object per key (shard) | `saveData()` (diff-write only if changed) |
| `OPERATOR_NOTES_INDEX` | `[id1, id2, ...]` — ordered note id list | `saveData()` (always rewritten) |
| `OPERATOR_BOARDS_V1` | `State.BOARDS` (full-write) | `saveData()` |
| `OPERATOR_CANVASES_V1` | **Vestigial** — writes `[]` (never populated) | `saveData()` |
| `OPERATOR_HISTORY_V2` | `State.COMMAND_HISTORY` (last 50) | `saveData()` |
| `OPERATOR_SESSIONS` | Session counter (incremented each load) | `loadData()` |
| `OPERATOR_WEATHER_CACHE` | Weather.fetch() cache (30-min TTL) | `Weather.fetch()` |
| `VINLAND_METADATA_CACHE` | MetadataCache tag/link/backlink indexes | `MetadataCache.saveCache()` |
| `VINLAND_TABS` | TabManager open tabs | `TabManager.save()` |
| `VINLAND_SIDEBAR_COLLAPSED` | Sidebar toggle state | `Notes.toggleSidebar()` |
| `OPERATOR_EXPANDED_FOLDERS` | Sidebar tree expand states | `Notes.renderSidebar()` |
| `VINLAND_EXPLICIT_FOLDERS` | Persist empty folders | `Notes` |
| `VINLAND_GRAPH_LAYOUT` | Graph node positions `{id:{x,y}}` | `GraphManager.render()` |
| `OPERATOR_WORKSPACES` | Workspace snapshots | `WorkspaceManager` |

**Vestigial keys:**
- `State.CANVASES` / `OPERATOR_CANVASES_V1` — canvas data lives inside `note.canvasData`
- `note.links[]` — graph recomputes `[[wiki links]]` from `note.content`/`note.blocks[].content` every render
- `OPERATOR_NOTES_V2` — legacy monolithic notes blob; migrated to shards on load then deleted

### IndexedDB

- **Database**: `OPERATOR_VAULT`
- **Object store**: `media_assets` (binary media — images/audio exceeding localStorage quota)
- **Canvas offload**: `note.canvasData` mirrored under keys `vinland_canvas_<noteId>`, keeping large canvases out of the localStorage budget. Shard stores only `{"_external": true}` marker. Rehydrated by `loadData()` fire-and-forget.
- **Version history**: `vinland_version_<noteId>` stores snapshots (via `VersionHistoryManager`).

### Migration history

- NOTES: single `OPERATOR_NOTES_V2` blob → per-note shards (V19.36). Legacy key sharded once then deleted.
- Notes schemas: `migrateNotesToPathSchema` → `migrateNotesToBlockSchema` runs in `Notes.init()`.
- Config: V1 → V2 → V3 (current). Version field in `OPERATOR_CONFIG_V3` verifies schema.

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
| 30000 | `--z-context-menu` | context menus |
| 35000 | `--z-tooltip` / Pomo HUD (`#pomo-hud`) | tooltips, pomo overlay |
| 40000 | `--z-toast` | notifications |

Notes panel is bottom-right to keep it clear of the weather widget (top-right).
The discovery hint shares the notes-panel position. Canvas has its own internal
z-index stacking for context menus (10000+), nodes and edges (0–10).

Hardcoded z-index values used outside the CSS variable system:
- `22000` — settings gear and help buttons (above `--z-modal-base = 21000`)
- `9997` — noise overlay
- `9998` — vignette overlay
- `9999` — CRT scanline overlay
- `10000` — canvas card drag state (`!important`)
- `25000` — canvas marquee selection

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

- **✅ Module casing now consistent (2026-07-26).** All 52 JS files use PascalCase.
  5 files were renamed: `commandregistry.js`→`CommandRegistry.js`, `metadatacache.js`→`MetadataCache.js`,
  `queryengine.js`→`QueryEngine.js`, `dock.js`→`Dock.js`, `clock.js`→`Clock.js`.
  `SafeCalc.js` was already PascalCase.
  Previously, import paths used PascalCase while filenames used lowercase — this worked
  on macOS (case-insensitive FS) but would have failed on Chrome Web Store packaging.
- **No bundler.** ES modules are loaded directly by `index.html`. The `window.*`
  service-locator pattern is the intentionally-adopted cross-module communication
  layer for this reason.
- **Persistence sync**: `saveData()` is the one function that writes to storage.
  Never write to `localStorage` directly for state data (UI preferences like
  `VINLAND_SIDEBAR_COLLAPSED` are the exception). Per-keystroke auto-saves are
  debounced at 500ms in `Notes.autoSave()`.
- **Cross-tab sync**: Pomodoro timer state syncs via `chrome.storage.local`.
  Everything else is per-tab (each tab loads state from localStorage on boot).
- **Tests**: `npm test` runs `tests/run-all.mjs`, which aggregates unit tests
  and Playwright E2E tests. See §13 for full test inventory.
- **`PROJECT_BLUEPRINT.md`** was deleted on 2026-07-26 (stale — still referenced
  the deleted `main.js`). The canonical file map is `docs/design.md` (this file).
- **`Config.loadFromSync()` is called once** in the boot sequence (line 500).
  The duplicate was removed in V19.47+ (2026-07-26).

## 10. Recent changes

- **V19.47+** (2026-07-26): Comprehensive docs reconciliation — full module inventory audit, boot sequence verified against source, command list expanded to 33, z-index tiers updated, casing inconsistency documented, 8 undocumented feature modules catalogued (CanvasSearch, CodeBlockTools, DataviewQuery, FlashcardManager, ObsidianImporter, VersionHistoryManager, WorkspaceManager, WikiLinkAutocomplete). Core modules `Input.js` and `utils.js` documented. `js/main.js` deleted (dead code, not imported anywhere). Duplicate `Config.loadFromSync()` call removed from boot sequence (section lettering fixed to sequential A→G).
- **V19.46** (2026-07-25): Properties Panel — YAML frontmatter editor in note editor sidebar. Inline editing for tags, aliases, date, status, booleans, and custom key:value pairs. Tag autocomplete from MetadataCache. Critical save-order bugs fixed (syncToNote before saveData, stale body reference).
- **V19.45** (2026-07-24): Quick Capture feature (Cmd+Shift+I) — minimal overlay for instantly capturing thoughts into /Inbox. Chrome context menu "Send to Vinland Inbox". Template Browser (Cmd+Shift+N) — browse templates from /Templates folder, create notes from templates with YAML frontmatter. `--template` flag on `note` CLI command. Backup Manager with configurable auto-backup intervals and Google Drive sync integration.
- **V19.44** (2026-07-23): Tag Browser (Cmd+Shift+T) — modal listing all tags with counts, real-time search/filter, click-to-filter notes in sidebar. `tags` CLI command. Daily Agenda (Cmd+Shift+A) — week/month aggregation view of daily notes with content previews. Calendar (Cmd+Shift+C) — monthly calendar grid with note dot indicators, day-click navigation.
- **V19.43** (2026-07-22): Quick Open palette (Cmd+P) — VS Code-inspired search across note titles, content, tags, and CLI commands. Cmd+Shift+F for content-only search mode. `find`/`search` CLI commands. Full export/import system — `export`/`import` CLI commands, Settings UI integration, Blob+createObjectURL downloads, JSON schema validation.
- **V19.42** (2026-07-21): Tag sidebar section in NotesController — displays tags with counts from MetadataCache.getAllTags(), click-to-filter by tag. Sidebar tag search input.
- **V19.41** (2026-07-20): Backlinks Panel in note editor — shows all notes linking to the current note via [[wiki links]], click-to-navigate. Powered by MetadataCache's backlink index.
- **V19.40** (2026-07-19): MetadataCache.removeNote() bug fix — now cleans up orphaned backlink entries when a note is deleted. QuickOpen._escapeHtml() refactored to use string replacement for Node.js test compatibility. Config.loadFromSync() duplicate removal attempted at this time, but the duplicate persisted until V19.47+ when it was finally removed (see V19.47+ entry).
- **V19.39** (2026-07-18): Codebase cleanup — em dashes replaced with hyphens across all source files; version markers (`V\d+`, `P\d+`), dev notes (`[FIX]`, `[NEW]`), and redundant comments removed from all JS/CSS/HTML files. Settings audit found duplicate `openThemeModal`, `closeThemeModal`, and `initBackground` declarations in `SettingsUI.js` (second copies overwrite first, pre-existing, no functional impact).
- **V19.38** (2026-07-17): Full-surface theming — `--bg-color` CSS var added to `:root`, wired to all major surface areas (body bg, modals, inputs, dock, canvas, suggestions). `Config.applyTheme()` writes all surface tokens from config. `retroma` preset added with full token set + body-class integration. `THEME_PRESETS` is actually **13 presets** (not 14 — the count was misreported in the V19.38 changelog). Hardcoded `#000` backgrounds replaced with `var(--bg-color, #000)`.
- **V19.37** (2026-07-16): `Notes.open()` now opens the editor modal BEFORE
  `BlockEditor.render()` and wraps the render call in try/catch. This prevents
  a render error from silently blocking the editor from appearing. A static
  analysis test (`tests/notes-editor-open.test.mjs`) enforces the ordering.

## 11. Known limitations / future

- **(RESOLVED 2026-07-26) Module casing inconsistency**: Previously 5 files were lowercase
  while imports used PascalCase. All 52 JS files now consistently use PascalCase.
  See §12 for the resolution details.
- **(RESOLVED 2026-07-26) `js/main.js` dead code**: The file existed on disk but was
  not imported anywhere. Was deleted as part of the 2026-07-26 cleanup.
- Graph layout positions are persisted to `VINLAND_GRAPH_LAYOUT` and reapplied
  on every open, with saved nodes **pinned** (`fx`/`fy`) so the force simulation
  does not re-arrange them. New nodes (no saved position) are still free and
  arranged by the simulation until the user drags them.
- Wiki-link auto-routing from text nodes → canvas edges IS implemented:
  `CanvasManager._routeWikiLinks` parses `[[Note Title]]` from a text node's
  body, resolves the target note by title, and auto-creates a `file` node +
  `isWikiLink` edge on edit (and wires to existing file nodes on load).
  Guarded by `tests/wikilink-routing.playwright.spec.mjs`.
- IndexedDB (`OPERATOR_VAULT`) holds media assets + canvas offload + version
  history. Over time, the version history store may need a compaction strategy.
- No CI; tests run manually via `npm test`.
- **(RESOLVED 2026-07-26) `Config.loadFromSync()` duplicate removed** — was
  called twice in boot (lines 499–500, 509–510). Now a single call (line 500).
- The `KanbanManager` operates on `State.BOARDS` and links notes via a
  `kanban_ref` block (`block.boardId`). The note's link is persisted
  synchronously at link time so a board is never orphaned if the tab closes
  before the debounced autosave fires.
- Properties Panel `syncToNote()` has a critical save-ordering invariant:
  it must be called BEFORE `saveData()` in `Notes.save()`, and it derives
  the body from the current `note.content` (not a cached copy), so block
  edits made between render and save are not silently discarded.
- Quick Capture notes are stored in the `/Inbox` folder. The Chrome context
  menu item requires the `contextMenus` permission which is declared in
  `manifest.json`. The service worker (`js/background/service-worker.js`)
  handles the context menu click event.

## 12. (RESOLVED) Module filename casing normalization

**Status: Resolved 2026-07-26.**

The codebase previously had 5 lowercase filenames while import paths used PascalCase.
This worked on macOS (case-insensitive FS) but would have failed on CWS/Linux.

**Files renamed:**

| Old name | New name | Directory |
|---|---|---|
| `commandregistry.js` | `CommandRegistry.js` | `js/core/` |
| `metadatacache.js` | `MetadataCache.js` | `js/core/` |
| `queryengine.js` | `QueryEngine.js` | `js/core/` |
| `dock.js` | `Dock.js` | `js/features/` |
| `clock.js` | `Clock.js` | `js/features/` |

`SafeCalc.js` was already PascalCase and needed no change.

All imports already used PascalCase paths (e.g., `./core/CommandRegistry.js`),
so **no JS files required import path updates**. The only changes were the
5 file renames + documentation updates.

## 13. Test inventory

Tests live in `tests/`. Two families — do NOT confuse them:

### Node unit tests (zero dependencies, `node:assert/strict`)

| File | What it tests |
|---|---|
| `run-all.mjs` | Aggregate runner — runs all unit suites sequentially |
| `notes-unit-tests.mjs` | Pure-function extracts from NotesController (drift risk — keep in sync) |
| `notes-editor-open.test.mjs` | Static-analysis guard: `Notes.open()` must open modal BEFORE `BlockEditor.render()` |
| `storage-shard.test.mjs` | Imports real `Storage.js` + `Store.js` with stubbed `globalThis.localStorage/document` |
| `canvas-unit-tests.mjs` | Canvas manager logic tests |
| `dataview-unit-tests.mjs` | DataviewQuery parser tests |
| `metadata-cache-unit-tests.mjs` | MetadataCache index/write/lookup tests |
| `quickopen-unit-tests.mjs` | QuickOpen search/filter logic tests |
| `import-unit-tests.mjs` | ObsidianImporter / backup import logic tests |
| `helpers.mjs` | Shared test utility functions |

### Playwright E2E tests (headless browser against static server)

Playwright config auto-starts `python3 -m http.server 9999` (kills 8080/8181/9999).
`reuseExistingServer: true`. Reports → `playwright-report/`.

| File | Feature under test |
|---|---|
| `a11y-baseline.playwright.spec.mjs` | Accessibility baseline scan |
| `backlinks.playwright.spec.mjs` | Backlinks panel rendering |
| `backup-sync.playwright.spec.mjs` | Backup/export workflow |
| `calendar.playwright.spec.mjs` | Calendar view interaction |
| `canvas-additional.playwright.spec.mjs` | Canvas: advanced operations |
| `canvas-edge-cases.playwright.spec.mjs` | Canvas: edge cases |
| `canvas-graph.playwright.spec.mjs` | Canvas: force-directed graph |
| `canvas-idb.playwright.spec.mjs` | Canvas: IndexedDB offload |
| `canvas-search.playwright.spec.mjs` | Canvas: node search |
| `code-blocks.playwright.spec.mjs` | Code block tools |
| `dataview-query.playwright.spec.mjs` | Dataview query panel |
| `export.playwright.spec.mjs` | Data export/import |
| `flashcards.playwright.spec.mjs` | Flashcard review session |
| `graph-layout.playwright.spec.mjs` | Graph layout persistence |
| `kanban.playwright.spec.mjs` | Kanban board CRUD |
| `kanban-persist.playwright.spec.mjs` | Kanban: persistence |
| `notes.playwright.spec.mjs` | Notes CRUD workflow |
| `obsidian-import.playwright.spec.mjs` | Obsidian vault import |
| `pomodoro.playwright.spec.mjs` | Pomodoro timer |
| `quick-capture.playwright.spec.mjs` | Quick Capture overlay |
| `quickopen.playwright.spec.mjs` | Quick Open palette |
| `settings-ui.playwright.spec.mjs` | Settings UI interaction |
| `tasks.playwright.spec.mjs` | Task management |
| `template-browser.playwright.spec.mjs` | Template browser |
| `theming-surface.playwright.spec.mjs` | Theme preset application |
| `trash.playwright.spec.mjs` | Trash/delete workflow |
| `ui-polish.playwright.spec.mjs` | UI polish/visual checks |
| `version-history.playwright.spec.mjs` | Version history |
| `wikilink-autocomplete.playwright.spec.mjs` | [[ autocomplete popup |
| `wikilink-routing.playwright.spec.mjs` | Canvas wiki-link auto-routing |

**30 Playwright spec files total.**

### Running tests

```bash
npm test                        # Unit tests only
npm run test:e2e                # Playwright E2E (headless)
npx playwright test --headed    # Visible browser
npx playwright test --ui        # Playwright UI mode
npm run test:all                # Unit + E2E
```
