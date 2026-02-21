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
    auto_clear_interval: 'daily', // V18.5: never, daily, 2days, weekly, biweekly, monthly
    hide_completed_tasks: false, // V18.4: Auto-hide completed tasks
    enable_blur_overlay: true, // V18.8: Toggle for blur overlay
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
    BOARDS: [], // V3.0: Kanban Boards collection
    CANVASES: [], // Phase 3: Visual Canvas data
    COMMAND_HISTORY: [],
    FLAT_BOOKMARKS: [],
    
    // Core State
    IS_PREVIEW_MODE: false,
    CONFIG_DIRTY: false,
    WEATHER_CACHE: null, // V18.11: Memory-first weather cache
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
