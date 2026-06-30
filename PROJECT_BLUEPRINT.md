# Project Blueprint: Vinland New Tab Page

Vinland is a lightweight, high-performance Chrome Extension New Tab override page that combines a visual graph canvas and a command-line terminal interface. The goal is to build a fast, offline-first personal knowledge management (PKM) canvas that rivals the capabilities of Obsidian Canvas and Excalidraw.

---

## 1. Core Technology Stack
To ensure near-instantaneous startup times on opening a new browser tab, Vinland deliberately avoids heavy frontend frameworks and compilation steps:
*   **Platform**: Chrome Extension Manifest V3 (`manifest.json`, `rules.json`).
*   **Languages**: Vanilla JavaScript (ES6+ Modules), HTML5, and Vanilla CSS.
*   **Visualization**: [D3.js (v7)](file:///Users/rhyon/Downloads/Self%20Curated%20CS%20Curriculum/Projects/Vinland_New_Tab/d3.v7.min.js) for force-directed graph layouts.
*   **Graphics**: HTML5 Canvas & inline SVGs for real-time edge routing and grid renders.
*   **Font**: JetBrains Mono (configured for code and editor views).

---

## 2. Directory & Module Architecture

```
Vinland_New_Tab/
├── manifest.json              # Extension setup, host permissions, CSP
├── rules.json                 # declarativeNetRequest headers modification rules
├── index.html                 # Main markup and CSS design styles
├── js/
│   ├── main.js                # App bootstrap and initialization coordinator
│   ├── boot.js                # Environment, theme, and viewport setup
│   │
│   ├── core/                  # Core system engines and state wrappers
│   │   ├── store.js           # Shared application state
│   │   ├── storage.js         # Local & sync storage wrappers
│   │   ├── config.js          # Project variables and theme palettes
│   │   ├── queryengine.js     # Search indexes and local caching
│   │   ├── commandregistry.js # Terminal command mappings
│   │   └── audio.js           # Custom audio controllers
│   │
│   ├── modules/               # Key functional systems
│   │   ├── canvasmanager.js   # Canvas nodes, dragging, lasso marquee, clipboard, history
│   │   ├── notescontroller.js # File storage, content parsing, markdown renders
│   │   └── graphmanager.js    # Interactive global note graph mapping
│   │
│   └── ui/                    # View controllers
│       ├── settingsui.js      # Configuration and settings dashboards
│       ├── slashmenu.js       # Popup inline command palette
│       ├── hoverpreview.js    # Preview cards for note references
│       └── background.js      # Dynamic video/image wallpapers
```

---

## 3. Active Canvas Features

### 1. Spatial Node Layout
*   **Card Types**: Text nodes, file cards (linking local markdown files), embed nodes (iframes), and spatial groups.
*   **Spatial Grouping**: Group nodes (`.canvas-group`) automatically act as bounding containers—moving a group moves all nested card components together.
*   **Auto Snapping**: Connectors snap automatically to the closest cardinal ports (North, South, East, West).

### 2. Multi-Node Selection & Dragging
*   **Lasso Marquee**: Left-click-drag on the empty background draws a dashed marquee box, highlighting and selecting nodes inside it in real-time.
*   **Multi-Select**: Toggle selection on individual nodes using `Cmd+Click` / `Ctrl+Click`.
*   **Batch Move**: Dragging any card in a selection translates all selected nodes by the same coordinate offset.

### 3. Clipboard & Actions
*   **Copy / Paste**: `Cmd+C` / `Cmd+V` deep-clones selected cards and duplicates inner edge connections. Piped nodes are pasted directly centered at the current cursor coordinates.
*   **Duplicate**: `Cmd+D` instantly duplicates selection inline with a layout offset cascade.
*   **Batch Delete**: Reconfigured Backspace / Delete keys and individual delete buttons to perform batch deletion on all highlighted cards and their connection lines.

### 4. Undo/Redo Engine
*   A rolling 50-state history stack tracks all major canvas changes (spawning, dragging, resizing, color modifications, edge routing, text edits on blur). Bound to `Cmd+Z` and `Cmd+Shift+Z` / `Cmd+Y`.

---

## 4. Dependencies & Security Rules
*   **Local Assets**: `d3.v7.min.js` and fonts are hosted locally to bypass external dependencies and remote loading blocks.
*   **CSP Rules**: Custom CSP declared in [manifest.json](file:///Users/rhyon/Downloads/Self%20Curated%20CS%20Curriculum/Projects/Vinland_New_Tab/manifest.json) permits frame connections to Google Docs/Slides/Sheets and YouTube.
*   **declarativeNetRequest Rules**: Managed in [rules.json](file:///Users/rhyon/Downloads/Self%20Curated%20CS%20Curriculum/Projects/Vinland_New_Tab/rules.json) to spoof `Origin` and `Referer` headers on `sub_frame` requests, bypassing iframe embed block restrictions (e.g. Google Docs).

---

## 5. Development Roadmap (Future Specs)
1.  **Bi-directional Link Auto-Routing**: Writing wiki-links (`[[Note Name]]`) inside text nodes automatically draws matching edge links on the canvas.
2.  **Excalidraw-style Sketching**: Introduce a light canvas sketching overlay for manual handwriting, circles, and arrows.
3.  **PDF/Media Annotations**: Support local file readers (PDF, images, audio) directly inside cards with annotation memory.
4.  **Board Templates**: Save layouts as custom structural templates for quick workspace generation.
