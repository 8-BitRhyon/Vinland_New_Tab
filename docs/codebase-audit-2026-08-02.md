# Vinland — Codebase Audit (2026-08-02)

> Component-by-component assessment: scalability, runtime, edge cases, correctness.
> Scope: all 54 JS files (35,325 lines). Verified against source. Not yet actioned — see
> "Recommended sprint plan" at the bottom for the implementation order.

---

## Executive summary

Vinland is in good shape for its size and constraints (no bundler, `window.*`
service-locator, strict CSP). The build is green, the test surface is strong
(16 unit suites + 34 E2E specs), and the release pipeline is hardened. The
findings below are about **the next order of magnitude**: vaults with thousands
of notes, long documents, and heavy canvas usage.

**The four highest-impact themes:**

1. **Per-save tax chain** — a single keystroke (debounced 500ms) triggers
   `saveData()` + `MetadataCache.updateNote()` (full index re-serialize) +
   `FlashcardManager.syncFromNotes()` (full vault rescan) + version snapshot.
   This chain is O(vault) on every save.
2. **MetadataCache rebuilds instead of loads** — `saveCache()` persists the
   full tag/link/backlink index on every note update, but `loadCache()` is
   **never called** (dead code). Every boot rebuilds the index from scratch.
3. **O(n) `State.NOTES.find()` everywhere** — the id→note lookup is a linear
   scan in ~10 modules (Notes, BlockEditor, HistoryManager, GraphManager,
   QueryEngine, MetadataCache). An id→index Map turns all of these O(1).
4. **Two attribute-injection XSS vectors** in `BlockEditor` rendering
   (`markdownToHtml` link href, `highlightSyntax` wiki-link `data-note-title`)
   — `&<>` are escaped but **`"` is not**, and URL schemes are not validated.

---

## Findings by severity

### 🔴 High

| # | Finding | Where | Why it matters |
|---|---|---|---|
| H1 | **XSS: `markdownToHtml` link injection** | `BlockEditor.js:332` | Escapes `&<>` then builds `<a href="$2">` from an **unescaped, unvalidated** capture. `[x](javascript:alert(1))` and `[x](" onmouseover="alert(1))` inject attributes/JS. Vector: pasted content, Obsidian import, shared notes. In an extension context (bookmarks + identity perms) this is high-impact. **Fix:** escape `"`/`'`, whitelist `http/https/mailto`, or drop `javascript:` schemes. |
| H2 | **XSS: `highlightSyntax` wiki-link attribute injection** | `BlockEditor.js` (wiki-link regex in highlight) | `data-note-title="' + noteTitle.trim() + '"` — `"` unescaped, so `[[x" onmouseover="alert(1)]]` breaks out of the attribute. **Fix:** escape `"` or use a dataset assignment. |
| H3 | **Per-save tax chain** | `NotesController.save()` + `MetadataCache.updateNote()` + `FlashcardManager.syncFromNotes()` | Every save (each debounced keystroke, toggle, checkbox) does: full `saveCache()` JSON.stringify of the whole index (H4), a full `syncFromNotes()` vault rescan, a version-history snapshot, and a backlink re-render. At 1k–10k notes this makes typing progressively laggy. |
| H4 | **MetadataCache serializes the full index on every update** | `MetadataCache.js:updateNote → saveCache` | `saveCache()` stringifies tagIndex + linkIndex + backlinks (every note's tags/links) and writes `VINLAND_METADATA_CACHE` — which **nothing ever reads**. Doubly wasteful: write cost per save + the cache is ignored on boot. |
| H5 | **Version history grows unbounded** | `VersionHistoryManager.captureSnapshot()` (called on every save) | Every save pushes a full snapshot to IndexedDB with no cap, no pruning, no compaction. A long-lived vault with active notes accrues storage indefinitely. Design doc already flags "may need a compaction strategy" — it's past due. |

### 🟡 Medium

| # | Finding | Where | Why it matters |
|---|---|---|---|
| M1 | **`State.NOTES.find()` linear scans everywhere** | Notes, BlockEditor (`_getActivePage`), HistoryManager, GraphManager, QueryEngine (TASK formatting), MetadataCache (`updateLinkIndex` per-link find), local graph | O(n) per lookup, and some are inside loops → O(n²) (e.g. MetadataCache indexing N notes with L links each = N×L finds). A `Map<id, note>` maintained at load/save makes lookups O(1). |
| M2 | **`loadCache()` dead code** | `MetadataCache.js:461` | Defined, never invoked. Boot rebuilds the whole index (H3's cousin) — with 10k notes that's a visible startup cost on every new tab (and this is a **new-tab override**, so boot runs constantly). |
| M3 | **`saveData()` is O(vault) per call** | `Storage.js` | Maps + iterates **all** notes every save to diff shards, plus orphan cleanup via `currentIds.indexOf(id)` (O(n·m)). With a dirty-set (only touched notes) + `Set` for orphan lookup it becomes O(changed). |
| M4 | **IndexedDB connection churn** | `Storage.js DB.save/get/delete` | Every IDB operation calls `DB.open()` — a fresh connection per op. Attachments + canvas offload + version history all pay this. Cache the open promise once. |
| M5 | **`renderNotes()` full sort + `updateAllTags()` per save** | `NotesController` | `renderNotes` sorts the entire vault (then slices 10); `updateAllTags` re-derives tags across all notes; both run on saves. Partial/insertion logic or a tag count maintained by MetadataCache would avoid it. |
| M6 | **BlockEditor full re-render + per-block listeners** | `BlockEditor.render()` / `renderBlock()` | `render()` wipes `container.innerHTML` and re-creates every block; each block wires ~6–10 listeners (drag×5, dup, handle, checkbox, code focus/blur). Long docs (1k+ blocks) = 10k+ listeners and O(n) DOM rebuilds. Event delegation on the container would scale. |
| M7 | **GraphManager full rebuild per open** | `GraphManager.render()` | Clears the container, rescans every note's blocks for wiki links, re-runs the force simulation on every open. Acceptable for an on-demand modal, but with `saveLayout()` on every render + big vaults it's the slowest single view. |
| M8 | **Attachments thumbnail URL leak** | `AttachmentsManager.getThumbnailURL()` | Thumbnails create object URLs that are **not tracked** in `objectUrls` and never revoked; re-opening the browser leaks URLs per image. `img.src` temp URLs are revoked, but thumb URLs aren't. |
| M9 | **Duplicate DEFAULT_CONFIG sources** | `Store.js` vs `Config.js` | Two separate `DEFAULT_CONFIG` objects with **different** fields (`Store` has `indexing`/GEMINI dock links; `Config` has surface tokens, backup config). `State.DEFAULT_CONFIG` is never referenced (dead export). Drift between them is already visible and will cause subtle config bugs. |
| M10 | **`'note_' + Date.now()` ID collision** | `NotesController.create()` | Two creates in the same millisecond (double-click, scripted import) collide. Everywhere else (blocks, attachments, canvas) already appends a random suffix. |
| M11 | **`renderSidebar()` rebuilds the whole tree** | `Sidebar.js` | Full directory tree rebuild + full DOM re-render on every call; called on opens, moves, title changes, folder ops. Fine for small vaults; O(n) DOM churn at scale. |

### 🟢 Low / hygiene

| # | Finding | Where | Notes |
|---|---|---|---|
| L1 | `CONFIG_VERSION = 4` but key `OPERATOR_CONFIG_V3` | `Config.js` / `Store.js` | Cosmetic — the version field is checked by consumers, key name is legacy. |
| L2 | Loose equality `==`/`!=` in QueryEngine | `QueryEngine.js:evaluateCondition` | Prefer strict; `value == clause.value` coerces types silently. |
| L3 | Duplicate comment `// 2.5 Register Commands` | `boot.js` | Trivial. |
| L4 | `Pomodoro` ticks at 100ms | `Pomodoro.js` | Fine while active (10Hz text update is cheap), but 250–500ms + end-time math would suffice; interval is properly cleared on stop/complete. |
| L5 | `Clock` ticks every 1s forever | `Clock.js` | Correct behavior for a clock; could align to second boundary to avoid drift. |
| L6 | `getCalcPreviewHtml` interpolates `expr`/`result` unescaped | `BlockEditor.js` | Values flow from user math text into innerHTML — `safeMathEval` output is numeric, but the raw `expr` echo is unescaped. Low (calc blocks only) but same class as H1/H2. |
| L7 | `window.BOARDS` referenced in GraphManager | `GraphManager.render()` | Reads `window.BOARDS` — likely stale; `State.BOARDS` is the real source. Verify. |
| L8 | `SettingsUI` (2,186 lines) + `CanvasManager` (5,004) + `BlockEditor` (3,821) monoliths | — | Maintainability. The pure-extraction refactor pattern from V19.52/53 works; continue it for the remaining hot functions rather than file-splitting (per design doc convention). |

---

## Component-by-component detail

### `js/core/` — Foundation

- **Store.js** (112) — Clean singleton. `DEFAULT_CONFIG` duplicated with Config.js (M9); `State.DEFAULT_CONFIG`/`getDefaultConfig` effectively dead after `Config.load()` replaces `State.CONFIG`. `indexing` (AI/vector) config is vestigial — decide to implement or delete.
- **Storage.js** (288) — Best-in-repo engineering: sharded notes, diff-cache, canvas offload, orphan recovery, integrity guards. Remaining gaps: O(n) full-scan per save (M3), IDB connection churn (M4), `beforeunload` fire-and-forget IDB writes that may not flush (documented tradeoff, acceptable).
- **Config.js** (413) — Solid. `loadFromSync` merge is fine. Watch: sync-merge races with a local edit in the same boot; `applyTheme` writes a handful of CSS vars (cheap).
- **MetadataCache.js** (505) — The biggest scalability lever in the codebase (H3/H4/M2): dead `loadCache`, full re-serialize per update, per-link `State.NOTES.find` during indexing (O(n·L)), and `updateTagIndex`/`updateLinkIndex` full-map scans to clear a note's old entries (O(total tags/links) per note → O(n²) on init). Keep a per-note record of previous tags/links to diff instead of scanning maps.
- **CommandRegistry.js** (130) — Tight and correct; `_fuzzyMatch` is O(target) per command, 34 commands → trivial. No change needed.
- **QueryEngine.js** (490) — Dataview-lite is reasonable. `formatResults` TASK branch + `getTasksFromNote` do `State.NOTES.find` per candidate (M1). Loose equality (L2). Regex parser is fine for the documented scope.
- **AttachmentsManager.js** (587) — Solid API; thumbnail URL lifecycle leak (M8); `DB.open()` churn (M4); `_getIndex` re-reads localStorage on every call — fine at attachment scale.
- **SafeCalc.js** (63) — Shunting-yard evaluator, no eval (CSP-safe). No issue found.
- **Input.js** (314) — Global keybinds bound once. Fine.
- **Utils.js** (27) — `safeText` is the escaping bedrock and is used correctly in Notes/Sidebar/QuickOpen. Good.

### `js/modules/` — PKM logic

- **NotesController.js** (2,446) — Well-decomposed after V19.52. Hot path issues: per-save chain (H3), `renderNotes` full sort (M5), `updateAllTags` per save (M5), ID collision (M10). The `_cleanupAutoNote`/`_savePreviousNote` garbage collection is thoughtful. XSS hygiene is good (`safeText` everywhere in rendered lists).
- **CanvasManager.js** (5,004) — Monolith, but the render strategy is actually good: `updateUI()` is targeted (counts/zoom/minimap), edges render individually, auto-save is dirty-flagged at 30s. Remaining: per-node/per-edge listener proliferation and the sheer size (L8). Keep decomposing via pure extraction.
- **GraphManager.js** (971) — Full rebuild per open (M7); `saveLayout()` persists `VINLAND_GRAPH_LAYOUT` on every render; reads `window.BOARDS` (L7). D3 usage (pinning, zoom-to-fit) is sound.

### `js/editor/` — The editor engine

- **BlockEditor.js** (3,821) — The XSS hotspot (H1/H2/L6), the listener-per-block pattern (M6), full re-render per `render()` (M6). `HistoryManager` snapshots blocks via `JSON.parse(JSON.stringify())` (deep clone of a whole note's blocks on every undo/redo push — fine at 50-state cap). Global keydown listeners are guarded by modal-stack checks (no leak).
- **PageManager.js** (410) — Data-model layer; `syncContent`/`parseContentToBlocks` run per save. No findings beyond M1's `find()` pattern.

### `js/features/` — Widgets & tools

- **QuickOpen.js** (1,792) — Good: 150ms debounce, sections, recent searches. Search lowercases full content per note per keystroke (O(total content)); acceptable today, an inverted index would be the 10k-note fix.
- **FlashcardManager.js** (601) — `syncFromNotes()` full-rescan hooked into every save (H3). Should be event-driven (re-scan only the saved note) or throttled.
- **VersionHistoryManager.js** (694) — Unbounded IDB growth (H5). Needs a per-note cap + pruning (keep last N snapshots), and/or diff-based snapshots.
- **KanbanManager.js** (796) — `State.BOARDS` full-writes on every change; fine at board scale.
- **Missions.js** (571) — Solid; drag-reorder, recurrence. No findings.
- **Pomodoro.js** (280) — 100ms interval (L4); cross-tab sync via chrome.storage.local; interval cleared properly.
- **Weather.js** (189) — 30-min cache, C/F toggle. Fine.
- **BackupManager.js** (625) — Canonical `buildBackupData` + Drive-first flow is well-tested. `DB.open()` churn (M4). Serializing the full vault is fine on the interval.
- **DataviewQuery.js** (1,036) — Live query panel; re-executes on input with QueryEngine. Debounce would help on long queries. Medium-low.
- **WorkspaceManager.js** (715) — Snapshots (canvas layout + open notes) to localStorage — fine.
- **DailyAgenda/TagBrowser/TemplateBrowser/QuickCapture/Calendar/CanvasSearch/CodeBlockTools/taskaggregator/Dock/Clock.js** — On-demand or small-scope; no blocking findings. TagBrowser re-derives tag counts via `MetadataCache.getAllTags()` — cheap.

### `js/ui/` — Views & overlays

- **SettingsUI.js** (2,186) — Monolith (L8); the tabbed dashboard works. Duplicate-declaration history is resolved (V19.39).
- **Sidebar.js** (503) — Escapes correctly (`safeText`). Full tree rebuild per call (M11).
- **BlockEditor's sibling overlays** (SlashMenu, hoverpreview, PageActions, calloutmodal, TabManager, PropertiesPanel, WikiLinkAutocomplete, FormatToolbar, ModalManager, background) — No blocking findings. `PropertiesPanel.syncToNote` save-ordering invariant is documented and respected.
- **ModalManager.js** (429) — Stack-based z-indexing, `closeTop`, Esc handling. Fine.

### `js/background/` + boot

- **service-worker.js** (248) — Notifications + context menu; no state persistence (correct MV3 pattern).
- **boot.js** (599) — 30+ sequential inits per new tab. The only await is `loadData()`. Biggest boot cost is the MetadataCache full rebuild (M2). Consider `requestIdleCallback` for non-critical inits (weather, background, settings) so first paint is instant.

---

## Edge cases worth hardening

1. **Corrupt note shard with duplicate IDs** — `loadData()` pushes both; downstream `find()` returns the first silently. Dedupe on load (keep newest `modified`).
2. **`saveData()` during `beforeunload`** — IDB writes are fire-and-forget; a canvas edit in the final second before close can be lost. Consider a synchronous last-chance flush or accept (documented).
3. **localStorage quota overflow** — `VinlandDB.save` swallows the exception (good) but the UI never surfaces "storage full" — notes silently stop persisting. Surface a one-time warning.
4. **`history.pushState` per note open** — the URL `?note=` grows the history; fine, but `_handlePopState` + `_checkUrlForNote` interplay on cold load should be E2E-tested.
5. **Attachments stored by `att_` key in the shared `media_assets` store** — canvas offload and version history share the same DB; a future store schema bump must not assume store shape (guarded by `objectStoreNames.contains` already).

---

## Sprint status

- **Sprint A (security) — RESOLVED 2026-08-02.** H1/H2/L6 fixed in
  `js/core/Utils.js` + `js/editor/BlockEditor.js` (see below). Guarded by
  `tests/security-unit-tests.mjs` (19 tests) + `tests/blockeditor-xss-guard.test.mjs`
  (static-analysis guard). All 18 unit suites + notes/paste-smoke E2E green.

  **The fix:** three pure helpers added to `Utils.js` — `escapeHtml` (full
  entity escape incl. quotes), `escapeAttr` (quote-only, for text already
  `&<>`-escaped), `sanitizeLinkUrl` (http/https/mailto + scheme-less
  `/`, `#`, `./`, `../` targets — keeps PKM internal links working while
  rejecting `javascript:`/`data:`/`vbscript:`/`file:`/`blob:`).
  Wired into the three BlockEditor sinks: `markdownToHtml` link hrefs
  (scheme-validate → reject → plain text), `highlightSyntax` wiki-link
  `data-note-title` (`escapeAttr`), `getCalcPreviewHtml` expr/result
  (`escapeHtml`).

## Sprint status

- **Sprint B (save-path lever) — RESOLVED 2026-08-02.** Four changes, all
  validated (18 unit suites + 24 E2E specs green):

  1. **`saveData()` is now dirty-set based** (`Storage.js`). `markNoteDirty()`/
     `markAllNotesDirty()` are called at the mutation chokepoints (Notes save/
     create/move/togglePin/restore, PageManager block ops, BlockEditor
     reorder/duplicate/undo-redo, CanvasManager._saveData). `saveData()`
     re-serializes only dirty notes (O(changed)) instead of stringifying the
     whole vault (O(vault)) per save. **Safety contract:** an empty dirty-set
     falls back to a full scan — unmarked callers (kanban, callouts, page
     actions) degrade to the previous correct behavior, never lossy. Orphan
     cleanup is now Set-based (O(n) instead of O(n·m)). `beforeunload` and
     `visibilitychange→hidden` force a full scan.
  2. **`MetadataCache` boots from cache.** `loadCache()` is now wired into
     `init()` (it was dead code). `saveCache()` v2 persists the main metadata
     index + a vault **fingerprint** (count + max modified + id hash);
     `loadCache()` accepts it only when schema-valid AND fingerprint matches,
     otherwise rebuilds — so stale caches (imports, restores, missed
     updateNote) never serve wrong tags/links/backlinks.
  3. **`saveCache()` is debounced** (15s coalescing + beforeunload flush)
     instead of re-serializing the full index on every note update.
  4. **`FlashcardManager.syncFromNotes(noteId)` is incremental** — the
     per-save hook now re-scans only the saved note (and only deletes that
     note's orphaned cards); full-vault syncs remain for boot/review/stats.

  **Review hardening (post-review, same date):** the code reviewer surfaced one
  genuine data-loss path and one cache-staleness blind spot, both fixed:

  5. **Dirty-set coverage audit** — traced every direct `saveData()` caller.
     New-note creators (SlashMenu canvas, WikiLinkAutocomplete, SystemCommands,
     PageActions duplicate/import, ObsidianImporter) and mutators (PageActions
     trash/pin, VersionHistoryManager restore, PropertiesPanel frontmatter,
     SlashMenu board-link) that previously called `saveData()` without
     `markNoteDirty()` now mark their affected note(s), so a non-empty dirty-
     set can never silently skip their changes. (calloutmodal + SlashMenu
     color-swatch are already covered via `PageManager.updateBlock`, which
     marks dirty itself.)
  6. **Unpersisted-note safety net** (`Storage.saveData`) — if any note in
     `State.NOTES` has no `noteCache` entry (never written to disk), a dirty-
     only save promotes to a full scan. Belts-and-suspenders: even a future
     unmarked caller cannot lose a brand-new note. Test (o) added.
  7. **Canvas cache blind spot fixed** — `CanvasManager._saveData` now calls
     `MetadataCache.updateNote()` on the active canvas note. Canvas edits
     never bumped `modified`, so without this the persisted cache went stale
     AND the fingerprint stayed fresh (false-fresh) — stale tags/links across
     boots. Now the index is kept warm on every canvas save.

- **Sprint D item (H5) — RESOLVED 2026-08-02.** Version history no longer
  grows unbounded. Note: a per-note cap (MAX_VERSIONS_PER_NOTE = 50) already
  existed in `captureSnapshot()` since V19.47 — the audit's 'no cap' claim was
  partially wrong. The real gaps fixed:

  1. **Global compaction `prune()`** (`VersionHistoryManager`) — scans the whole
     versions store at boot, deletes stores for notes absent from `State.NOTES`
     (orphans), and trims any store over the cap. Resolves `{scanned, removed,
     trimmed}`. This is the 'compaction strategy' design.md flagged.
  2. **`removeNote()` was dead code** — never called by any deletion path, so
     deleted notes left version keys in IndexedDB forever (the actual unbounded
     growth). Now wired into all three deletion paths: PageActions permanent-
     delete, Sidebar trash-empty, TabManager empty-note cleanup.
  3. **`trimToMax()` extracted as a pure helper** (unit-testable, no IDB), used
     by both `captureSnapshot` and `prune`.

  **Review hardening:** `prune()` resolves its stats in `tx.oncomplete` (not at
  cursor exhaustion) and rejects on `tx.onerror`/`tx.onabort` — so a commit
  failure surfaces instead of hanging the promise invisibly (init fire-and-
  forgets it). The async unit test was made synchronous (the runner doesn't
  await); the IndexedDB sweep itself is covered end-to-end by the Playwright
  test, which seeds 60 versions + an orphan key and asserts prune removes the
  orphan and trims to exactly 50.

  Guarded by `tests/version-history-unit-tests.mjs` (5 tests) + a new
  Playwright spec test (seeds 60 versions + an orphan key, asserts prune
  removes/trims). All 19 unit suites + version-history E2E (7/7) + notes E2E
  green.

## Recommended sprint plan

**Sprint A — Security (do first, small):** ✅ **DONE 2026-08-02** — H1/H2/L6 fixed + 23 new tests.

**Sprint B — The save-path lever (biggest runtime win):** ✅ **DONE 2026-08-02** — dirty-set `saveData()` (M3), `loadCache()` wired + fingerprint guard (M2/H4), debounced `saveCache()` v2 (H4), incremental `syncFromNotes(noteId)` (H3). See RESOLVED entry above. Next: **Sprint C** (lookups & rendering).

*(The 4 plan items above were executed 2026-08-02 — details in the RESOLVED entry.)*

**Sprint C — Lookups & rendering:**
6. M1: id/title note Maps — ✅ **DONE 2026-08-02**. `State.NOTE_MAP` (id→ref)
   + `State.NOTE_TITLE_MAP` (lowercased title→ref, first-wins) with lazy
   rebuild (ref+length change) and split invalidation — the id map stays warm
   across saves (ids never mutate in place), the title map rebuilds on the
   `_notesDirty` flag set by `saveData()` (catches in-place renames). ~46 hot
   `State.NOTES.find()` sites swapped to `State.getNote()`/`getNoteByTitle()`
   in NotesController, BlockEditor (incl. HistoryManager + `_getActivePage`),
   PageManager (addBlock/updateBlock/deleteBlock/syncContent), QueryEngine
   (TASK filter + getTasksFromNote), MetadataCache (updateNote + updateLinkIndex),
   GraphManager. Left as scans only where the predicate is genuinely complex:
   BlockEditor wiki-link id-exclusion, NotesController `_findTemplate`
   (path/flag/substring), NotesController `NOTES` local-var site. Behavior note:
   `openByTitle('untitled')` no longer matches title-less notes (the old
   `|| 'Untitled'` fallback) — rare and acceptable. Guarded by
   `tests/note-maps-unit-tests.mjs` (9 tests). All 20 unit suites + notes/
   dataview/local-graph/backlinks E2E green.
7. M6: convert BlockEditor per-block listeners to container-level delegation.
8. M5/M11: make `renderNotes`/`renderSidebar`/`updateAllTags` incremental or debounced.

**Sprint D — Storage lifecycle:**
9. H5: version-history cap + pruning — ✅ **DONE 2026-08-02** (see RESOLVED above).
10. M4: cache the IDB connection promise.
11. M8: track + revoke thumbnail object URLs.
12. M9: single source of truth for DEFAULT_CONFIG (delete Store's copy, re-export from Config).
13. M10: random-suffix note IDs.

**Sprint E — Hygiene:** L1–L8 (config key note, strict equality, comment dedupe, `window.BOARDS` → `State.BOARDS`, continue monolith decomposition).
