# Vinland - Design & Architecture

> Single source of truth for the Vinland Chrome new-tab extension.
> All facts verified against source code (`js/*` and `index.html`).
> Last verified: 2026-08-01.

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
11. `SystemCommands.register()` — populate `CommandRegistry` with all **34 commands**
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

> **✅ Filename casing normalized (2026-07-26):** All JS files now use **PascalCase** consistently.
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
| `NotesController.js` | `Notes`, `closeNoteEditor`, `legacyRenderNotes` | Central PKM controller: `create`, `open`, `save`, `delete`, `renderNotes` (Quick Notes list), `toggleSidebar`, `openByTitle`, `togglePreview`, `togglePin`, tag extraction, markdown parsing helpers. 2,419 lines. **Refactored V19.52** — `open()` and `bindEvents()` now delegate to 14 extracted helper methods. |
| `CanvasManager.js` | `CanvasManager` | Infinite spatial canvas: nodes (text/file/embed/group), edges (Shift+drag), zoom/pan, lasso marquee, multi-select, undo/redo (50 states), clipboard (`Cmd+C/V/D`), minimap, context menus, auto-layout (force-directed), zoom slider, collapsible toolbar, auto-save + crash recovery, tag filter bar. Canvas data lives in `note.canvasData`. 4,982 lines. **Refactored V19.53** — 13 helper methods extracted from `renderEdge()`, `_showEdgeContextMenu()`, and `bindEvents()`. |
| `GraphManager.js` | `GraphManager` | D3 force-directed knowledge graph: nodes = notes + boards; edges = `[[wiki links]]` derived from note content. GLOBAL + LOCAL (1-degree) mode. Zoom-to-fit on node click (animates connected subgraph). Rich DOM tooltips on hover. Folder/tag-based graph scoping dropdown. Hover highlights full chain; click opens note/board. Saved node positions pinned (`fx`/`fy`) via `VINLAND_GRAPH_LAYOUT`. |

### `js/features/` - Productivity widgets (HUD peripherals)

| File | Exports | Purpose |
|---|---|---|
| `CommandLine.js` | `CommandLine` | Terminal input (`#cmd-input`): autocomplete suggestions, arrow nav, command history (last 50, key `OPERATOR_HISTORY_V2`), fallback search (8 engines). Shows default hint on load. |
| `Missions.js` | `renderMissions`, `addTask`, `toggleTaskComplete`, `clearCompletedTasks`, `updateProgressBar`, `checkStreakReset` | Task system with priority (`!!/!/~`), time, `@category`. Progress bar + streak tracking. Recurring tasks (`+daily`/`+weekly`/`+monthly`) with auto-respawn. Drag-to-reorder with grip handle. Empty state with CTA. 571 lines. |
| `kanbanmanager.js` | `KanbanManager` | Multi-board kanban: columns/cards, vim keyboard nav (`h/j/k/l`), drag-and-drop, inline contenteditable editing. 800+ lines of pure state management. |
| `Pomodoro.js` | `Pomodoro`, `parseTime`, `startPomodoro`, `loadPomodoroState` | Timer with `chrome.storage.local` cross-tab sync. Supports `25m`, `90s`, `M:SS` formats. 8-bit completion sound + HUD overlay + notification. |
| `Bookmarks.js` | `Bookmarks`, `indexBookmarks`, `renderBottomBar` | Chrome bookmarks browser as bottom bar, folder drill-down with `NAV_STACK` back nav, empty-folder hint. Populates `State.FLAT_BOOKMARKS` for `b` command. |
| `Weather.js` | `Weather`, `fetchWeather` | Open-Meteo API (geocoding + forecast). 30-min cache in `OPERATOR_WEATHER_CACHE`. `SET_LOCATION` empty-state CTA. C/F toggle. |
| `dock.js` | `Dock` | Quick-launch link bar below HUD. Default links: GMAIL, CAL, GPT. Right-click to delete. `+` opens Settings → dock tab. |
| `taskaggregator.js` | `TaskAggregator` | Aggregates all `task`-type blocks from all notes into a single "Task Manager" view, grouped by page, with inline checkboxes. |
| `QuickOpen.js` | `QuickOpen` | VS Code-inspired quick-open palette (Cmd+P / Cmd+Shift+F): full-text search across note titles, content, tags, canvas nodes, and CLI commands. Full-page search results page with staggered entrance animation, recent searches (localStorage). Debounced at 150ms. Results grouped into Notes/Canvas/Tasks/Commands sections with keyboard navigation. 1,792 lines. |
| `Calendar.js` | `Calendar` | Monthly calendar view (Cmd+Shift+C / `calendar` CLI). Shows date-grid with note dot indicators. Click a day to open/create daily note. Prev/next month navigation, "Today" jump button. |
| `DailyAgenda.js` | `DailyAgenda` | Daily notes aggregation view (Cmd+Shift+A / `agenda` CLI). Shows week/month layout of daily note titles with content previews. Navigate between periods, click cards to open notes. |
| `TagBrowser.js` | `TagBrowser` | Tag browser modal (Cmd+Shift+T / `tags` CLI): lists all tags with counts, real-time search/filter, click-to-filter notes in sidebar. |
| `TemplateBrowser.js` | `TemplateBrowser` | Template browser (Cmd+Shift+N / `template` CLI): opens modal showing all notes in `/Templates` folder, creates new notes pre-populated from selected template. Supports YAML frontmatter in templates. |
| `QuickCapture.js` | `QuickCapture` | Quick Capture overlay (Cmd+Shift+I): minimal input for instantly capturing thoughts into `/Inbox` folder. Inbox preview for triaging captures. Chrome context menu "Send to Vinland Inbox". |
| `BackupManager.js` | `BackupManager` | Auto-backup and Google Drive sync (V19.56: Drive-first). Canonical backup payload via `buildBackupData()` (v2: config/tasks/notes/boards/canvases/commands) shared by top-bar download, BACKUP NOW, and Drive push. Auto-backup interval fires `triggerBackup(driveConnected ? 'drive' : 'auto')` per tick — Drive connected → push to Drive only; disconnected → local download. OAuth `drive.file` scope in manifest; `loadDriveState()` re-validates the token on init (marks disconnected when stale). 401/403-aware `_updateDriveFile` (refresh once → retry once → invalidate; 404 is the only recreate path) with `_driveErrorCode()` classification threading honest auth/not_found/error messages through `syncFromDrive`. Setup: `docs/google-drive-sync.md`. Persists backup config to `OPERATOR_CONFIG_V3`. |
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
| `FormatToolbar.js` | `FormatToolbar` | Floating formatting toolbar (B/I/U/S/code) on text selection inside canvas card body. Positions above selection, flips below if near viewport top. Active-state toggle for each format button. |

### `js/editor/` - The note editor engine

| File | Exports | Purpose |
|---|---|---|
| `BlockEditor.js` | `BlockEditor`, `HistoryManager` | Notion-style block editor: block types (text/h1/h2/h3/task/bullet/code/divider/quote/canvas/kanban/query/callout/image/table/dataview), drag handles, slash command, multi-select, clipboard, indent. 120KB. |
| `PageManager.js` | `PageManager`, `parseContentToBlocks`, `sanitizePath` | Data model syncing between block format ↔ markdown content. Schema migrations (`migrateNotesToPathSchema`, `migrateNotesToBlockSchema`). |

### `js/config/` - Command population

| File | Exports | Purpose |
|---|---|---|
| `SystemCommands.js` | `SystemCommands` | Registers all **34 CLI commands** into `CommandRegistry`. |

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

Registered in `js/config/SystemCommands.js`. **34 commands total.**

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
| `attachments` | `attachments:list` | `[upload\|list]` | Open attachment browser (insert into active note) |

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
  and Playwright E2E tests. See §14 for full test inventory.
- **CI**: GitHub Actions runs on every push/PR to `main`. See §12 for workflow details.
  Consecutive green runs maintained since V19.48+ (2026-08-01).
- **Refactoring pattern**: Large functions (`open()`, `bindEvents()`, `renderEdge()`,
  `_showEdgeContextMenu()`) are decomposed via **pure extraction** into `_`-prefixed helper
  methods. No behavioral changes — each extraction commit is a pure move of inline code
  into named methods. This pattern is preferred over file splitting because these modules
  share a closure/state that would require passing `this` through call chains.
- **`PROJECT_BLUEPRINT.md`** was deleted on 2026-07-26 (stale — still referenced
  the deleted `main.js`). The canonical file map is `docs/design.md` (this file).
- **`Config.loadFromSync()` is called once** in the boot sequence (line 500).
  The duplicate was removed in V19.47+ (2026-07-26).

## 10. Recent changes

- **V19.57** (2026-08-01): **Release-candidate pass — real extension-context smoke gate + packaging**. New `tests/release-candidate.playwright.spec.mjs` (7 tests) is the ONLY spec that loads the actual unpacked extension in a persistent Chromium profile (`chrome-extension://` origin, MV3 service worker, `chrome.identity`/`chrome.storage`/`chrome.runtime` present, `runtime.id` matches). It gates: zero uncaught page errors + zero console errors + zero failed resource requests on boot; note lifecycle persisting in real extension storage; canvas board render; task CLI → mission list; quick-open search; settings SYNC tab + Drive fail-fast toast (placeholder client ID) + BACKUP NOW updating `last_backup_time`; notes surviving a full reload. The gate immediately caught a real bug: `SettingsUI.initBackground()` requested the non-existent `background.mp4` on every boot (`net::ERR_FILE_NOT_FOUND`) when no backgrounds were configured — fixed to hide the background layers and let the active theme's surface (CSS `--bg-color`) show through. (An earlier revision set an inline body color as a solid fallback, but that overrode light themes like retroma — caught by the `ui-polish` retroma E2E and corrected; no inline color is set, matching the effective pre-existing behavior without the 404.) New `scripts/package-release.sh` zips the extension root to `dist/vinland-v<version>.zip` (excludes dev/tooling: tests, docs, .crush 38MB DB, node_modules, etc.). New dedicated `release-candidate` CI job (excluded from the sharded matrix via `--grep-invert "Release Candidate"`). `manifest.json` version aligned to changelog (**19.57**). `.gitignore` gains `dist/` + `test-results/`. **Release pipeline hardened same day** — `scripts/package-release.sh` gained an 80MB size guard (CWS caps at 100MB), a composition report (10 largest included paths), and junk exclusions surfaced by it: `.Git/*` (capital-G APFS variant — a 17.7MB pack file was shipping past the case-sensitive `*.git*` pattern) and `.venv*` (~7MB Python venv), cutting the store zip from **27MB → 541KB**. New `package-check` CI job builds the zip on every push (exit 1 on bloat; artifact uploaded `if: always()` for failure inspection). Gate proven by a bloat drill: a temporary 85MB `/dev/urandom` asset failed `package-check` with `ERROR: ... is 86M (>80MB)` while all other 7 jobs passed; removal restored full green. Exclusions pinned by new `tests/package-exclusions-unit-tests.mjs` (6 tests). v19.57 release asset re-uploaded with the lean zip (SHA-256 verified).

- **V19.56** (2026-08-01): **Cloud Sync overhaul + auto-backup Drive-first** — sync series (4 commits + test-fix) resolving the settings-audit blockers:
  - **OAuth config** (71f4157): `manifest.json` ships an `oauth2` block (`drive.file` scope); `connectDrive()` fails fast with an actionable toast when the client ID is missing/placeholder. Setup walkthrough in `docs/google-drive-sync.md`. `loadDriveState()` re-validates the stored `connected` flag via `getAuthToken({interactive:false})` on init and marks itself disconnected when the cached token is gone — no more lying "Connected" badge.
  - **Canvas parity** (71f4157): `buildBackupData()` (v2) and `importFromSync()` now include/restore `State.CANVASES` — Drive backups previously dropped all canvas boards.
  - **401/403-aware `_updateDriveFile`** (71f4157): auth errors refresh the token once and retry a single time, then invalidate the connection — never treated as "file deleted" (which silently created duplicate backup files on every failed sync). 404 remains the only recreate path.
  - **Canonical backup builder** (9080ab3): `SettingsUI.exportAllData()` now delegates to `BackupManager.buildBackupData()` — one canonical payload (config/tasks/notes/boards/canvases/commands) shared by the top-bar download, BACKUP NOW, and Drive push.
  - **Honest Drive messages** (9080ab3): `_driveErrorCode()` classifies HTTP status into `auth` (401/403) | `not_found` (404) | `error`; the code threads through the find→get→download→`syncFromDrive` chain, so a dead token toasts "Auth expired — reconnect Drive" instead of the misleading "NO BACKUP FOUND ON DRIVE". `syncToDrive` aborts on auth/network instead of creating a duplicate file.
  - **Restore reload hint** (9080ab3): `importFromSync` shows "DATA RESTORED FROM DRIVE // RELOAD RECOMMENDED" and reloads after 1.5s; also restores `COMMAND_HISTORY`. Both importers accept `commands` (canonical) or `history` (legacy) keys.
  - **Auto-backup Drive-first** (afb9807): `scheduleAutoBackup()` fires `triggerBackup(driveConnected ? 'drive' : 'auto')` per tick — no more Downloads-folder JSON spam when Drive is connected (local download fallback when not). `driveConnected` is evaluated at fire-time, so connecting mid-interval switches on the next tick.
  - **Interval through the SAVE flow** (afb9807): the `cfg-auto-backup` onchange no longer immediate-saves (which bypassed dirty tracking entirely); it stages the change → `checkDirty()` shows `SAVE *` → `saveConfigFromUI()` persists + reschedules the timer (saving OFF stops it). `getConfigFromUI()` strips volatile `last_backup_time`/`drive_last_sync` so a background backup/sync no longer trips a false `SAVE *`; the raw-JSON path also reschedules.
  - **Tests**: `tests/backup-manager-unit-tests.mjs` (020f252, 7 tests, mocked fetch) covers `_driveErrorCode` classification, 200 success, 404 recreate, 401 refresh+retry-once-no-duplicate, refresh-fail, retried-still-401 disconnect, fetch rejection. Export spec fixed for the canonical key (`1187a32`). Backup-sync E2E 8/8; full unit suite + CI green.

- **V19.55** (2026-07-29): **Attachment Manager** — new `js/core/AttachmentsManager.js` (562 lines) backed by the existing IndexedDB `media_assets` store (`OPERATOR_VAULT`). `attachments` CLI command opens the Attachment Browser modal (upload button, thumbnail grid, per-file delete, count + total-size footer, empty state). Selecting an attachment inserts an image block into the active note via `getDataURL()` (the block renderer reads `block.content`/`url`, not an IDB key). Object URL lifecycle: cached per attachment, revoked on delete and on `beforeunload`. 18 new unit tests (`tests/attachments-unit-tests.mjs`, registered in `run-all.mjs`). **Canvas-tag indexing started** — `MetadataCache` now includes canvas node body/tag content in per-note full-text + tag indexing (first half of the TagBrowser integration roadmap item; click-to-filter side still pending).

- **V19.54** (2026-07-29): Canvas edge style picker — color swatches (6 colors), width picker (1–4), dashed toggle via edge right-click context menu. Canvas tag filter bar — filter visible nodes by #tag, tag dropdown with counts. GitHub Actions CI fixed (Node.js 24, no E2E test breaking, green across 14 suites). Design doc reconciled to V19.54.

- **V19.53** (2026-07-28): **CanvasManager massive refactoring (Phase C1–C3)** — 13 helper methods extracted across 3 phases, identical to the NotesController approach. C1: 5 edge-rendering helpers (`_calcBezierControlPoints`, `_buildEdgePathString`, `_resolveEdgeStyles`, `_renderWaypointHandles`, `_renderEdgeHoverHint`) extracted from `renderEdge()`. C2: 3 context-menu helpers (`_buildEdgeMenuHTML`, `_handleEdgeMenuAction`, `_setupCloseOnOutsideClick`) extracted from `_showEdgeContextMenu()`. C3: 5 event-binding handlers (`_bindKeyboardShortcuts`, `_bindCanvasMouseEvents`, `_bindGlobalMoveEvents`, `_bindWheelZoom`, `_bindCanvasContextMenu`) extracted from `bindEvents()`. `bindEvents()` went from 430 inline lines to a 6-line delegation chain. `renderEdge()` went from 200+ lines to a 35-line clean delegation chain.

- **V19.52** (2026-07-28): **NotesController massive refactoring (Phase 1a–2f)** — 14 methods extracted from the two largest functions. From `open()`: `_cleanupAutoNote`, `_savePreviousNote`, `_resolveNote`, `_setupNoteState`, `_setupEditorContainers`, `_renderEditor`, `_renderTrashBanner`, `_refreshSidebar`. From `bindEvents()`: `_bindSidebarSearch`, `_bindShortcuts`, `_bindPreviewClicks`, `_bindEditorInputs`, `_bindSidebarButtons`, `_bindToolbarHandlers`. Both functions are now clean delegation chains under 30 lines. Pure extraction — zero behavioral changes. All 643 unit tests pass.

- **V19.51** (2026-07-28): UX audit fixes — global error boundary (`window.onerror` + `unhandledrejection` handler), boot loader spinner with noscript fallback, improved `showNotification()` toast (3s auto-dismiss + CSS transitions). Modal stack indicator — pill tabs showing open modals, click to reorder and focus. Breadcrumb navigation for note path hierarchy (clickable `/`-delimited segments). CLI command suggestions with fuzzy matching and match highlighting. Side-by-side sidebar — wider note editor modal, drag-to-resize split, responsive collapse on narrow viewports. `FormatToolbar.js` created — floating B/I/U/S/code bar on text selection in canvas card body. Backup download button in main toolbar. History API (`pushState`/`popstate`) for browser back/forward note navigation. A11y baseline: `role=button`, `tabindex=0`, `aria-label` on 13 close-modal spans. Three remaining UX audit items shipped: date display in search results, `prefers-reduced-motion` support, saved confirmation toast.

- **V19.50** (2026-07-28): **Search overhaul** — full-page search results page (Cmd+Shift+F) with staggered fade-in/slide-up animation (`@keyframes srpResultIn`). Results grouped by Notes/Canvas/Tasks/Commands with per-section counts. Recent searches persisted to localStorage (last 10, click to repeat). Canvas node content search integrated into QuickOpen. **Missions upgrade** — recurring tasks with `+daily`, `+weekly`, `+monthly` prefixes (auto-respawn on completion). Drag-to-reorder with grip handle, ghost element, glow pulse animation. Recurrence config panel with interval picker (daily/weekly/monthly) and day-of-week selector for weekly tasks. Note pinning — pin notes to top of sidebar via star icon, `togglePin()` with persistence.

- **V19.49** (2026-07-28): **Graph overhaul** — GraphCon-inspired zoom-to-fit on node click (animates connected subgraph into view). Rich DOM tooltips on node hover (note title + content preview + tag count). Folder/tag-based graph scoping dropdown — filter visible graph nodes by note path or tag. **Canvas power tools** — auto-layout button running force-directed `d3.forceSimulation` on selected or all nodes (configurable iterations 50/100/300). Zoom slider (10%–500%) for precise zoom control. Collapsible toolbar with ◀/▶ toggle, persists to localStorage. Empty-area right-click context menu with Add Node, Auto-Layout, Paste, Reset View. Auto-save + crash recovery — periodic save (every 30s), auto-save indicator dot in toolbar, crash recovery prompt with snapshot preview on reload.

- **V19.48** (2026-07-28): **Canvas edge system** — bezier curves with perpendicular offset for all orientations (horizontal/vertical/diagonal). Edge waypoints with drag-to-move handles and right-click-to-delete. Edge hover glow effect (`stroke-width` + opacity transition). Full edge context menu: color swatches (6 colors: default, red, blue, green, orange, purple), width picker (1–4px), dashed toggle, label editing, delete edge. **Table column resize** — drag handles between table header cells (`col-resize` cursor), live column width sync, min-width clamping (80px), reset-to-auto button in table toolbar. 36 unit tests. **Block Editor UX** — block duplicate action (Cmd+D, button in block toolbar). In-editor find/replace (Cmd+F) with text highlighting, match navigation, replace mode (Cmd+H). Code block language selector. Wiki-link autocomplete now supports "Create new note" when `[[` query has no matches. `/color` command via SlashMenu (6 preset colors). Canvas rich-text formatting toolbar (B/I/U/S/code) on text selection. Canvas markdown auto-format (`**bold**` → `<strong>`, `*italic*` → `<em>`) on blur/enter. Canvas keyboard nudging (arrow keys 1px, Shift+arrow 10px) + zoom-to-selection (Alt+Z).

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
  while imports used PascalCase. All JS files now consistently use PascalCase.
  See §13 for the resolution details.
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
- **(RESOLVED 2026-07-28) No CI**: GitHub Actions CI was set up and is now fully green (all 16 unit suites + 34 E2E specs pass, Node.js 24). Runs on push/PR to `main`. See `.github/workflows/ci.yml` and §12.
- **(RESOLVED 2026-07-28) Config.loadFromSync() duplicate removed** — was
  called twice in boot (lines 499–500, 509–510). Now a single call (line 500).
  _(Already marked resolved in V19.47+, re-verified.)_

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
- Canvas tags (`#tag` in canvas card body) are filtered in-canvas and are now
  **indexed by `MetadataCache`** (V19.55 — canvas node body/tag content joins the
  per-note full-text + tag index). The remaining half of the integration —
  making canvas tags **clickable/filterable from the global TagBrowser**
  (`Cmd+Shift+T`) — is still pending.
- **Export-path asymmetry (V19.56, intentional)**: three export paths emit two payload shapes — the CLI `export` (`NotesController.downloadNotes`) still emits v1/`history`, while settings EXPORT CONFIG and BACKUP NOW emit v2/`commands` via the canonical `buildBackupData()`. Both importers accept `commands` || `history`, so round-trips are safe. `export.playwright.spec.mjs` tests 1/2 assert the CLI shape, test 3 asserts the canonical shape — do not "unify" the CLI path without updating those assertions.
- **Live Drive round-trip not verifiable in CI (V19.56)**: the Playwright/browser-use environment is a plain-HTTP page with no `chrome.identity`, so the real OAuth connect → sync → restore cycle can only be verified manually with a real client ID in `manifest.json` (`oauth2.client_id`) inside a loaded unpacked extension. The fail-fast guard (actionable toast on placeholder ID) and all 401/404 paths are unit- and E2E-covered.

## 12. GitHub Actions CI + release pipeline

**Status: Operational on all commits since V19.48+.**

- Workflow: `.github/workflows/ci.yml`
- Runs on `push` and `pull_request` to `main`
- Actions: `actions/checkout@v5` / `actions/setup-node@v5`, Node.js 24 pinned (20 was deprecated by GitHub Actions runners in 2025-09)
- **8 jobs, all green on every push:**

| Job | What it runs | Purpose |
|---|---|---|
| `unit-tests` | `npm test` (16 unit suites) | Zero-dependency `node:assert` suites |
| `e2e-tests` (1–4) | `npx playwright test --grep-invert "CLI command sweep\|Release Candidate" --shard=N/4` | 32 E2E specs split across 4 parallel shards |
| `cli-sweep` | `tests/cli-commands.playwright.spec.mjs` | All 34 CLI commands with deterministic assertions (dedicated job — isolated runtime) |
| `release-candidate` | `tests/release-candidate.playwright.spec.mjs` | ONLY job that loads the real unpacked extension (chrome-extension:// origin, MV3 SW, chrome.identity/storage) |
| `package-check` | `bash scripts/package-release.sh` | Builds the store zip; **exit 1 if it exceeds 80MB** — bloat breaks CI instead of shipping |

**Store-package pipeline (`scripts/package-release.sh`):**

- Zips the extension root to `dist/vinland-v<version>.zip` — excludes dev/tooling: `tests/`, `docs/`, `node_modules/`, `.git*`/`.Git/*` (APFS quirk), `.venv*`, `scripts/`, `playwright-report/`, `test-results/`, `dist/`, `__pycache__/`, `package.json`, `package-lock.json`, ...
- **80MB size guard**: exits 1 if the zip exceeds 80MB (Chrome Web Store caps at 100MB)
- **Composition report**: prints the 10 largest included paths (human-readable) so asset bloat is visible in the run log
- Zip artifact uploaded with `if: always()` so a bloated zip stays downloadable for inspection after a failed run
- **Real payload is ~541KB** (was 27MB before the `.Git`/`.venv` junk exclusions, 2026-08-01)
- **Proven by the bloat drill** (2026-08-01): a temporary 85MB `/dev/urandom` asset failed `package-check` with `ERROR: ... is 86M (>80MB)` while all other 7 jobs passed; removal restored full green
- **Pinned by `tests/package-exclusions-unit-tests.mjs`** (6 tests): static exclusion-pattern check + behavioral build/unzip assertions + direct 80MB size check

## 13. (RESOLVED) Module filename casing normalization

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

## 14. Test inventory

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
| `fuzzy-unit-tests.mjs` | CommandRegistry fuzzy matching algorithm (41 tests) |
| `missions-unit-tests.mjs` | Missions addTask, toggle, reorder, streak, sorting (57 tests) |
| `snap-grid-unit-tests.mjs` | Canvas snap-to-grid rounding and DOM updates |
| `table-column-unit-tests.mjs` | Table column syncColumnWidths, clamp, lifecycle (36 tests) |
| `import-unit-tests.mjs` | ObsidianImporter / backup import logic tests |
| `backup-manager-unit-tests.mjs` | BackupManager._updateDriveFile 401/404/refresh paths with mocked fetch (7 tests) |
| `package-exclusions-unit-tests.mjs` | Store-zip exclusions: static pattern check + behavioral build/unzip assertions + 80MB size check (6 tests) |
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
| `cli-commands.playwright.spec.mjs` | CLI command sweep — all 34 commands (dedicated `cli-sweep` CI job) |
| `code-blocks.playwright.spec.mjs` | Code block tools |
| `dataview-query.playwright.spec.mjs` | Dataview query panel |
| `export.playwright.spec.mjs` | Data export/import |
| `flashcards.playwright.spec.mjs` | Flashcard review session |
| `graph-layout.playwright.spec.mjs` | Graph layout persistence |
| `kanban.playwright.spec.mjs` | Kanban board CRUD |
| `kanban-persist.playwright.spec.mjs` | Kanban: persistence |
| `notes.playwright.spec.mjs` | Notes CRUD workflow |
| `obsidian-import.playwright.spec.mjs` | Obsidian vault import |
| `paste-smoke.playwright.spec.mjs` | Paste pipeline smoke (images, code blocks, text-to-blocks) |
| `pomodoro.playwright.spec.mjs` | Pomodoro timer |
| `quick-capture.playwright.spec.mjs` | Quick Capture overlay |
| `quickopen.playwright.spec.mjs` | Quick Open palette |
| `release-candidate.playwright.spec.mjs` | **Real unpacked-extension smoke** (chrome-extension:// origin, MV3 SW, extension APIs) — runs in its own `release-candidate` CI job |
| `settings-ui.playwright.spec.mjs` | Settings UI interaction |
| `tasks.playwright.spec.mjs` | Task management |
| `template-browser.playwright.spec.mjs` | Template browser |
| `theming-surface.playwright.spec.mjs` | Theme preset application |
| `trash.playwright.spec.mjs` | Trash/delete workflow |
| `ui-polish.playwright.spec.mjs` | UI polish/visual checks |
| `version-history.playwright.spec.mjs` | Version history |
| `wikilink-autocomplete.playwright.spec.mjs` | [[ autocomplete popup |
| `wikilink-routing.playwright.spec.mjs` | Canvas wiki-link auto-routing |
| `local-graph.playwright.spec.mjs` | Per-note local graph (D3 force rendering) |

**34 Playwright spec files total.**

### Running tests

```bash
npm test                        # Unit tests only
npm run test:e2e                # Playwright E2E (headless)
npx playwright test --headed    # Visible browser
npx playwright test --ui        # Playwright UI mode
npm run test:all                # Unit + E2E
```
