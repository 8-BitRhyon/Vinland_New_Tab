// L1: mirrors Config.js — the payload version, not the storage key name.
const CONFIG_VERSION = 4;

const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    user_name: "",
    theme_color: "#00FF41",
    secondary_color: "#888888",
    secondary_font: "'Space Mono', monospace",
    crt_effect: false,
    vignette_effect: false,
    noise_effect: false,
    typing_sounds: false,
    ui_sounds: false,
    show_bookmarks: true,
    search_engine: "google",
    location: "",
    use_celsius: false,
    weather_extended: false,
    filter_enabled: true,
    filter_grayscale: 100,
    filter_contrast: 120,
    filter_brightness: 60,
    filter_blur: 0,
    // Font settings
    clock_font_size: 7,
    clock_font: "Space Mono",
    weather_scale: 1.0,
    theme_preset: "",
    // Custom themes (V17)
    custom_themes: [],
    // Auto-theming (V17)
    auto_theme_enabled: false,
    day_theme: "minimal",
    night_theme: "matrix",
    // AI Indexing (NEW)
    indexing: {
        enabled: true,
        provider: "openrouter",
        model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
        dimensions: 1024,
        vectorStore: "lancedb"
    },
    day_start_hour: 6,
    night_start_hour: 18,
    // Integrations
    habit_id: "",
    life_id: "",
    trello_board: "",
    notion_page: "",
    github_user: "",
    // Backgrounds
    backgrounds: [],
    background_type: "media", // media, color
    background_color: "#000000",
    // Dock
    dock_links: [
        { name: "GEMINI", url: "https://gemini.google.com" },
        { name: "CAL", url: "https://calendar.google.com" },
        { name: "MAIL", url: "https://mail.google.com" },
        { name: "TASKS", url: "https://calendar.google.com/calendar/u/0/r/tasks" },
        { name: "KEEP", url: "https://keep.google.com" },
        { name: "DRIVE", url: "https://drive.google.com" }
    ],
    // Toggles
    auto_clear_interval: 'daily', // .5: never, daily, 2days, weekly, biweekly, monthly
    hide_completed_tasks: false, // .4: Auto-hide completed tasks
    enable_blur_overlay: true, // .8: Toggle for blur overlay
    last_clear_date: "", // stored as YYYY-MM-DD
    custom_commands: [
        { trigger: "gh", url: "https://github.com" },
        { trigger: "reddit", url: "https://reddit.com" }
    ],
    notes_tabs_enabled: true,
    first_run: true
};

function getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export const State = {
    CONFIG: getDefaultConfig(),
    TASKS: [],
    NOTES: [],
    BOARDS: [], // .0: Kanban Boards collection
    CANVASES: [], // Phase 3: Visual Canvas data
    COMMAND_HISTORY: [],
    FLAT_BOOKMARKS: [],

    // ── Sprint C (M1): O(1) note lookups ────────────────────────
    // id -> note reference cache. Holds REFERENCES to the same objects in
    // State.NOTES, so in-place edits (content, title, blocks) stay in sync
    // automatically. Rebuilt lazily when the array reference or length changes
    // (covers push/unshift/splice/filter/reassignment), or when invalidated
    // by Storage (loadData/saveData/imports) via _invalidateNoteMaps().
    NOTE_MAP: null,
    // lowercased title -> note reference (first match wins, mirrors find()).
    NOTE_TITLE_MAP: null,
    _notesRef: null,   // last-seen State.NOTES array reference
    _notesLen: -1,     // last-seen length (catches push/splice without ref change)
    _notesDirty: false, // set by Storage after saves/imports (title renames)

    
    _rebuildNoteMaps: function() {
        var map = new Map();
        var titleMap = new Map();
        (this.NOTES || []).forEach(function(n) {
            if (!n || !n.id) return;
            map.set(n.id, n);
            var t = String(n.title || '').toLowerCase();
            if (t && !titleMap.has(t)) titleMap.set(t, n); // first match wins
        });
        this.NOTE_MAP = map;
        this.NOTE_TITLE_MAP = titleMap;
        this._notesRef = this.NOTES;
        this._notesLen = (this.NOTES || []).length;
        this._notesDirty = false;
    },

    
    _invalidateNoteMaps: function() {
        this._notesDirty = true;
    },

    
    _ensureNoteMaps: function() {
        if (!this.NOTE_MAP || this._notesRef !== this.NOTES ||
            this._notesLen !== (this.NOTES || []).length) {
            this._rebuildNoteMaps();
        }
    },

    
    getNote: function(noteId) {
        if (!noteId) return undefined;
        this._ensureNoteMaps();
        return this.NOTE_MAP.get(noteId);
    },

    
    getNoteByTitle: function(title) {
        if (!title) return undefined;
        this._ensureNoteMaps();
        // The title map is rebuilt only when structural OR title state changed
        // (_notesDirty set by Storage after saves — catches in-place renames).
        if (this._notesDirty || !this.NOTE_TITLE_MAP) {
            this._rebuildNoteMaps();
        }
        return this.NOTE_TITLE_MAP.get(String(title).toLowerCase());
    },
    
    // Core State
    IS_PREVIEW_MODE: false,
    CONFIG_DIRTY: false,
    WEATHER_CACHE: null, // .11: Memory-first weather cache
    DYNAMIC_ICON_URL: 'icon.png',
    
    // Additional globals tracked in Store
    ROOT_ID: '1',
    NAV_STACK: [],
    CURRENT_BOOKMARK_FOLDER: '1',
    SESSION_START: Date.now(),
    POMODORO: { active: false, paused: false, endTime: null, remaining: 0, interval: null, originalDuration: 0 },
    HISTORY_INDEX: -1,
    SUGGESTION_INDEX: -1,
    CURRENT_SUGGESTIONS: [],
    BG_RETRY_COUNT: 0,
    BG_MAX_RETRIES: 2,
    LAST_STREAK_CHECK_DATE: null,
    
    // Constants
    DEFAULT_CONFIG,
    getDefaultConfig
};
