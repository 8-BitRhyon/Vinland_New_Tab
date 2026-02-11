import { State } from './Store.js';

const CONFIG_KEY = 'OPERATOR_CONFIG_V3';
const CONFIG_VERSION = 4;

// Default Configuration
const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    user_name: "",
    theme_color: "#00FF41",
    secondary_color: "#888888",
    secondary_font: "'Space Mono', monospace",
    clock_font: "Space Mono",
    clock_font_size: 7,
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
    background_type: "media", 
    background_color: "#000000",
    backgrounds: [],
    custom_themes: [],
    dock_links: [
        { name: "GMAIL", url: "https://mail.google.com" },
        { name: "CAL", url: "https://calendar.google.com" },
        { name: "GPT", url: "https://chat.openai.com" }
    ],
    custom_commands: []
};

/* =========================================
   THEME PRESETS (V17.0 - Complete Packages)
   ========================================= */
export const THEME_PRESETS = {
    matrix: {
        name: "Matrix",
        theme_color: "#00FF41",
        secondary_color: "#006618",
        clock_font: "Space Mono",
        secondary_font: "'Space Mono', monospace",
        filter_grayscale: 100,
        filter_contrast: 120,
        filter_brightness: 60,
        filter_blur: 0
    },
    cyberpunk: {
        name: "Cyberpunk Neon",
        theme_color: "#FF00FF",
        secondary_color: "#00FFFF",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 140,
        filter_brightness: 50,
        filter_blur: 0
    },
    ocean: {
        name: "Ocean Blue",
        theme_color: "#00FFFF",
        secondary_color: "#0077BE",
        clock_font: "Roboto Mono",
        secondary_font: "'Roboto Mono', monospace",
        filter_grayscale: 50,
        filter_contrast: 110,
        filter_brightness: 70,
        filter_blur: 0
    },
    sunset: {
        name: "Sunset",
        theme_color: "#FF6600",
        secondary_color: "#CC3300",
        clock_font: "Ubuntu Mono",
        secondary_font: "'Ubuntu Mono', monospace",
        filter_grayscale: 0,
        filter_contrast: 130,
        filter_brightness: 55,
        filter_blur: 0
    },
    minimal: {
        name: "Minimal Grayscale",
        theme_color: "#FFFFFF",
        secondary_color: "#888888",
        clock_font: "Inconsolata",
        secondary_font: "'Inconsolata', monospace",
        filter_grayscale: 100,
        filter_contrast: 100,
        filter_brightness: 40,
        filter_blur: 0
    },
    blood: {
        name: "Blood Moon",
        theme_color: "#D32F2F",
        secondary_color: "#8B0000",
        clock_font: "Fira Code",
        secondary_font: "'Fira Code', monospace",
        filter_grayscale: 20,
        filter_contrast: 130,
        filter_brightness: 50,
        filter_blur: 0
    },
    gold: {
        name: "Gold Rush",
        theme_color: "#FFD700",
        secondary_color: "#B8860B",
        clock_font: "JetBrains Mono",
        secondary_font: "'JetBrains Mono', monospace",
        filter_grayscale: 0,
        filter_contrast: 110,
        filter_brightness: 90,
        filter_blur: 0
    },
    forest: {
        name: "Forest",
        theme_color: "#228B22",
        secondary_color: "#90EE90",
        clock_font: "Source Code Pro",
        secondary_font: "'Source Code Pro', monospace",
        filter_grayscale: 30,
        filter_contrast: 115,
        filter_brightness: 65,
        filter_blur: 0
    },
    amber: {
        name: "Amber Terminal",
        theme_color: "#FFBF00",
        secondary_color: "#CC9900",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 120,
        filter_brightness: 70,
        filter_blur: 0
    },
    ice: {
        name: "Ice",
        theme_color: "#87CEEB",
        secondary_color: "#B0E0E6",
        clock_font: "IBM Plex Mono",
        secondary_font: "'IBM Plex Mono', monospace",
        filter_grayscale: 40,
        filter_contrast: 105,
        filter_brightness: 80,
        filter_blur: 0
    },
    lavender: {
        name: "Lavender Dreams",
        theme_color: "#9370DB",
        secondary_color: "#E6E6FA",
        clock_font: "Roboto Mono",
        secondary_font: "'Roboto Mono', monospace",
        filter_grayscale: 10,
        filter_contrast: 100,
        filter_brightness: 75,
        filter_blur: 0
    },
    retrogreen: {
        name: "Retro CRT",
        theme_color: "#33FF33",
        secondary_color: "#00AA00",
        clock_font: "VT323",
        secondary_font: "'VT323', monospace",
        filter_grayscale: 0,
        filter_contrast: 150,
        filter_brightness: 45,
        filter_blur: 0,
        crt_effect: true
    }
};

export const Config = {
    // Load config from LocalStorage
    load: function() {
        try {
            const stored = localStorage.getItem(CONFIG_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge stored config with defaults to ensure new fields exist
                State.CONFIG = Object.assign({}, DEFAULT_CONFIG, parsed);
                
                // Safety checks for arrays
                if (!Array.isArray(State.CONFIG.dock_links)) State.CONFIG.dock_links = DEFAULT_CONFIG.dock_links;
                if (!Array.isArray(State.CONFIG.custom_commands)) State.CONFIG.custom_commands = [];
                if (!Array.isArray(State.CONFIG.backgrounds)) State.CONFIG.backgrounds = [];
            } else {
                State.CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            }
        } catch (e) {
            console.error('Config load error:', e);
            State.CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        return State.CONFIG;
    },

    // Save config to LocalStorage
    save: function() {
        try {
            State.CONFIG.version = CONFIG_VERSION;
            localStorage.setItem(CONFIG_KEY, JSON.stringify(State.CONFIG));
            
            // Optional: Chrome Sync support if available
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ [CONFIG_KEY]: State.CONFIG });
            }
            console.log("Vinland: Config saved.");
        } catch (e) {
            console.error('Config save error:', e);
        }
    },

    // Apply Theme (CSS Variables)
    applyTheme: function() {
        const config = State.CONFIG;
        const root = document.documentElement;
        
        // 1. Colors
        const color = config.theme_color || '#00FF41';
        root.style.setProperty('--main-color', color);
        root.style.setProperty('--secondary-color', config.secondary_color || '#888888');

        // 2. RGB Calculation for RGBA support
        let r = 0, g = 255, b = 65;
        if (color.startsWith('#')) {
            const hex = color.substring(1);
            const val = parseInt(hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex, 16);
            r = (val >> 16) & 255;
            g = (val >> 8) & 255;
            b = val & 255;
        }
        root.style.setProperty('--main-color-rgb', `${r}, ${g}, ${b}`);

        // 3. Fonts
        const mainFont = config.clock_font || 'Space Mono';
        const secFont = config.secondary_font || "'Space Mono', monospace";
        root.style.setProperty('--font-main', mainFont + ', monospace'); // Ensure fallback
        root.style.setProperty('--font-secondary', secFont);

        // 4. Clock Size
        const clockEl = document.getElementById('clock');
        if (clockEl) {
            clockEl.style.fontFamily = `"${mainFont}", monospace`;
            clockEl.style.fontSize = (config.clock_font_size || 7) + 'rem';
        }

        // 5. Visual Effects (CRT, Vignette, Noise)
        this._toggleOverlay('crt-overlay', config.crt_effect);
        this._toggleOverlay('vignette-overlay', config.vignette_effect);
        this._toggleOverlay('noise-overlay', config.noise_effect);

        // 6. Video Filters
        this.applyVideoFilters();
        
        // 7. Update Dynamic Icon
        if (typeof updateDynamicIcon === 'function') updateDynamicIcon(color);
        else this.updateIcon(color);

        // 8. Weather Scale
        const weatherWidget = document.getElementById('weather-widget');
        if (weatherWidget) {
            const scale = parseFloat(config.weather_scale) || 1.0;
            weatherWidget.style.transform = `scale(${scale})`;
            weatherWidget.style.transformOrigin = 'top right';
        }
    },
    
    // Internal icon update if not global
    updateIcon: function(color) {
         var svg = `
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" fill="black"/>
                <path d="M10 8L2 16L10 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M22 8L30 16L22 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18 6L14 26" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        
        State.DYNAMIC_ICON_URL = 'data:image/svg+xml;base64,' + btoa(svg.trim());
        var link = document.querySelector("link[rel*='icon']");
        if (link) link.href = State.DYNAMIC_ICON_URL;
    },

    _toggleOverlay: function(id, isActive) {
        const el = document.getElementById(id);
        if (el) {
            if (isActive) el.classList.add('active');
            else el.classList.remove('active');
        }
    },

    applyVideoFilters: function() {
        const config = State.CONFIG;
        const video = document.getElementById('bg-video');
        const bgImage = document.getElementById('bg-image');
        
        if (config.filter_enabled === false) {
            if (video) video.style.filter = 'none';
            if (bgImage) bgImage.style.filter = 'none';
            return;
        }

        const gs = config.filter_grayscale !== undefined ? config.filter_grayscale : 100;
        const ct = config.filter_contrast !== undefined ? config.filter_contrast : 120;
        const br = config.filter_brightness !== undefined ? config.filter_brightness : 60;
        const bl = config.filter_blur !== undefined ? config.filter_blur : 0;

        const filterVal = `grayscale(${gs}%) contrast(${ct/100}) brightness(${br/100}) blur(${bl}px)`;
        
        if (video) video.style.filter = filterVal;
        if (bgImage) bgImage.style.filter = filterVal;
    }
};

// Export legacy global wrappers for SettingsUI to use
export function loadConfig() { return Config.load(); }
export function saveConfig() { return Config.save(); }
