# Vinland

[![CI](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml/badge.svg)](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml)

> A Manifest V3 new-tab command center. Keyboard-first, local-first, no framework, no bundler.

The name is from *Vinland Saga*. The idea of a place beyond all the fighting - peace on the other side of pain. That stuck with me. This is that place for my browser.

## What it is

Your new-tab becomes a HUD. Clock, pomodoro, missions, weather, bookmarks, command palette - all visible at once, no clicking through tabs. Below that is the PKM workspace: a block editor, an infinite spatial canvas, a D3 knowledge graph, kanban boards, a dataview-lite query engine. All in the browser, all local.

It's the command line I've always wanted in a browser. `note Buy groceries`, `pomo 25`, `daily`, `canvas`, `b github`, `task finish report @work !!` - type and go. No mouse needed.

## What it isn't

- Not a startup. Not a product. Not a business.
- Not for anybody else - I made it for how I work.
- It's a single HTML file, vanilla JS, and D3 v7. No npm, no bundler, no webpack config.
- Everything stays in localStorage. Your notes, tasks, boards - they live on your machine.

## Stack

| Layer | Choice |
|---|---|
| Manifest | V3 |
| JS | Vanilla ES modules |
| Graph | D3 v7 (vendored, 273KB) |
| Storage | localStorage (sharded) + IndexedDB (media) |
| State | One global `State` object on `window` |
| CSS | Design tokens as CSS vars |

## What's in it

**HUD - always visible on every new tab:**
- Clock (12/24h)
- Pomodoro timer with cross-tab sync
- Weather (Open-Meteo, 30-min cache)
- Mission log with priority flags and streak tracking
- Bookmark browser (Chrome bookmarks indexed into a bottom bar)
- Dock (quick-launch links)
- Command palette (fuzzy search, 34 built-in commands, custom ones too)
- Zen mode
- Editable themes (11 presets)

**PKM workspace - opens when you need it:**
- Block editor (Notion-style - text, headings, tasks, kanban, queries, callouts, images, tables, dividers, code blocks)
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

I use it every day. Every tab I open lands here. The pomodoro keeps me honest, missions track what I need to do, notes capture everything, and the canvas lets me think spatially. It's replaced my task manager, my scratchpad, and half my bookmarks bar.

It's not trying to be the next big thing. It's just my terminal for the browser - and it works exactly how I want it to.

## Release / install

### From a release zip (recommended)

Grab the latest `vinland-v<version>.zip` from the [Releases page](https://github.com/8-BitRhyon/Vinland_New_Tab/releases):

1. Download `vinland-v<version>.zip`
2. Unzip it anywhere (e.g. `~/Downloads/vinland/`)
3. Open `chrome://extensions`
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the unzipped `vinland` folder
6. Open a new tab - Vinland replaces the new-tab page

The release zip is ~540KB and ships only what the store ships - dev/test tooling
is excluded. An 80MB size guard, a composition report (10 largest paths), and a
dedicated exclusion test suite run on every push, so bloat can't silently ship.

### From source

```
git clone https://github.com/8-BitRhyon/Vinland_New_Tab
# no install step - it's vanilla
# chrome://extensions → Load unpacked → select the repo folder
```

### Build a store zip

```bash
bash scripts/package-release.sh
# → dist/vinland-v<version>.zip (~541KB)
```

The script prints the 10 largest included paths, enforces an 80MB size guard
(Chrome Web Store caps at 100MB), and excludes dev/tooling (tests, docs,
node_modules, .git, .venv, ...). Guarded by `tests/package-exclusions-unit-tests.mjs`
and the `package-check` CI job on every push.

## Tests / CI

- **Unit**: `npm test` - 678 tests across 16 zero-dependency suites
- **E2E**: `npm run test:e2e` - 34 Playwright specs against a local static server
- **CI**: both run on every push via [GitHub Actions](https://github.com/8-BitRhyon/Vinland_New_Tab/actions/workflows/ci.yml) - 8 jobs: unit-tests, 4 E2E shards, CLI command sweep, real-extension release-candidate smoke, and the store-zip `package-check` gate

## Design

Architecture and everything else is documented in [`docs/design.md`](docs/design.md).
