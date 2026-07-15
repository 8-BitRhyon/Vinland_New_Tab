# Vinland

> A Manifest V3 new-tab command center. Keyboard-first, local-first, no framework, no bundler.

The name is from *Vinland Saga*. The idea of a place beyond all the fighting — peace on the other side of pain. That stuck with me. This is that place for my browser.

## What it is

Your new-tab becomes a HUD. Clock, pomodoro, missions, weather, bookmarks, command palette — all visible at once, no clicking through tabs. Below that is the PKM workspace: a block editor, an infinite spatial canvas, a D3 knowledge graph, kanban boards, a dataview-lite query engine. All in the browser, all local.

It's the command line I've always wanted in a browser. `note Buy groceries`, `pomo 25`, `daily`, `canvas`, `b github`, `task finish report @work !!` — type and go. No mouse needed.

## What it isn't

- Not a startup. Not a product. Not a business.
- Not for anybody else — I made it for how I work.
- It's a single HTML file, vanilla JS, and D3 v7. No npm, no bundler, no webpack config.
- Everything stays in localStorage. Your notes, tasks, boards — they live on your machine.

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

**HUD — always visible on every new tab:**
- Clock (12/24h)
- Pomodoro timer with cross-tab sync
- Weather (Open-Meteo, 30-min cache)
- Mission log with priority flags and streak tracking
- Bookmark browser (Chrome bookmarks indexed into a bottom bar)
- Dock (quick-launch links)
- Command palette (fuzzy search, 17 built-in commands, custom ones too)
- Zen mode
- Editable themes (11 presets)

**PKM workspace — opens when you need it:**
- Block editor (Notion-style — text, headings, tasks, kanban, queries, callouts, images, tables, dividers, code blocks)
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

**17 CLI commands:**

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
| `reload` | Reload extension |
| `help` / `man` | Show command reference |

## Why it works

I use it every day. Every tab I open lands here. The pomodoro keeps me honest, missions track what I need to do, notes capture everything, and the canvas lets me think spatially. It's replaced my task manager, my scratchpad, and half my bookmarks bar.

It's not trying to be the next big thing. It's just my terminal for the browser — and it works exactly how I want it to.

## Build / run

```
git clone https://github.com/8-BitRhyon/Vinland_New_Tab
# no install step — it's vanilla
# Load as unpacked extension in Chrome:
# chrome://extensions → Load unpacked → select this folder
```

Tests: `npm test` (70 tests across 3 suites — notes unit, editor ordering, storage sharding).

## Design

Architecture and everything else is documented in [`docs/design.md`](docs/design.md).
