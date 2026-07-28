# Vinland UX Audit — 2026-07-28

> Comprehensive analysis of the user journey, friction points, and improvement opportunities.

---

## 1. Boot / First-Run Experience

### Current flow
1. User navigates to page → static HTML renders immediately (good)
2. `boot.js` loads → initializes all modules sequentially
3. CLI prompt (`#cmd-input`) appears → user can start typing
4. If `first_run` is true → welcome modal shows a brief intro

### Issues
- **No visual loading indicator**: Between HTML render and boot.js completion, the page shows an empty shell. If JS is slow (3G, cached SW), the user sees a blank page for 500ms-2s with no feedback.
- **Welcome modal skippability**: The welcome modal doesn't have a "Don't show again" button visible in the first viewport — the user has to figure out closing it.
- **No progressive enhancement**: If JS is disabled, the user gets a completely blank terminal with no fallback message.

### Fixes
1. Add an inline `<noscript>` message: _"Vinland requires JavaScript to function. Please enable JavaScript."_
2. Add a CSS loading spinner or skeleton in the initial HTML (before JS loads)
3. Welcome modal: add a "Don't show again" checkbox, and give the close button a more prominent style

---

## 2. CLI Command Interface

### Current flow
- `#cmd-input` is always visible at the bottom
- User types a command → Enter → `CommandRegistry` executes
- Tab autocompletion, ArrowUp for history
- Commands: `note`, `find`, `search`, `help`, `canvas`, `board`, `pomo`, etc.

### Issues
- **Command discoverability**: New users don't know what commands exist. Typing `?` or `help` opens the operator manual, but there's no inline suggestion/hint system.
- **No fuzzy command matching**: Typing `createnote` won't match `note` — it's exact trigger matching only.
- **Command history persistence**: ArrowUp history is in-memory only — refreshes on page reload.
- **No output feedback**: Many commands execute silently. `note AlphaNote` creates a note but doesn't show a confirmation. The user has to know to look for the editor modal.
- **Error handling**: If a command fails (e.g., `note` with no args), nothing happens — no error toast or feedback.

### Fixes
1. Show a suggestions popover as user types (like a simplified slash menu for the CLI)
2. Implement fuzzy matching: `find` should match `find`, `f`, `fi`, `fin`
3. Persist command history in localStorage
4. Show a small notification/toast for successful commands: _"Created note 'AlphaNote'"_
5. Add error toasts for failed commands: _"Command not found: createnote"_

---

## 3. Note Editor

### Current flow
- `note <title>` or sidebar click → `#note-editor-modal` opens
- WYSIWYG block editor with `/slash` commands
- Properties panel, tags bar, local graph, stats panel
- Save via auto-save (500ms debounce)

### Issues
- **Editor open feels heavy**: The modal slides in from the center but there's no smooth entrance animation — it just appears. Feels abrupt.
- **Block type switching is hidden**: Changing a block from `p` to `h1` requires the slash menu (`/`). There's no toolbar button for it. New users won't know `/`.
- **No auto-resize for short notes**: The editor always has a fixed initial height even for a 1-line note.
- **Close button placement**: `#note-editor-close` is in the top-right corner. On wide screens, this is a long mouse journey from the block content area.
- **No unsaved changes indicator**: Auto-save happens silently. The user doesn't know if their changes are saved or pending.
- **Block drag handle is small**: The grip dots are thin and hard to target, especially on touch devices.
- **Find/replace (Cmd+F)**: The find bar is at the bottom of the editor — feels unnatural. VS Code / Notion use the top.
- **No split pane**: Can't view two notes side by side.

### Fixes
1. Add a smooth slide-in animation for the editor modal
2. Add a floating block-type toolbar on text selection (B/I/U + H1/H2/H3/P)
3. Add a subtle "unsaved" dot indicator that disappears after auto-save completes
4. Make the close button reachable via Cmd+W / Ctrl+W
5. Widen the drag grip area (increase padding, add CSS `::before` overlay)
6. Move find bar to top of editor
7. Add keyboard shortcut `Cmd+Shift+E` to toggle a split-pane view

---

## 4. Canvas / Knowledge Graph

### Current flow
- `canvas <title>` command or button → canvas modal opens
- Double-click to add a node, Shift+drag to connect nodes
- Edges rendered as bezier curves with arrowheads (recent improvement)
- Minimap in corner, zoom/pan via scroll + space+drag
- Edge waypoints via double-click on edge path
- Node alignment tools, snap-to-grid

### Issues
- **Canvas feels empty on first open**: The empty-state hint overlay is informative but disappears instantly when the first node is added. Would be better as a persistent bottom bar or tooltip.
- **Node title editing UX**: Double-clicking a node title to edit is not obvious. There's no visual hint (cursor change, border highlight) showing the title is editable.
- **Edge drawing is invisible during drag**: When Shift+dragging from one node to another, there's no temporary line preview — the edge just appears on mouse release. This makes it hard to aim.
- **No canvas toolbar collapse**: The floating toolbar takes up horizontal space. On small screens or zoomed-in views, it overlaps with nodes.
- **Node selection visual feedback**: Selected nodes get a subtle border color change. On busy canvases with many nodes, it's hard to tell which is selected.
- **Undo/redo depth**: Currently 50 states. No visual feedback when undo stack is empty (button is still clickable).
- **No "auto-layout" button**: Users have to manually arrange nodes. A force-directed auto-layout button would save time.
- **Zoom to fit** (`Shift+1`) works but there's no zoom percentage slider — only the label showing 100%.

### Fixes
1. Add a temporary edge preview line during Shift+drag (SVG line from start node to cursor)
2. Make node titles show a subtle `[edit]` hint on hover
3. Add auto-layout toggle in the toolbar (force-directed or hierarchical)
4. Show a zoom slider in the toolbar for precise zoom control
5. Add a toolbar collapse/expand toggle to save space
6. Increase selected-node visual contrast (border color + subtle glow)
7. Show "Undo stack empty" / "Redo stack empty" feedback on toolbar buttons

---

## 5. Search

### Current flow
- `Cmd+P` → QuickOpen popup (notes + tags + commands)
- `Cmd+Shift+F` → Full-page search results page (new)
- `/` in editor → Slash menu for block commands
- Filter bar: All / Notes / Tags / Commands
- Results highlight query matches in excerpts

### Issues
- **Search results don't show note date**: The user can see the title and path but not the last-modified date, making it hard to find recently edited notes.
- **No content preview on hover**: Hovering a result doesn't show a tooltip with more context — the excerpt is limited to 80 chars inline.
- **Filter state resets on new search**: If the user filtered to "Commands", then types more characters, the filter resets to "All". This is disorienting.
- **No keyboard shortcut to focus search in editor**: `Cmd+F` in the editor opens the find bar, but `Cmd+Shift+F` always opens the new results page — even if the editor is already focused. This is inconsistent.
- **Recent searches show on empty input**: This is good. But clicking a recent search triggers `_executeSearch` + `_renderResultsPage` which briefly flashes before showing results.
- **Animations on every keystroke**: The stagger animation fires on every debounce render. Rapid typing causes visual flicker.

### Fixes
1. Show last-modified date in search result meta
2. Add a tooltip/rich preview on result hover (first 3 lines of content, not just excerpt)
3. Preserve filter state across searches within the same results page session
4. Make `Cmd+F` open the find bar in editor, `Cmd+Shift+F` the full-page search — keep them distinct
5. Debounce the recent search click to avoid double-trigger
6. Only animate on fresh results (not on filter change)

---

## 6. Settings

### Current flow
- `settings` CLI command → settings modal opens
- Tabbed interface: Interface, Sync, Themes, About
- Search/filter within settings
- Live theme preview

### Issues
- **Settings are overwhelming**: 4+ tabs with dense configuration options. No clear grouping hierarchy.
- **No search highlighting in settings**: The search input filters items but doesn't highlight matching text (except for count badges).
- **Theme preview is small**: The theme selector shows a tiny color swatch, not a full preview.
- **No export/import button in main UI**: Export is only available via the `export` CLI command — most users won't know this.
- **Settings changes don't show a "saved" confirmation**: Changes persist silently. User doesn't know if their setting applied.

### Fixes
1. Group settings into collapsible sections within each tab
2. Add match highlighting in settings search results
3. Show a persistent "Saved" indicator next to changed settings
4. Add export/import buttons to the main toolbar (not just CLI)
5. Add a "Reset to defaults" button per section

---

## 7. Navigation & Layout

### Current flow
- Bottom CLI bar is always present
- Sidebar (notes list) toggles via `Cmd+\` or button
- Editor opens as modal overlay
- Canvas opens as modal overlay
- No persistent top nav bar

### Issues
- **Modal stacking is confusing**: Opening a note then opening the canvas has two modal overlays. Closing one might close the wrong one. The user can't easily tell which modal is active.
- **No breadcrumb navigation**: The user has no sense of "where they are" in the app hierarchy. Just a title bar.
- **Sidebar closes on note open**: The sidebar auto-closes when the editor opens. If the user wants to see their note list while editing, they can't.
- **No "back" navigation**: There's no browser-history integration. The user can't use the browser back button to return to the previous note.
- **Mobile layout breaks**: The fixed widths and toolbar positions assume a desktop viewport. On mobile (<768px), elements overflow.

### Fixes
1. Add a persistent top bar with breadcrumb path (`Root → Notes → AlphaNote`)
2. Let the sidebar stay open alongside the editor (side-by-side on wide screens)
3. Integrate with `history.pushState` / `popstate` for browser back support
4. Add responsive media query overrides for mobile (stack modals, collapse toolbars)
5. Show a modal stack indicator (small tabs across the top showing which modals are open)

---

## 8. Error Handling

### Current flow
- `showNotification()` for some errors (toast at bottom)
- `console.error()` for others (invisible to user)
- Many operations silently fail

### Gaps
- **No global error boundary**: JS errors in modules can crash the entire app (e.g., `Cannot read property 'x' of undefined` in CanvasManager). There's no error recovery.
- **No "Something went wrong" UI**: When a crash happens, the page just stops working. No fallback UI, no reload button.
- **Data corruption recovery**: If localStorage data gets corrupted (e.g., bad JSON from a failed export/import), the app silently fails on boot with no feedback.
- **CLI errors are silent**: `note ''` (empty title) creates an "Untitled" note instead of showing an error that title is required.
- **No connection error handling**: Bookmark search does a `window.location.href = matches[0].url` but if the URL is invalid or offline, there's no feedback.

### Fixes
1. Add a `window.onerror` handler that shows a recovery UI ("Something went wrong — Reload | Restore from backup")
2. Add a data integrity check on boot: try/catch around localStorage reads, show a dialog if corrupted
3. Show CLI error toasts for invalid commands and missing arguments
4. Add try/catch around critical rendering paths (CanvasManager.load, BlockEditor.render)

---

## 9. Performance

### Observations
- **Canvas rendering with many nodes**: Creating 50+ connected nodes with bezier edges causes visible frame drops on pan/zoom. Each edge re-renders on every transform.
- **Auto-save on every keystroke**: 500ms debounce is reasonable, but for long typing sessions it fires frequently, potentially causing storage write contention.
- **D3 force simulation on local graph**: Re-runs on every note render (block add/delete). For notes with 100+ blocks, this is unnecessary work.
- **No lazy loading**: All notes are loaded into memory on boot. With 1000+ notes, `State.NOTES` is a huge array that's read on every filter/render.
- **CSS animation on every search render**: The stagger animation fires on every 150ms debounce. Typing fast causes many re-renders with animations.

### Fixes
1. Limit edge re-renders: cache SVG path data and only update on node position change
2. Increase auto-save debounce to 800ms, and batch writes
3. Only run local graph simulation when the connected notes actually change
4. Implement virtual scrolling / pagination for notes list when >500 notes
5. Skip animation on rapid successive renders (debounce animation initiation)

---

## 10. Accessibility

### Current state
- Keyboard navigation: Arrow keys work in QuickOpen, CanvasSearch, some modals
- Color contrast: Green-on-black (main-color on background) has poor WCAG contrast ratio (~3.5:1)
- Focus indicators: Many elements lack visible focus rings
- Screen reader: No ARIA labels on buttons, modals, or dynamic content
- Reduced motion: No `prefers-reduced-motion` media query support

### Fixes
1. Add `prefers-reduced-motion: reduce` to disable stagger animations, hover glows, and transition effects
2. Add `aria-label` to all icon-only buttons (close, search, filter)
3. Add `role="dialog"` and `aria-modal="true"` to modals
4. Improve focus visibility: add `outline: 1px solid` on `:focus-visible` for all interactive elements
5. Ensure color contrast meets WCAG AA (4.5:1 for text, 3:1 for UI) — the main green might need a lighter variant for text-on-dark

---

## 11. Data Persistence & Backup

### Current flow
- `saveData()` writes to `localStorage` (keys: `OPERATOR_NOTE_*`, `OPERATOR_NOTES_INDEX`)
- `export` command exports JSON
- `import` command imports JSON
- Auto-save on debounce

### Issues
- **No automatic backups**: If localStorage is cleared (browser cache clear), all data is lost. No warning, no recovery.
- **No version migration**: If the data schema changes in a future update, old data won't load properly.
- **Export is CLI-only**: Most users won't discover the `export` command. No button in the main UI.
- **No backup schedule**: No option for periodic auto-backup (e.g., download JSON every hour).

### Fixes
1. Add a "Download backup" button in the main toolbar
2. Implement data schema versioning with migration support
3. Show a warning before clearing data (detect first-run vs. data loss)
4. Add an optional periodic backup reminder (nag every N days)

---

## Priority Summary

| Priority | Area | Issue | Effort |
|----------|------|-------|--------|
| 🔴 High | Errors | Global error boundary + recovery UI | Medium |
| 🔴 High | Data | Backup download button in main UI | Small |
| 🔴 High | Nav | Modal stack confusion + breadcrumbs | Medium |
| 🟡 Medium | Editor | Missing formatting toolbar | Medium |
| 🟡 Medium | CLI | Command suggestions + fuzzy matching | Medium |
| 🟡 Medium | Canvas | Edge preview during drag | Small |
| 🟡 Medium | Performance | Animation on rapid successive renders | Small |
| 🟢 Low | Search | Date in results | Small |
| 🟢 Low | Settings | "Saved" confirmation | Small |
| 🟢 Low | A11y | prefers-reduced-motion | Small |
| 🟢 Low | A11y | ARIA labels on buttons | Small |
