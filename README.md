# Vinland

[![CI](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml/badge.svg)](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> A Manifest V3 new-tab command center. Keyboard-first, local-first, no framework, no bundler.

The name is from *Vinland Saga* — the idea of a place beyond all the fighting,
peace on the other side of pain. That stuck with me. Vinland is that place for
your browser: a command line, a HUD, and a personal knowledge workspace, all in
one new-tab page.

## Highlights

- **It's a terminal for your browser.** `note Buy groceries`, `pomo 25`,
  `daily`, `canvas`, `b github`, `task finish report @work !!` — type and go.
  No mouse needed. 34 built-in commands, fuzzy search, and custom commands.
- **A HUD you see on every new tab.** Clock, pomodoro, weather, missions,
  bookmarks, a dock — all visible at once, no clicking through tabs.
- **A local-first PKM workspace.** Block editor, infinite spatial canvas,
  D3 knowledge graph, kanban boards, and a dataview-style query engine.
- **Your data stays yours.** Everything lives in your browser
  (localStorage + IndexedDB). No account, no server, works offline.
- **Vanilla JS, zero build step.** One vendored dependency (D3 v7). Load the
  folder into Chrome, Edge, Firefox, Zen, or any Chromium/WebExtensions
  browser and it runs.

## What it is

Your new-tab becomes a HUD: clock, pomodoro, missions, weather, bookmarks,
command palette — all visible at once, no clicking through tabs. Below that is
the PKM workspace: a block editor, an infinite spatial canvas, a D3 knowledge
graph, kanban boards, and a dataview-lite query engine. All in the browser,
all local.

## What it isn't

- **Not a SaaS, not a platform** — it's a single-page browser extension
  (Chromium and Firefox families) with no server component. There's no
  account to create and nothing to configure before it works.
- **Not framework-dependent** — a single HTML file, vanilla ES modules, and D3
  v7. No npm, no bundler, no webpack config in your way.
- **Not cloud-first** — your notes, tasks, and boards live on *your* machine.
  Google Drive sync is optional and opt-in.

## Stack

| Layer | Choice |
|---|---|
| Manifest | V3 |
| JS | Vanilla ES modules |
| Graph | D3 v7 (vendored, 273KB, BSD-3-Clause) |
| Storage | localStorage (sharded) + IndexedDB (media) |
| State | One global `State` object on `window` |
| CSS | Design tokens as CSS vars |

## What's in it

**HUD — always visible on every new tab:**
- Clock (12/24h)
- Pomodoro timer with cross-tab sync
- Weather (Open-Meteo, 30-min cache)
- Mission log with priority flags and streak tracking
- Bookmark browser (Chrome bookmarks indexed into a bottom bar)
- Dock (quick-launch links)
- Command palette (fuzzy search, 34 built-in commands, custom ones too)
- Zen mode
- Editable themes (11 presets)

**PKM workspace — opens when you need it:**
- Block editor (Notion-style — text, headings, tasks, kanban, queries,
  callouts, images, tables, dividers, code blocks)
- Infinite canvas (spatial nodes, edges, lasso select, undo/redo, minimap)
- Knowledge graph (D3 force-directed, wiki-link derived)
- Kanban boards (multi-column, vim nav, drag and drop)
- Dataview-lite query engine (`LIST FROM #tag WHERE due`)
- Slash menu (20+ commands inline)
- Multi-tab editing
- Wiki-link hover previews
- Metadata index (tags, backlinks, YAML frontmatter)
- Quick Notes sidebar with folder tree and trash
- Daily notes under `/Journal`

**34 CLI commands:**

| Command | What it does |
|---|---|
| `note <title>` | Quick-create and open a note |
| `notes` | Toggle the notes sidebar |
| `canvas` | New spatial canvas |
| `daily` | Open/create today's journal |
| `random` | Open a random note |
| `task <text>` | Add a task |
| `clear done` | Clear completed tasks |
| `pomo <time>` | Start a pomodoro |
| `b <query>` | Search bookmarks |
| `theme <name>` | Switch theme |
| `weather <location>` | Set weather location |
| `zen` | Toggle distraction-free |
| `kill` | Close all modals |
| `board` | Open kanban |
| `kanban` | Open kanban (alias) |
| `reload` | Reload extension |
| `help` / `man` | Show command reference |
| `find <query>` | Search notes via QuickOpen |
| `search <query>` | Search notes (alias) |
| `calendar` | Open calendar view |
| `agenda` | Open daily agenda |
| `template <name>` | Browse/create from template |
| `tags <query>` | Browse/filter by tag |
| `dv <query>` | Open Dataview query panel |
| `dataview <query>` | Open Dataview query panel (alias) |
| `review` | Start flashcard review |
| `flashcards` | Show flashcard stats |
| `versions` | View note version history |
| `obsidian-import` | Import .md from Obsidian vault |
| `workspace <cmd>` | Save/load/delete workspace snapshots |
| `export` | Download all data as JSON |
| `import` | Import from JSON backup |
| `attachments` | Open attachment browser |

## Why it works

Vinland was built for daily use, not for a demo. Every tab lands here: the
pomodoro keeps you honest, missions track what needs doing, notes capture
everything, and the canvas lets you think spatially. It replaces a task
manager, a scratchpad, and half a bookmarks bar — and it works exactly how you
want it to, because you can change it. That's the point of open source.

## Install

### From a release zip (recommended)

Grab the latest `vinland-v<version>.zip` from the
[Releases page](https://github.com/8-BitRhyon/Vinland_New_Tab/releases):

1. Download `vinland-v<version>.zip`
2. Unzip it anywhere (e.g. `~/Downloads/vinland/`)
3. Open `chrome://extensions`
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the unzipped `vinland` folder
6. Open a new tab — Vinland replaces the new-tab page

The release zip is ~540KB and ships only what the store ships — dev/test
tooling is excluded. An 80MB size guard, a composition report (10 largest
paths), and a dedicated exclusion test suite run on every push, so bloat
can't silently ship.

### From source

```bash
git clone https://github.com/8-BitRhyon/Vinland_New_Tab
# no install step — it's vanilla
# chrome://extensions → Load unpacked → select the repo folder
```

### Build a store zip

```bash
bash scripts/package-release.sh
# → dist/vinland-v<version>.zip (~541KB)
```

The script prints the 10 largest included paths, enforces an 80MB size guard
(Chrome Web Store caps at 100MB), and excludes dev/tooling (tests, docs,
node_modules, .git, .venv, ...). Guarded by
`tests/package-exclusions-unit-tests.mjs` and the `package-check` CI job on
every push.

### Firefox / Zen and other browsers

Vinland is a cross-browser Manifest V3 extension:

- **Chromium family** (Chrome, Edge, Brave, Opera, Arc, **Dia**): the same
  `vinland-v<version>.zip` loads unpacked — or install from the Chrome Web
  Store.
- **Firefox family** (**Zen**, Firefox, Waterfox, LibreWolf): build the
  WebExtensions zip and load it as a temporary add-on:

  ```bash
  bash scripts/package-firefox.sh
  # → dist-firefox/vinland-firefox-v<version>.zip
  ```

  then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
  select the zip. `manifest.firefox.json` is the Firefox delta (stable gecko
  id `vinland@rhyon.dev`, event-page background, Drive OAuth via
  `launchWebAuthFlow`) merged over the Chrome manifest at package time.

See [`docs/browser-support.md`](docs/browser-support.md) for the full
compatibility matrix, per-browser install steps, and Drive OAuth setup.

## Tests / CI

- **Unit**: `npm test` — 723 tests across zero-dependency suites
- **E2E**: `npm run test:e2e` — 34 Playwright specs against a local static server
- **CI**: both run on every push via
  [GitHub Actions](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml) —
  unit-tests, 4 E2E shards, CLI command sweep, real-extension
  release-candidate smoke, and the store-zip `package-check` gate

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | **Start here for code** — architecture, module map, invariants, gotchas, testing, packaging |
| [`docs/design.md`](docs/design.md) | Canonical design document — state/storage model, theming, feature specs |
| [`docs/codebase-audit-2026-08-02.md`](docs/codebase-audit-2026-08-02.md) | Performance/robustness audit with resolved items |
| [`docs/browser-support.md`](docs/browser-support.md) | Browser matrix (Chrome, Dia, Zen, Firefox) — installs, packaging, Drive OAuth config |
| [`AGENTS.md`](AGENTS.md) | Agent-CLI instructions (Claude Code, Cursor, etc.) |

`docs/DEVELOPMENT.md` ships a **function inventory per module** (915 functions across 53 modules) — auto-generated by `npm run docs`, drift-gated in CI via `npm run docs:check`. Every row is hand-curated; a function added in source without regenerating fails the pipeline (renames are best-effort).

| Module | Path | Functions |
|---|---|---:|
| BlockEditor | `js/editor/BlockEditor.js` | 103 |
| CanvasManager | `js/modules/CanvasManager.js` | 93 |
| NotesController | `js/modules/NotesController.js` | 68 |
| SettingsUI | `js/ui/SettingsUI.js` | 54 |
| QuickOpen | `js/features/QuickOpen.js` | 31 |
| VersionHistoryManager | `js/features/VersionHistoryManager.js` | 28 |
| GraphManager | `js/modules/GraphManager.js` | 27 |
| BackupManager | `js/features/BackupManager.js` | 25 |
| DataviewQuery | `js/features/DataviewQuery.js` | 25 |
| FlashcardManager | `js/features/FlashcardManager.js` | 24 |
| PageActions | `js/ui/PageActions.js` | 24 |
| KanbanManager | `js/features/KanbanManager.js` | 23 |
| MetadataCache | `js/core/MetadataCache.js` | 21 |
| DailyAgenda | `js/features/DailyAgenda.js` | 19 |
| WorkspaceManager | `js/features/WorkspaceManager.js` | 18 |
| CodeBlockTools | `js/features/CodeBlockTools.js` | 18 |
| AttachmentsManager | `js/core/AttachmentsManager.js` | 18 |
| PropertiesPanel | `js/ui/PropertiesPanel.js` | 16 |
| Calendar | `js/features/Calendar.js` | 15 |
| TagBrowser | `js/features/TagBrowser.js` | 15 |
| ModalManager | `js/ui/ModalManager.js` | 14 |
| QueryEngine | `js/core/QueryEngine.js` | 13 |
| SlashMenu | `js/ui/SlashMenu.js` | 13 |
| WikiLinkAutocomplete | `js/ui/WikiLinkAutocomplete.js` | 13 |
| PageManager | `js/editor/PageManager.js` | 12 |
| CanvasSearch | `js/features/CanvasSearch.js` | 12 |
| Missions | `js/features/Missions.js` | 12 |
| TemplateBrowser | `js/features/TemplateBrowser.js` | 12 |
| TabManager | `js/ui/TabManager.js` | 12 |
| Storage | `js/core/Storage.js` | 11 |
| QuickCapture | `js/features/QuickCapture.js` | 11 |
| Pomodoro | `js/features/Pomodoro.js` | 11 |
| FormatToolbar | `js/ui/FormatToolbar.js` | 10 |
| CommandLine | `js/features/CommandLine.js` | 9 |
| Config | `js/core/Config.js` | 9 |
| ObsidianImporter | `js/features/ObsidianImporter.js` | 7 |
| Audio | `js/core/Audio.js` | 6 |
| Store | `js/core/Store.js` | 6 |
| Utils | `js/core/Utils.js` | 6 |
| HoverPreview | `js/ui/HoverPreview.js` | 6 |
| Sidebar | `js/ui/Sidebar.js` | 5 |
| Background | `js/ui/Background.js` | 5 |
| Bookmarks | `js/features/Bookmarks.js` | 4 |
| Clock | `js/features/Clock.js` | 4 |
| CommandRegistry | `js/core/CommandRegistry.js` | 4 |
| SafeCalc | `js/core/SafeCalc.js` | 4 |
| CalloutModal | `js/ui/CalloutModal.js` | 4 |
| boot.js | `js/boot.js` | 3 |
| Weather | `js/features/Weather.js` | 3 |
| TaskAggregator | `js/features/TaskAggregator.js` | 3 |
| Dock | `js/features/Dock.js` | 2 |
| SystemCommands | `js/config/SystemCommands.js` | 2 |
| Input | `js/core/Input.js` | 2 |
| **Total** | | **915** |
## Contributing

Vinland is open source under the Apache License 2.0. Bug reports, feature
ideas, and pull requests are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md)
for how to set up, test, and submit changes.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Rhyon. See [`LICENSE`](LICENSE)
for the full text.
