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
  the app: `./d3.v7.min.js` (vendored, BSD-3-Clause, notice preserved in the
  file header — for graph/canvas) and `js/boot.js` (ES module).
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

#### MetadataCache — function inventory (≈0.5k lines)

| Function | What it does |
|---|---|
| `init()` | Build the whole tag/link/backlink index from all notes |
| `parseFrontmatter(content)` | Parse YAML frontmatter (`--- key: value ---`) |
| `extractTags(content)` | Extract tags — #hashtags + frontmatter tags (handles numeric tags) |
| `extractWikiLinks(content)` | Extract `[[Page]]` / `[[Page|Alias]]` |
| `updateNote(note)` | Update metadata for a note (coalesces full-index persistence) |
| `removeNote(id)` | Remove note from cache |
| `updateTagIndex()` / `updateLinkIndex()` | Rebuild tag index / link index + backlinks |
| `get(id)` / `getByTag(tag)` / `getBacklinks(title)` / `getLinkingNotes(title)` / `getAllTags()` | O(1)-ish cached lookups |
| `search(query)` | Simple text search across notes |
| `query(prop, value)` | Query notes by frontmatter property |
| `_notesFingerprint()` | Cheap vault fingerprint: count + newest modified + rolling id hash — detects vault changes |
| `_markCacheDirty()` / `_flushCache()` | Debounced full-index write (+ unload-hook flush) |
| `saveCache()` / `loadCache()` | Persist; load only when schema-valid AND fingerprint matches, else rebuild |
| `getStats()` | Cache statistics |

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

#### BlockEditor — function inventory (≈3.8k lines)

`HistoryManager` lives at the top of this file (lines 1–50) — it is the
embedded undo/redo stack.

| Function | What it does |
|---|---|
| `HistoryManager.push/undo/redo` | Snapshot current block state / undo / redo |
| `_getActivePage()` | Resolve the active note page (O(1) via `State.getNote`) |
| `getCalloutIcon(type)` | Icon/SVG for a callout type |
| `_getTypeLabel(type)` | Block-type badge label for the block chrome |
| `getCalcPreviewHtml(expr)` | Live `= expr` calculator preview HTML |
| `safeMathEval(expr)` | CSP-safe arithmetic evaluation (no `eval`) |
| `highlightSyntax(code, lang)` | Inline syntax highlighting for code content |
| `htmlToMarkdown(domHtml)` | DOM HTML (execCommand/paste output) → Vinland markdown |
| `markdownToHtml(md)` | Markdown → HTML for the WYSIWYG; **sanitizes links** (security-critical) |
| `setSelectionOffsets(…)` | Set caret/text selection by offsets |
| `applyFormatting(cmd)` | Apply B/I/U/L/inline formatting with immediate visual feedback |
| `init()` | Lifecycle entry: binds marquee, keydown, container, outside-click, block-mousedown |
| `processImageFile(file)` | Read an image file into a block (FileReader → data URL) |
| `handleDrop(e)` | Drag-and-drop of files/text into blocks |
| `render()` | Render all blocks; smart numbering; find highlights if active |
| `_updateStats()` | Block/task/word counts for the editor footer |
| `duplicateBlock(id)` / `focusBlock(id)` | Clone a block / focus a block's contenteditable |
| `selectBlock/selectRange/selectAll/clearSelection` | Selection system incl. range + multi-select |
| `updateSelectionVisuals()` / `getSelectedBlocks()` | Multi-select visuals + getter |
| `reorderBlock(…)/reorderSelectedBlocks(…)` | Drag reorder (splice to correct index) |
| `renderBlock(block)` | Build block wrapper HTML by type |
| `_createBlockChrome(block)` | Drag handle, type badge, duplicate, indent, alignment, color chrome |
| `_renderHeading/Task/List/Quote/Divider/ParagraphBlock` | Per-type block renderers |
| `_renderCodeBlock(block)` | Markdown → HTML code blocks; enhances with line numbers/copy/Tab (via CodeBlockTools) |
| `_renderCalloutBlock(block)` | Callouts with body + edit button |
| `_renderImageBlock(block)` | Image blocks with delete/edit UI |
| `_renderKanbanBlock(block)` | Inline kanban; board linking persisted; smart Enter injector |
| `_renderTableBlock(block)` | Tables with resizable column widths + toolbar actions |
| `_renderQueryBlock(block)` | Dataview query execution + result render inside the block |
| `_renderEmbedBlock(block)` | `![[Note]]` transclusion preview (read-only render) |
| `_renderLocalGraph` + `_wireLocalGraphToggle` + `_gatherLocalGraphConnections` + `_buildLocalGraphSim` + `_drawLocalGraphLinks` + `_drawLocalGraphNodes` + `_attachLocalGraphTick` | Local backlink/forward-link graph inside the editor |
| `_escapeRegExp(s)` | Regex-escape helper (find/replace) |
| `_findOpen/Close/Search/Next/Prev/UpdateCount/GetBlockEl/UpdateCurrentHighlight/ScrollToCurrent/ToggleReplace/Replace/ReplaceAll/ApplyHighlights/HighlightTextNodes/InitFindBar` | Full find & replace subsystem with `<mark>` highlights + replace-all |
| `handleKeydown(e)` | Central keydown dispatch → the `_kHandle*` handlers |
| `_kHandleEscapeClear/CodeTab/CloseTab/TabSwitch` | Esc-clear, Tab-in-code, Cmd+Shift+X close tab, Cmd+1-9 tab switch |
| `_kHandleFindOpen/Toggle/Navigate/Close` | Find-bar keyboard bindings |
| `_kHandleCalcEval` | Evaluate `=` block on hotkey |
| `_kHandleUndoRedo` | Cmd+Z / Cmd+Shift+Z |
| `_kHandleMultiDelete` | Delete all selected blocks |
| `_kHandleCopy/Cut/Duplicate/Indent` | Copy/cut selected, duplicate block, indent handling |
| `_kHandleAltArrowMove` | Move selected blocks with Alt+Arrow |
| `_kHandleEnterSplit` | Smart Enter: split block, list/quote continuation, empty-item revert to paragraph |
| `_kHandleBackspaceMerge` | Backspace at block start → merge with previous |
| `_kHandleArrowNav` | Arrow navigation incl. Cmd+Arrow jump to start/end |
| `_kHandleFormat` / `_kHandleSlashTrigger` | Formatting hotkeys / `/` slash-menu trigger |
| `flashBlock(el)` | Brief highlight flash (reorder/type-change feedback) |
| `checkInputRules(el)` | Markdown input rules — auto-convert paragraphs on trigger patterns (`- `, `# `, `> `, `---` …) |
| `handleInput(e)` | Input event → WYSIWYG sync, debounced autosave, MetadataCache update, `[[` check |
| `handleClick(e)` | Click handling incl. focus-last-block behavior |
| `handlePaste(e)` | Paste entry → routes to image / code / text handlers |
| `_pHandleImagePaste` / `_pHandleCodePaste` / `_pHandleTextToBlocks` | Paste sub-handlers (image file, code block, multi-block text) |

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

#### QuickOpen — function inventory (≈1.7k lines)

| Function | What it does |
|---|---|
| `init()` | Called once from `boot.js` |
| `toggle()` / `open(searchMode)` / `close()` | Palette open/close; `searchMode` = content search (Cmd+Shift+F) |
| `searchFromCLI(query)` | Search from the `find <query>` CLI command |
| `_injectDOM()` | Inject palette DOM on first init |
| `_showSearchPrompt()` | Content-search prompt footer (guides typing) |
| `_showInitialResults()` | Recent notes + all commands |
| `_onInput()` / `_executeSearch()` | Debounced input → full search across notes/tags/commands (25-result cap) |
| `_render()` | Render results into the DOM |
| `_getAbsoluteIndex()` / `_updateSelection()` / `_activateResult()` | Selection + execute by absolute index |
| `_bindEvents()` / `_unbindEvents()` / `_onKeyDown()` | Palette keyboard nav |
| `_escapeHtml()` | Escape — string-replacement based so it works in browser **and** Node (unit tests) |
| `_formatDate()` | 'Today' / 'Yesterday' / weekday / short date |
| `openResultsPage(query)` | Full-page search-results overlay (Cmd+Shift+F) |
| `_injectResultsPageDOM()` / `_injectResultsPageStyles()` | Results-page DOM + one-time styles |
| `_saveRecentQuery()` / `_showRecentSearches()` | Recent searches (localStorage, max 10) |
| `_renderResultsPage()` / `_updateResultsPageSelection()` / `_activateResultsPage()` | Results-page render with highlighting + selection |
| `_closeResultsPage()` / `_bindResultsPageEvents()` / `_unbindResultsPageEvents()` / `_onResultsPageInput()` | Results-page lifecycle + debounced input |

---

## 5. Modules (`js/modules/`)

- **NotesController** — note CRUD, `openByTitle`, transclusion, template
  resolution, frontmatter injection. Contains standalone helpers (HTML
  escaping, line-break handling). Guards against `sessionStorage` full.

#### NotesController — function inventory (≈2.4k lines)

| Function | What it does |
|---|---|
| `_bindShortcuts()` | Cmd+N new note, Cmd+P pin, global editor shortcuts |
| `_bindPreviewClicks()` | Preview HUD/embed click handling |
| `_bindEditorInputs()` / `_bindToolbarHandlers()` | Editor input + toolbar (breadcrumb toggle, path edit, maximize) listeners |
| `_bindSidebarButtons()` / `_bindSidebarSearch()` | Sidebar buttons (folder create, preview toggle) + filter search |
| `_cleanupAutoNote()` | Garbage-collect auto-created empty notes when switching away |
| `_savePreviousNote()` | Save or GC the previous note before switching (canvas notes exempt — never GC) |
| `_resolveNote(id)` | id → note, fallback to first note, or create if empty |
| `_setupEditorContainers()` | Route to canvas vs standard editor containers; returns true when canvas |
| `_renderEditor()` | Render the editor in preview or edit mode |
| `_renderTrashBanner()` | Trash banner + read-only mode for notes in `/Trash` |
| `_refreshSidebar()` | Refresh sidebar, tags, word count, pin, backlinks, version history |
| `_setupNoteState()` | Note state: tab, blocks migration (ensure blocks exist), title input |
| `_pushHistoryState()` / `_handlePopState()` | Browser back/forward navigation between notes |
| `_checkUrlForNote()` | Deep-link support — restore note from URL params |
| `openByTitle(title)` | Open a note by title (O(1) via `State.getNoteByTitle`) |
| `toggleSidebar()` + `_initSidebar()` + `_initSidebarResize()` + `onMouseMove/onMouseUp` | Sidebar show/hide + drag resize (clamped 180–500px) |
| `getPlainTextPreview(note)` | Plain-text teaser for the Quick Notes list |
| `_filterSidebarByPath(path)` | Filter sidebar to a specific folder |
| `_renderBreadcrumb()` | Path breadcrumb in the editor header (last segment not clickable) |
| `renderNotes()` | Render the sidebar note tree (auto show/hide by count) |
| `init()` / `bindEvents()` | Lifecycle; restores maximized state |
| `open(noteId)` | Open a note in the editor modal (alias used externally) |
| `create(title, template)` | Create a note (title rules, template content, frontmatter strip) |
| `_findTemplate(name)` / `_applyTemplateToNote(note)` / `createFromTemplate()` | Template notes: find by title/name, copy content, create via TemplateBrowser |
| `delete(id)` | Delete note — MetadataCache + version-history cleanup wired in |
| `clearEditor()` | Clear the editor DOM |
| `save()` | Save: frontmatter sync (PropertiesPanel), MetadataCache update, version snapshot, flashcard incremental rescan, backlinks refresh |
| `saveExpandedState()` / `registerFolder()` / `unregisterFolder()` | Sidebar folder persistence (explicit folders persist even when empty) |
| `moveNote(id, path)` / `moveFolder(from, to)` / `deleteFolder(path)` | Note/folder management (folder can't move into itself) |
| `autoSave()` | Debounced autosave |
| `togglePreview()` / `togglePin()` | Preview mode / pin toggle with editor re-render |
| `renderBacklinks()` | Backlinks panel via MetadataCache (merge + dedupe, content snippets) |
| `_escapeHtml(s)` | Escape helper (alias of `Utils.safeText`, backward-compat) |
| `getKanbanPreviewHtml(note)` | Rich kanban preview HTML (synced with BlockEditor) |
| `togglePreviewTask(id)` | Toggle a checkbox in preview |
| `bindPreviewListeners()` | Preview interactions (delegated kanban clicks, text sync) |
| `renderMarkdown(md)` | Markdown rendering engine: transclusion `![[…]]`, alignment markers, tables, calc preview, backlinks |
| `processTableLines(lines)` | Table line parsing (alignments) |
| `updateWordCount()` / `updateTags()` / `extractTags()` / `filterByTag()` / `updateAllTags()` | Word count + tag pipeline (fenced-code-aware extraction; MetadataCache-backed with manual fallback) |
| `toggleSelectionMode()` / `toggleSelection()` / `deleteSelected()` | Multi-select note mode |
| `openGraph()` / `closeGraph()` | Knowledge graph modal |
| `downloadNotes()` | Export all data (notes, tasks, boards, canvases, config, history) as JSON |

- **CanvasManager** — infinite spatial canvas: nodes/edges, lasso select,
  undo/redo, minimap, zoom slider, tag filter bar, auto-save status
  indicator, toolbar collapse toggle, edge hover glow. Node pinning
  (fx/fy freeze), layout reset, camera fit.

#### CanvasManager — function inventory (≈5k lines)

| Function | What it does |
|---|---|
| `_snapToGrid(v)` / `_snapNodePosition(node)` | Grid snapping |
| `_getActiveNote()` | Active note (canvas data lives in `note.canvasData`) |
| `_saveData()` / `_markDirty()` | Persist + dirty flag |
| `_startAutoSave()` / `_stopAutoSave()` / `_autoSaveTick()` / `_setAutoSaveStatus()` | Autosave loop + status indicator |
| `_saveRecoverySnapshot()` / `_checkRecovery()` / `_clearRecoverySnapshot()` | Crash-recovery snapshots |
| `_getWorldCenter()` | World/camera center |
| `selectNode()` / `deselectNode()` / `clearSelection()` | Node selection |
| `deleteSelectedNodes()` / `copySelectedNodes()` / `pasteCopiedNodes()` / `duplicateSelectedNodes()` | Clipboard + bulk ops |
| `getMouseWorldCoords(e)` | Screen → world coordinates |
| `_saveHistoryState()` / `undo()` / `redo()` | Canvas history (undo/redo) |
| `init()` | Lifecycle: imports, toolbar, tag filter, event wiring |
| `load()` / `doRecover()` / `doDiscard()` | Data loading + recovery prompt decisions |
| `updateUI()` / `bindToolbar()` | UI refresh + toolbar wiring |
| `_showNotePicker()` / `_closeNotePicker()` / `_showUrlPicker()` / `_closeUrlPicker()` | Node/URL picker overlays |
| `_showShortcutsPanel()` / `_closeShortcutsPanel()` | Shortcuts overlay |
| `_addFileNode()` / `_addEmbedNode()` / `_addGroupNode()` | Node creation |
| `_bindKeyboardShortcuts()` | Keyboard shortcuts |
| `_bindCanvasMouseEvents()` / `_bindGlobalMoveEvents()` / `_bindWheelZoom()` / `_bindCanvasContextMenu()` | Pan/lasso, global move/up, wheel zoom, empty-canvas context menu |
| `closeHandler()` / `bindEvents()` | Event wiring |
| `_saveViewport()` / `_zoomToSelection()` / `zoomToFit()` | Viewport persistence + zoom |
| `_initMinimap()` / `_updateMinimap()` / `_syncMinimapViewport()` / `_minimapClick()` | Minimap (click-to-jump) |
| `updateTransform()` / `addCard()` | Transform + card creation |
| `_blocksToHtml(blocks)` | BlockEditor blocks → rendered HTML for file-node cards |
| `_startEdgeDraw()` | Edge drawing |
| `_getPortToward()` / `_getAutoPorts()` | Port calculation |
| `_calcBezierControlPoints()` / `_buildEdgePathString()` | Bezier/edge path math |
| `_resolveEdgeStyles()` / `_renderWaypointHandles()` / `_renderEdgeHoverHint()` | Edge styles, waypoints, hover hint |
| `renderEdge(edge)` / `_renderEdgeLabel(edge)` | Edge render + label at bezier midpoint |
| `_showAlignMenu()` / `_alignNodes()` | Node alignment menu + apply |
| `_autoLayout()` | Auto layout |
| `_editEdgeLabel()` / `_deleteEdge()` | Edge label editing + delete |
| `_buildEdgeMenuHTML()` / `_handleEdgeMenuAction()` / `_setupCloseOnOutsideClick()` / `_showEdgeContextMenu()` | Edge context menu |
| `_convertMarkdownToHtml()` | Markdown → HTML for node cards |
| `_collectTags()` / `_renderTagFilter()` / `_applyTagFilter()` | Tag filter bar |
| `_routeWikiLinks()` / `_refreshEdges()` | Wiki-link auto-routing + edge refresh |
| `_showContextMenu()` | Canvas context menu (rebuilds arrowhead defs) |
| `_updateBacklinks()` / `_showBacklinks()` / `esc()` / `_closeBacklinks()` / `_updateBacklinksPosition()` / `_convertTextNodeToFile()` / `_updateBacklinksBadge()` | Backlinks panel (esc = Escape-close) + text-node→file conversion |
| `_showCanvasFormatBar()` / `_hideCanvasFormatBar()` | Rich-text format bar |
| `_showCommentThread()` / `_hideCommentThread()` | Comment threads |

- **GraphManager** — D3 force-directed knowledge graph derived from wiki
  links: pin/unpin/reset layout, zoom-to-fit, single-click zooms to the
  clicked node's connected subgraph (BFS full chain), folder filter dropdown,
  hover previews.

#### GraphManager — function inventory (≈1k lines)

| Function | What it does |
|---|---|
| `saveLayout()` | Persist graph node positions to localStorage |
| `pinAllNodes()` | Freeze the layout (set `fx/fy`) so it stays exactly as arranged |
| `resetLayout()` | Clear saved positions + unpin — force simulation re-layouts from scratch |
| `unpinAllNodes()` | Unpin AND clear saved positions so nodes stay free across renders (mode toggles, reopen) |
| `init()` | Lifecycle |
| `_onSearchChange()` / `_clearSearchTimer()` / `_updateMatchCount()` | Node search (debounced re-render) + match count |
| `open()` / `close()` | Modal open/close (re-render after animation) |
| `_escapeHtml()` | Escape helper |
| `_zoomToFit(nodes)` | Smoothly animate the camera to fit nodes (D3 zoom transition, lerp) |
| `fitView()` | Public fit-all handler (from the 'fit view' button) |
| `_scheduleZoomFit()` | Zoom-to-fit after the simulation settles |
| `_getConnectedNodeIds(node)` | BFS to find all nodes connected to a node (full chain) |
| `_zoomToFitConnected()` | Single-click: zoom to the clicked node's connected subgraph |
| `_buildFolderOptions()` | Build the folder-filter dropdown from active notes |
| `_getNotePreview()` / `_showTooltip()` / `_positionTooltip()` / `_hideTooltip()` | Node tooltips (preview text, strip HTML, truncate) |
| `toggleLocalMode()` | Global ↔ local (1-degree neighbor) view |
| `getNodeRadius(node)` | Node radius from degree |
| `render()` | D3 force simulation render — applies saved layout + pins |
| `dragstarted()` / `dragged()` / `dragended()` | D3 drag handlers |

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

#### SettingsUI — function inventory (≈2.2k lines)

This file has a legacy pattern of **redefining functions later in the file**
(e.g. `openThemeModal`, `initBackground`) — the last definition wins. The
inventory below describes the effective (final) behavior.

| Function | What it does |
|---|---|
| `showNotification(msg, type)` | Global notification with type-based styling |
| `setUnsavedDots()` / `resetSaveButtonState()` / `markDirty()` | Save-button dirty-state UI (unsaved indicator, SAVED ✓ reset) |
| `applyTheme(theme)` | Apply a theme object as CSS variables |
| `updateDynamicIcon()` | Theme-aware dynamic browser icon |
| `init()` | Lifecycle: bind inputs, shortcuts (Cmd+S save, Cmd+1-6 tab switch, Cmd+F search) |
| `toggleConfig()` / `toggleHelp()` / `open(tab)` / `close()` | Modal open/close (defaults to Interface tab) |
| `openThemeModal()` / `closeThemeModal()` | Theme modal (via ModalManager) |
| `loadConfigToUI()` | Populate the UI from Config (incl. background + persisted search) |
| `getConfigFromUI()` | Gather UI values → config object |
| `checkDirty()` | Compare UI vs baseline for dirty tracking |
| `saveConfigFromUI()` | Persist UI → Config + `saveData`, SAVED ✓ flash, close |
| `initBackground()` | Background (image/video/color) setup + overlay/filter wiring |
| `handleBackgroundUpload()` | Background file upload → data URL |
| `renderBgThumbnails()` | Background picker grid (image/video preview) |
| `updateBackgroundPreview()` / `loadBackgroundImage()` / `tryLoadVideo()` | Background preview helpers |
| `renderDockLinksConfig()` / `updateDockLink()` / `removeDockLink()` | Dock quick-launch config list (add/edit/delete) |
| `renderCustomCommandsList()` / `updateCommand()` / `removeCommand()` | Custom CLI command config list |
| `renderThemePresets()` / `updateThemeButtons()` / `loadThemePreset(name)` | Theme preset gallery + current-selection state |
| `handleThemeModalConfirm()` / `getCurrentThemeAsObject()` / `saveCustomTheme()` / `importTheme()` / `deleteCustomTheme()` | Custom theme CRUD (WYSIWYG save from UI values) |
| `exportAllData()` / `triggerImport()` / `importDataFile(file)` / `importFromSync(data)` | Backup & restore (V101) — export JSON, validate structure, import, Drive-import flow |
| `bindSearchFilter()` / `updateClearButton()` / `_applySearchFilter()` / `_removeHighlights()` / `_highlightText()` / `acceptNode()` | Settings search filter: per-tab highlight, nav dimming, match badges, no-results state |
| `updateNavBadges()` | Module/sync badge counts in nav |
| `bindSyncButtons()` / `loadSyncTab()` / `bindBackupButtons()` | Backup-now + Drive connect/disconnect/push/pull wiring, last-backup + drive info, connection status |

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
  A one-shot harvest tool did the stripping; the tool was deleted after use —
  `git show` the `chore(oss)` commit if you ever need the original text. The
  knowledge lives in this document. If you re-add a block comment, consider
  whether it belongs here instead — but there is no automated gate; be
  sensible.
- **`/* */` inside template-literal CSS is not a JS comment.** (see §7).
- **`/* */` inside a template `${...}` expression** is preserved, not stripped
  (the harvest tool treated templates as opaque). If you see one, it's
  intentional — it's a real JS comment inside a template expression.
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
