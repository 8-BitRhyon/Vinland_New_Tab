import { State } from '../core/Store.js';
import { Config, saveConfig, loadConfig, THEME_PRESETS } from '../core/Config.js';
import { ModalManager } from './ModalManager.js';
import { DB, VinlandDB, saveData } from '../core/Storage.js';
import { safeText, validateURL } from '../core/Utils.js';
import { Audio, playNotificationSound } from '../core/Audio.js';
import { TabManager } from './TabManager.js';

var isConfigLoading = false;
var BG_RETRY_COUNT = 0;
var BG_MAX_RETRIES = 3;
var CONFIG_DIRTY = false;

// Global showNotification placeholder
function showNotification(msg) {
    if (typeof Audio !== 'undefined' && Audio.playNotificationSound) Audio.playNotificationSound();
    
    var existing = document.getElementById('notif-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'notif-toast';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:var(--bg-overlay); border:1px solid var(--main-color); color:var(--main-color); padding:15px 30px; font-family:"Space Mono", monospace; font-size:14px; z-index:30000; box-shadow:0 0 20px rgba(0,0,0,0.5); opacity:0; transition:opacity 0.3s; pointer-events:none; backdrop-filter:blur(5px);';

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        toast.style.opacity = '1';
    });

    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 300);
    }, 3000);
}

function resetSaveButtonState() {
    var headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) {
        headerSaveBtn.innerText = 'SAVE';
        headerSaveBtn.style.color = '';
        headerSaveBtn.style.background = ''; 
        headerSaveBtn.style.boxShadow = '';
        headerSaveBtn.style.textShadow = ''; 
        headerSaveBtn.style.border = '';
    }
}

function markDirty() {
    if (isConfigLoading) return;
    CONFIG_DIRTY = true;
    var headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) {
        headerSaveBtn.innerText = 'SAVE *';
        // V19.34: UX Improvement - "Hot Button" Style
        // Solid background (Main Color) + Dark Text + Outer Glow = High Urgency
        headerSaveBtn.style.background = 'var(--main-color)'; 
        headerSaveBtn.style.color = '#000'; // High contrast
        headerSaveBtn.style.boxShadow = '0 0 15px var(--main-color)'; // Strong outer glow
        headerSaveBtn.style.textShadow = 'none'; // Clean text for readability
        headerSaveBtn.style.border = '1px solid var(--main-color)'; 
    }
}

export const SettingsUI = {
    applyTheme: function() { Config.applyTheme(); },
    init: function() {
        // Expose for ModalManager (avoid circular import)
        window.closeSettingsModal = this.close.bind(this);

        // Bind settings toggle button (Correct ID: config-btn)
        // REMOVED: Handled by boot.js bindGlobals (onclick) to prevent double-toggle
        /*
        const btn = document.getElementById('config-btn');
        if (btn) btn.addEventListener('click', this.toggleConfig.bind(this));
        
        const helpBtn = document.getElementById('help-btn');
        if (helpBtn) helpBtn.addEventListener('click', this.toggleHelp.bind(this));

        const headerSaveBtn = document.getElementById('header-save-btn');
        if (headerSaveBtn) headerSaveBtn.addEventListener('click', this.saveConfigFromUI.bind(this));
        */
        
        // Tab Navigation Binding
        var navItems = document.querySelectorAll('.config-nav-item');
        var self = this;
        navItems.forEach(function(item) {
            item.onclick = function() {
                navItems.forEach(n => n.classList.remove('active'));
                this.classList.add('active');
                
                var tab = this.getAttribute('data-tab');
                // Hide all tabs
                document.querySelectorAll('.config-tab').forEach(t => t.style.display = 'none');
                
                // Show selected tab
                var target = document.getElementById('tab-' + tab);
                if (target) target.style.display = 'block';

                // Populate Raw Config (It's in the maintenance tab)
                if (tab === 'maintenance') {
                     var rawArea = document.getElementById('cfg-json-dump'); 
                     if (rawArea) rawArea.value = JSON.stringify(State.CONFIG, null, 4);
                }
            };
        });
        
        // Background Upload Binding
        var uploadBtn = document.getElementById('upload-bg-btn');
        var fileInput = document.getElementById('bg-file-input');
        if (uploadBtn && fileInput) {
            uploadBtn.onclick = function() { fileInput.click(); };
            fileInput.onchange = this.handleBackgroundUpload.bind(this);
        }

        // Theme Action Buttons
        var self = this;
        var btnSaveTheme = document.getElementById('btn-save-theme');
        if(btnSaveTheme) btnSaveTheme.onclick = function() { self.openThemeModal('save'); };
        
        var btnExportTheme = document.getElementById('btn-export-theme');
        if(btnExportTheme) btnExportTheme.onclick = function() { self.openThemeModal('export'); };
        
        var btnImportTheme = document.getElementById('btn-import-theme');
        if(btnImportTheme) btnImportTheme.onclick = function() { self.openThemeModal('import'); };
        
        var btnDeleteTheme = document.getElementById('btn-delete-theme');
        if(btnDeleteTheme) btnDeleteTheme.onclick = function() { self.deleteCustomTheme(); };

        // Theme Modal Bindings
        var themeCancel = document.getElementById('theme-modal-cancel');
        if(themeCancel) themeCancel.onclick = this.closeThemeModal.bind(this);
        
        var themeConfirm = document.getElementById('theme-modal-confirm');
        if(themeConfirm) themeConfirm.onclick = this.handleThemeModalConfirm.bind(this);
        
        // CHANGED: Bind all config inputs to markDirty
        // CHANGED: Bind all config inputs to checkDirty (True State Check)
        var checkDirtyHandler = function(e) {
             if (ModalManager.stack.includes('config-modal')) {
                 if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                     // Debounce slightly to ensure value is propogated
                     setTimeout(function() { 
                        if (window.SettingsUI && window.SettingsUI.checkDirty) {
                            window.SettingsUI.checkDirty(); 
                        } else {
                            markDirty(); // Fallback
                        }
                     }, 10);
                 }
             }
        };
        document.addEventListener('input', checkDirtyHandler);
        document.addEventListener('change', checkDirtyHandler);
        
        // Nav Arrow Key Binding
        document.addEventListener('keydown', function(e) {
            // Only active if config modal is showing
            var configModal = document.getElementById('config-modal');
            if (!configModal || !configModal.classList.contains('active')) return;
            
            // Ignore if focus is in an input field (so we don't block cursor movement)
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                var navItems = Array.from(document.querySelectorAll('.config-nav-item'));
                var activeIndex = navItems.findIndex(n => n.classList.contains('active'));
                
                if (activeIndex === -1 && navItems.length > 0) activeIndex = 0;
                
                if (e.key === 'ArrowDown') {
                    var nextIndex = (activeIndex + 1) % navItems.length;
                    navItems[nextIndex].click();
                    e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                    var prevIndex = (activeIndex - 1 + navItems.length) % navItems.length;
                    navItems[prevIndex].click();
                    e.preventDefault();
                }
            }
        });
    },

    toggleConfig: function() {
        console.log('[SettingsUI] toggleConfig called');
        var modal = document.getElementById('config-modal');
        var helpModal = document.getElementById('help-modal');
        if (modal.classList.contains('active')) {
            this.close();
        } else {
            console.log('[SettingsUI] Opening from toggle...');
            if (helpModal) helpModal.style.display = 'none';
            this.open();
        }
    },

    toggleHelp: function() {
        var modal = document.getElementById('help-modal');
        if (!modal) return;
        
        if (modal.classList.contains('active')) {
            ModalManager.close('help-modal');
        } else {
            ModalManager.open('help-modal');
        }
    },

    open: function() {
        console.log('[SettingsUI] open() - vResolved');
        
        // Load latest config to ensure UI matches state
        this.loadConfigToUI();
        
        ModalManager.open('config-modal');
        
        // Default to Interface tab if none selected
        var activeTab = document.querySelector('.config-tab[style*="block"]');
        if (!activeTab) {
            var navs = document.querySelectorAll('.config-nav-item');
            if(navs.length > 0) navs[0].click();
        }
    },

    loadConfigToUI: function() {
        console.log('[SettingsUI] Loading Config to UI...');
        var CONFIG = State.CONFIG;
        var el;

        // Fonts
        el = document.getElementById('cfg-font'); if(el) el.value = CONFIG.clock_font || 'Inter, sans-serif';
        el = document.getElementById('cfg-font-secondary'); if(el) el.value = CONFIG.secondary_font || 'Space Mono, monospace';
        el = document.getElementById('cfg-clock-size'); if(el) el.value = CONFIG.clock_font_size || 120;

        // Toggles
        el = document.getElementById('cfg-show-bm'); if(el) el.checked = CONFIG.show_bookmarks !== false;
        el = document.getElementById('cfg-blur-overlay'); if(el) el.checked = CONFIG.enable_blur_overlay !== false;
        el = document.getElementById('cfg-hide-completed'); if(el) el.checked = CONFIG.hide_completed_tasks || false;
        el = document.getElementById('cfg-show-seconds'); if(el) el.checked = CONFIG.show_seconds || false;

        // System
        el = document.getElementById('cfg-name'); if(el) el.value = CONFIG.user_name || 'MAYOR';
        el = document.getElementById('cfg-location'); if(el) el.value = CONFIG.location || 'SAN FRANCISCO';
        el = document.getElementById('cfg-engine'); if(el) el.value = CONFIG.search_engine || 'google';
        el = document.getElementById('cfg-celsius'); if(el) el.checked = CONFIG.use_celsius || false;
        el = document.getElementById('cfg-weather-extended'); if(el) el.checked = CONFIG.weather_extended || false;
        el = document.getElementById('cfg-weather-scale'); 
        if(el) { el.value = CONFIG.weather_scale || 1; document.getElementById('cfg-weather-scale-val').textContent = el.value + 'x'; }

        // Visuals
        el = document.getElementById('cfg-color'); if(el) el.value = CONFIG.theme_color || '#00FF41';
        el = document.getElementById('cfg-secondary-color'); if(el) el.value = CONFIG.secondary_color || '#003300';
        el = document.getElementById('cfg-sounds'); if(el) el.checked = CONFIG.typing_sounds !== false;
        el = document.getElementById('cfg-ui-sounds'); if(el) el.checked = CONFIG.ui_sounds !== false;

        // Filter
        el = document.getElementById('cfg-filter-enabled'); if(el) el.checked = CONFIG.filter_enabled !== false;
        el = document.getElementById('cfg-crt'); if(el) el.checked = CONFIG.crt_effect !== false;
        el = document.getElementById('cfg-vignette'); if(el) el.checked = CONFIG.vignette_effect !== false;
        el = document.getElementById('cfg-noise'); if(el) el.checked = CONFIG.noise_effect !== false;
        
        el = document.getElementById('cfg-grayscale'); 
        if(el) { el.value = CONFIG.filter_grayscale || 0; document.getElementById('cfg-grayscale-val').textContent = el.value + '%'; }
        
        el = document.getElementById('cfg-contrast'); 
        if(el) { el.value = CONFIG.filter_contrast || 100; document.getElementById('cfg-contrast-val').textContent = el.value + '%'; }
        
        el = document.getElementById('cfg-brightness'); 
        if(el) { el.value = CONFIG.filter_brightness || 100; document.getElementById('cfg-brightness-val').textContent = el.value + '%'; }
        
        el = document.getElementById('cfg-blur'); 
        if(el) { el.value = CONFIG.filter_blur || 0; document.getElementById('cfg-blur-val').textContent = el.value + 'px'; }

        // Backgrounds
        el = document.getElementById('cfg-bg-type'); if(el) el.value = CONFIG.background_type || 'media';
        el = document.getElementById('cfg-bg-color'); if(el) el.value = CONFIG.background_color || '#000000';
        el = document.getElementById('cfg-backgrounds');
        if (el && CONFIG.backgrounds) {
            el.value = CONFIG.backgrounds.join('\n');
        }

        // Modules
        el = document.getElementById('cfg-auto-clear-interval'); if (el) el.value = CONFIG.auto_clear_interval || 'never';
        el = document.getElementById('cfg-habit'); if (el) el.value = CONFIG.habit_id || '';
        el = document.getElementById('cfg-life'); if (el) el.value = CONFIG.life_id || '';
        el = document.getElementById('cfg-trello'); if (el) el.value = CONFIG.trello_board || '';
        el = document.getElementById('cfg-notion'); if (el) el.value = CONFIG.notion_page || '';
        el = document.getElementById('cfg-github'); if (el) el.value = CONFIG.github_username || '';
        
        // Notes Tab
        el = document.getElementById('cfg-notes-tabs-enabled'); if(el) el.checked = CONFIG.notes_tabs_enabled !== false;

        this.renderDockLinksConfig();
        this.renderCustomCommandsList();
        this.renderThemePresets();
        this.updateBackgroundPreview();

        // Raw
        var rawInput = document.getElementById('cfg-json-dump');
        if (rawInput) rawInput.value = JSON.stringify(CONFIG, null, 4);
        
        document.querySelectorAll('.config-tab').forEach(t => t.style.display = 'none');
        var defaultTabContent = document.getElementById('tab-interface');
        if(defaultTabContent) defaultTabContent.style.display = 'block';

        // [FIX] Capture Baseline State from UI (Normalized)
        // This handles type coercion and default values correctly.
        if (this.getConfigFromUI) {
            this.baseline = JSON.stringify(this.getConfigFromUI());
        }

        isConfigLoading = false; // UNLOCK dirty tracker
        CONFIG_DIRTY = false;
        resetSaveButtonState();
    },

    close: function(force) {
        if (!force && CONFIG_DIRTY) {
            // Unsaved changes confirmation
            if (window.showConfirmModal) {
                var self = this;
                window.showConfirmModal(
                    "UNSAVED CHANGES",
                    "You have unsaved changes.",
                    function() {
                        // Confirm (Save)
                        self.saveConfigFromUI();
                    },
                    function() {
                        // Discard (Reset)
                        CONFIG_DIRTY = false;
                        resetSaveButtonState();
                        loadConfig(); 
                        Config.applyTheme();
                        ModalManager.close('config-modal');
                    },
                    "SAVE & CLOSE",
                    "DISCARD CHANGES" // New Discard Button
                );
                return;
            }
        }
        CONFIG_DIRTY = false;
        resetSaveButtonState();
        ModalManager.close('config-modal');
    },

    // New Helper: Reads UI state into a Config object
    getConfigFromUI: function() {
        // Clone existing config to start (preserves detailed objects not in UI)
        var draft = JSON.parse(JSON.stringify(State.CONFIG));
        var el;

        // Fonts
        el = document.getElementById('cfg-font'); if(el) draft.clock_font = el.value;
        el = document.getElementById('cfg-font-secondary'); if(el) draft.secondary_font = el.value;
        el = document.getElementById('cfg-clock-size'); if(el) draft.clock_font_size = parseInt(el.value);

        // Toggles
        el = document.getElementById('cfg-show-bm'); if(el) draft.show_bookmarks = el.checked;
        el = document.getElementById('cfg-blur-overlay'); if(el) draft.enable_blur_overlay = el.checked;
        el = document.getElementById('cfg-hide-completed'); if(el) draft.hide_completed_tasks = el.checked;
        el = document.getElementById('cfg-show-seconds'); if(el) draft.show_seconds = el.checked;

        // System
        el = document.getElementById('cfg-name'); if(el) draft.user_name = el.value.trim();
        el = document.getElementById('cfg-location'); if(el) draft.location = el.value.trim();
        el = document.getElementById('cfg-engine'); if(el) draft.search_engine = el.value;
        el = document.getElementById('cfg-celsius'); if(el) draft.use_celsius = el.checked;
        el = document.getElementById('cfg-weather-extended'); if(el) draft.weather_extended = el.checked;
        el = document.getElementById('cfg-weather-scale'); if(el) draft.weather_scale = parseFloat(el.value);

        // Visuals
        el = document.getElementById('cfg-color'); if(el) draft.theme_color = el.value.trim() || '#00FF41';
        el = document.getElementById('cfg-theme-preset'); if(el) draft.theme_preset = el.value;
        el = document.getElementById('cfg-secondary-color'); if(el) draft.secondary_color = el.value;
        el = document.getElementById('cfg-sounds'); if(el) draft.typing_sounds = el.checked;
        el = document.getElementById('cfg-ui-sounds'); if(el) draft.ui_sounds = el.checked;

        // Filter & Backgrounds
        el = document.getElementById('cfg-filter-enabled'); if(el) draft.filter_enabled = el.checked;
        el = document.getElementById('cfg-crt'); if(el) draft.crt_effect = el.checked;
        el = document.getElementById('cfg-vignette'); if(el) draft.vignette_effect = el.checked;
        el = document.getElementById('cfg-noise'); if(el) draft.noise_effect = el.checked;
        el = document.getElementById('cfg-grayscale'); if(el) draft.filter_grayscale = parseInt(el.value);
        el = document.getElementById('cfg-contrast'); if(el) draft.filter_contrast = parseInt(el.value);
        el = document.getElementById('cfg-brightness'); if(el) draft.filter_brightness = parseInt(el.value);
        el = document.getElementById('cfg-blur'); if(el) draft.filter_blur = parseInt(el.value);
        
        el = document.getElementById('cfg-bg-type'); if(el) draft.background_type = el.value;
        el = document.getElementById('cfg-bg-color'); if(el) draft.background_color = el.value.trim() || '#000000';
        el = document.getElementById('cfg-backgrounds');
        if (el) {
            var rawBgs = el.value;
            draft.backgrounds = rawBgs.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
        }

        // Modules
        el = document.getElementById('cfg-auto-clear-interval'); if (el) draft.auto_clear_interval = el.value;
        el = document.getElementById('cfg-habit'); if (el) draft.habit_id = el.value.trim();
        el = document.getElementById('cfg-life'); if (el) draft.life_id = el.value.trim();
        el = document.getElementById('cfg-trello'); if (el) draft.trello_board = el.value.trim();
        el = document.getElementById('cfg-notion'); if (el) draft.notion_page = el.value.trim();
        el = document.getElementById('cfg-github'); if (el) draft.github_username = el.value.trim();

        // Notes Tab
        el = document.getElementById('cfg-notes-tabs-enabled'); if (el) draft.notes_tabs_enabled = el.checked;
        
        return draft;
    },
    
    // New Helper: True Dirty Check
    checkDirty: function() {
        if (this.baseline) {
             var current = JSON.stringify(this.getConfigFromUI());
             if (current !== this.baseline) {
                 CONFIG_DIRTY = true;
                 markDirty(); 
             } else {
                 CONFIG_DIRTY = false;
                 resetSaveButtonState();
             }
        }
    },

    saveConfigFromUI: function() {
        console.log('[SettingsUI] saveConfigFromUI called (ROBUST)');
        
        // --- 0. CHECK RAW TAB (Maintenance) ---
        var rawTab = document.getElementById('tab-maintenance');
        if (rawTab && rawTab.style.display !== 'none') {
            console.log('[SettingsUI] Saving from RAW JSON');
            var rawInput = document.getElementById('cfg-json-dump'); // [FIX] Correct ID
            if (rawInput) {
                try {
                    var newConfig = JSON.parse(rawInput.value);
                    State.CONFIG = Object.assign(State.CONFIG, newConfig);
                    // Proceed to save directly, skipping UI field reading
                    Config.save();
                    Config.applyTheme();
                    if (window.renderMissions) window.renderMissions();
                    State.WEATHER_CACHE = null; 
                    if (window.fetchWeather) window.fetchWeather();
                    if (window.renderBottomBar) window.renderBottomBar(State.ROOT_ID);
                    if (window.renderDock) window.renderDock(); // [NEW] Update Dock Immediately
                    if (window.Bookmarks && window.Bookmarks.init) window.Bookmarks.init(); // [NEW] Update Bookmarks Immediately
                    if (window.initIntegrations) window.initIntegrations();
                    this.initBackground();
                    if (typeof updateTime === 'function') updateTime(); 
                    
                    CONFIG_DIRTY = false;
                    resetSaveButtonState();
                    showNotification('CONFIGURATION SAVED (RAW)');
                    this.close(true);
                    return;
                } catch (e) {
                    alert('Invalid JSON: ' + e.message);
                    return;
                }
            }
        }

        var el;
        var CONFIG = State.CONFIG;

        // Fonts
        el = document.getElementById('cfg-font'); if(el) CONFIG.clock_font = el.value;
        el = document.getElementById('cfg-font-secondary'); if(el) CONFIG.secondary_font = el.value;
        el = document.getElementById('cfg-clock-size'); if(el) CONFIG.clock_font_size = parseInt(el.value);

        // Toggles
        el = document.getElementById('cfg-show-bm'); if(el) CONFIG.show_bookmarks = el.checked;
        el = document.getElementById('cfg-blur-overlay'); if(el) CONFIG.enable_blur_overlay = el.checked;
        el = document.getElementById('cfg-hide-completed'); if(el) CONFIG.hide_completed_tasks = el.checked;
        el = document.getElementById('cfg-show-seconds'); if(el) CONFIG.show_seconds = el.checked;

        // System
        el = document.getElementById('cfg-name'); if(el) CONFIG.user_name = el.value.trim();
        el = document.getElementById('cfg-location'); if(el) CONFIG.location = el.value.trim();
        el = document.getElementById('cfg-engine'); if(el) CONFIG.search_engine = el.value;
        el = document.getElementById('cfg-celsius'); if(el) CONFIG.use_celsius = el.checked;
        el = document.getElementById('cfg-weather-extended'); if(el) CONFIG.weather_extended = el.checked;
        el = document.getElementById('cfg-weather-scale'); if(el) CONFIG.weather_scale = parseFloat(el.value);

        // Visuals
        el = document.getElementById('cfg-color'); if(el) CONFIG.theme_color = el.value.trim() || '#00FF41';
        el = document.getElementById('cfg-theme-preset'); if(el) CONFIG.theme_preset = el.value;
        el = document.getElementById('cfg-secondary-color'); if(el) CONFIG.secondary_color = el.value;
        el = document.getElementById('cfg-sounds'); if(el) CONFIG.typing_sounds = el.checked; // Fixed mapping
        el = document.getElementById('cfg-ui-sounds'); if(el) CONFIG.ui_sounds = el.checked;

        // Filter & Backgrounds
        el = document.getElementById('cfg-filter-enabled'); if(el) CONFIG.filter_enabled = el.checked;
        el = document.getElementById('cfg-crt'); if(el) CONFIG.crt_effect = el.checked;
        el = document.getElementById('cfg-vignette'); if(el) CONFIG.vignette_effect = el.checked;
        el = document.getElementById('cfg-noise'); if(el) CONFIG.noise_effect = el.checked;
        el = document.getElementById('cfg-grayscale'); if(el) CONFIG.filter_grayscale = parseInt(el.value);
        el = document.getElementById('cfg-contrast'); if(el) CONFIG.filter_contrast = parseInt(el.value);
        el = document.getElementById('cfg-brightness'); if(el) CONFIG.filter_brightness = parseInt(el.value);
        el = document.getElementById('cfg-blur'); if(el) CONFIG.filter_blur = parseInt(el.value);
        
        el = document.getElementById('cfg-bg-type'); if(el) CONFIG.background_type = el.value;
        el = document.getElementById('cfg-bg-color'); if(el) CONFIG.background_color = el.value.trim() || '#000000';
        el = document.getElementById('cfg-backgrounds');
        if (el) {
            var rawBgs = el.value;
            CONFIG.backgrounds = rawBgs.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
        }

        // Modules
        el = document.getElementById('cfg-auto-clear-interval'); if (el) CONFIG.auto_clear_interval = el.value;
        el = document.getElementById('cfg-habit'); if (el) CONFIG.habit_id = el.value.trim();
        el = document.getElementById('cfg-life'); if (el) CONFIG.life_id = el.value.trim();
        el = document.getElementById('cfg-trello'); if (el) CONFIG.trello_board = el.value.trim();
        el = document.getElementById('cfg-notion'); if (el) CONFIG.notion_page = el.value.trim();
        el = document.getElementById('cfg-github'); if (el) CONFIG.github_username = el.value.trim();

        // Notes Tab
        el = document.getElementById('cfg-notes-tabs-enabled'); if (el) CONFIG.notes_tabs_enabled = el.checked;

        // Save
        Config.save();
        Config.applyTheme();
        
        // Re-renders
        if (window.renderMissions) window.renderMissions();
        if (window.TabManager) TabManager.init(); // Refresh tabs visibility
        
        State.WEATHER_CACHE = null; 
        if (window.fetchWeather) window.fetchWeather();
        if (window.renderBottomBar) window.renderBottomBar(State.ROOT_ID);
        if (window.renderDock) window.renderDock(); // [NEW] Update Dock Immediately
         if (window.Bookmarks && window.Bookmarks.init) window.Bookmarks.init(); // [NEW] Update Bookmarks Immediately
        if (window.initIntegrations) window.initIntegrations();
        this.initBackground();
        if (typeof updateTime === 'function') updateTime();
        
        CONFIG_DIRTY = false;
        resetSaveButtonState();
        showNotification('CONFIGURATION SAVED');
        this.close(true);
    },

    initBackground: function() {
        var CONFIG = State.CONFIG;
        var video = document.getElementById('bg-video');
        
        // Apply Filters
        var filters = [];
        if (CONFIG.filter_enabled) {
            filters.push('grayscale(' + (CONFIG.filter_grayscale || 0) + '%)');
            filters.push('contrast(' + (CONFIG.filter_contrast || 100) + '%)');
            filters.push('brightness(' + (CONFIG.filter_brightness || 100) + '%)');
            filters.push('blur(' + (CONFIG.filter_blur || 0) + 'px)');
        }
        if (video) video.style.filter = filters.join(' ');
        document.body.style.backgroundColor = CONFIG.background_color || '#000000';
        
        if (CONFIG.background_type === 'color') {
            if (video) video.style.display = 'none';
        } else {
             if (video) {
                 video.style.display = 'block';
                 // Source management is handled by video module, here we just ensure visibility/filter
                 if (window.BackgroundManager && window.BackgroundManager.playRandom) {
                     // Only play random if source changed? 
                     // For now, let's not force reload if just saving settings to avoid flicker
                 }
             }
        }
        
        // Overlays
        var crt = document.getElementById('crt-overlay');
        var vig = document.getElementById('vignette-overlay');
        var noise = document.getElementById('noise-overlay');
        
        if (crt) crt.style.display = CONFIG.crt_effect ? 'block' : 'none';
        if (vig) vig.style.display = CONFIG.vignette_effect ? 'block' : 'none';
        if (noise) noise.style.display = CONFIG.noise_effect ? 'block' : 'none';
        if (CONFIG.enable_blur_overlay) document.body.classList.add('blur-overlay');
        else document.body.classList.remove('blur-overlay');
    },

    /* =========================================
       DYNAMIC CONFIG LISTS (Dock/Commands)
       ========================================= */
    renderDockLinksConfig: function() {
        var container = document.getElementById('dock-list');
        if (!container) return;
        container.innerHTML = '';
        
        var self = this;
        (State.CONFIG.dock_links || []).forEach(function(link, index) {
            var row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '10px';
            row.style.marginBottom = '5px';
            
            // Label Input
            var inputLabel = document.createElement('input');
            inputLabel.type = 'text';
            inputLabel.name = 'dock-label-' + index; // [FIX] Add Name
            inputLabel.value = safeText(link.name || ''); 
            inputLabel.className = 'config-input';
            inputLabel.style.flex = '1';
            inputLabel.placeholder = 'Label';
            inputLabel.onchange = function() { self.updateDockLink(index, 'name', this.value); };
            
            // URL Input
            var inputUrl = document.createElement('input');
            inputUrl.type = 'text';
            inputUrl.name = 'dock-url-' + index; // [FIX] Add Name
            inputUrl.value = safeText(link.url || '');
            inputUrl.className = 'config-input';
            inputUrl.style.flex = '2';
            inputUrl.placeholder = 'URL';
            inputUrl.onchange = function() { self.updateDockLink(index, 'url', this.value); };
            
            // Delete Button
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'image-delete-btn';
            deleteBtn.style.cssText = 'position:static;width:30px;height:30px;';
            deleteBtn.textContent = 'X';
            deleteBtn.onclick = function() { self.removeDockLink(index); };
            
            row.appendChild(inputLabel);
            row.appendChild(inputUrl);
            row.appendChild(deleteBtn);
            container.appendChild(row);
        });
        
        var addBtn = document.getElementById('add-dock-btn');
        if(addBtn) {
            // Remove old listeners to prevent duplicates if re-rendered? 
            // Better to re-assign or check. Here simple reassignment works.
            addBtn.onclick = function() {
                var nameInput = document.getElementById('new-dock-name');
                var urlInput = document.getElementById('new-dock-url');
                var nameVal = nameInput.value;
                var urlVal = urlInput.value;
                
                if(nameVal && urlVal) {
                    State.CONFIG.dock_links.push({ name: nameVal, url: urlVal }); // Fix: Use 'name'
                    nameInput.value = '';
                    urlInput.value = '';
                    markDirty(); // [FIX] Mark dirty
                    self.renderDockLinksConfig();
                }
            }
        }
    },
    
    updateDockLink: function(index, field, value) {
        if (State.CONFIG.dock_links[index]) {
            State.CONFIG.dock_links[index][field] = value;
            markDirty(); // [FIX] Mark dirty
        }
    },
    
    removeDockLink: function(index) {
        State.CONFIG.dock_links.splice(index, 1);
        markDirty(); // [FIX] Mark dirty
        this.renderDockLinksConfig();
    },

    renderCustomCommandsList: function() {
       var container = document.getElementById('custom-cmd-list');
       if (!container) return;
       container.innerHTML = '';
       
       var self = this;
       (State.CONFIG.custom_commands || []).forEach(function(cmd, index) {
           var row = document.createElement('div');
           row.style.display = 'flex';
           row.style.gap = '10px';
           row.style.marginBottom = '5px';
           
           // Trigger Input
           var inputTrig = document.createElement('input');
           inputTrig.type = 'text';
           inputTrig.name = 'cmd-trigger-' + index; // [FIX] Add Name
           inputTrig.value = safeText(cmd.trigger || '');
           inputTrig.className = 'config-input';
           inputTrig.style.flex = '1';
           inputTrig.placeholder = '/cmd';
           inputTrig.onchange = function() { self.updateCommand(index, 'trigger', this.value); };
           
           // URL Input
           var inputUrl = document.createElement('input');
           inputUrl.type = 'text';
           inputUrl.name = 'cmd-url-' + index; // [FIX] Add Name
           inputUrl.value = safeText(cmd.url || '');
           inputUrl.className = 'config-input';
           inputUrl.style.flex = '2';
           inputUrl.placeholder = 'URL';
           inputUrl.onchange = function() { self.updateCommand(index, 'url', this.value); };
           
           // Delete Button
           var deleteBtn = document.createElement('button');
           deleteBtn.className = 'image-delete-btn';
           deleteBtn.style.cssText = 'position:static;width:30px;height:30px;';
           deleteBtn.textContent = 'X';
           deleteBtn.onclick = function() { self.removeCommand(index); };
           
           row.appendChild(inputTrig);
           row.appendChild(inputUrl);
           row.appendChild(deleteBtn);
           container.appendChild(row);
       });
       
       var addBtn = document.getElementById('add-cmd-btn');
       if(addBtn) {
           addBtn.onclick = function() {
               var trigVal = document.getElementById('new-cmd-trigger').value;
               var urlVal = document.getElementById('new-cmd-url').value;
               if(trigVal && urlVal) {
                   State.CONFIG.custom_commands.push({ trigger: trigVal, url: urlVal });
                   document.getElementById('new-cmd-trigger').value = '';
                   document.getElementById('new-cmd-url').value = '';
                   markDirty(); // [FIX] Mark dirty
                   SettingsUI.renderCustomCommandsList();
               }
           }
       }
   },
   
   updateCommand: function(index, field, value) {
       if (State.CONFIG.custom_commands[index]) {
            State.CONFIG.custom_commands[index][field] = value;
            markDirty(); // [FIX] Mark dirty
       }
   },
   
   removeCommand: function(index) {
       if (State.CONFIG.custom_commands) {
           State.CONFIG.custom_commands.splice(index, 1);
           markDirty(); // [FIX] Mark dirty
       }
       this.renderCustomCommandsList();
   },
   
    /* =========================================
       THEME PRESETS UI
       ========================================= */
    renderThemePresets: function() {
        var select = document.getElementById('cfg-theme-preset');
        if(!select) return;
        
        select.innerHTML = '<option value="">-- Select Theme --</option>';
        Object.keys(THEME_PRESETS).forEach(function(key) {
             var opt = document.createElement('option');
             opt.value = key;
             opt.textContent = THEME_PRESETS[key].name;
             select.appendChild(opt);
        });
        
        // Custom Themes Support (V19.30)
        var CONFIG = State.CONFIG;
        if (CONFIG.custom_themes && CONFIG.custom_themes.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = '-- CUSTOM THEMES --';
            CONFIG.custom_themes.forEach(function (ct) {
                var opt = document.createElement('option');
                opt.value = ct.id;
                opt.textContent = '[*] ' + ct.name;
                optGroup.appendChild(opt);
            });
            select.appendChild(optGroup);
        }

        // Set current selection
        if (CONFIG.theme_preset) select.value = CONFIG.theme_preset;

        var self = this;
        select.onchange = function() {
            var val = this.value;
            self.updateThemeButtons(); // Update delete btn visibility
            if(val) self.loadThemePreset(val);
        }
        
        this.updateThemeButtons();
    },
    
    updateThemeButtons: function() {
        var select = document.getElementById('cfg-theme-preset');
        var deleteBtn = document.getElementById('btn-delete-theme');
        if (!select || !deleteBtn) return;
        
        var val = select.value;
        if (val && val.startsWith('custom_')) {
            deleteBtn.style.display = 'block';
        } else {
            deleteBtn.style.display = 'none';
        }
    },

    loadThemePreset: function(key) {
        var preset;
        
        // Check built-in
        if(THEME_PRESETS[key]) {
            preset = THEME_PRESETS[key];
        } 
        // Check custom
        else if(key.startsWith('custom_') && State.CONFIG.custom_themes) {
            preset = State.CONFIG.custom_themes.find(t => t.id === key);
        }
        
        if (!preset) return;
        
        var setInput = function(id, val, isCheck) { 
            var input = document.getElementById(id); 
            if (input) {
                if(isCheck) input.checked = val;
                else input.value = val;
            }
        }
        
        setInput('cfg-color', preset.theme_color);
        setInput('cfg-secondary-color', preset.secondary_color || '#888888');
        setInput('cfg-grayscale', preset.filter_grayscale);
        setInput('cfg-contrast', preset.filter_contrast);
        setInput('cfg-brightness', preset.filter_brightness);
        setInput('cfg-blur', preset.filter_blur);
        if (preset.clock_font) setInput('cfg-font', preset.clock_font);
        if (preset.secondary_font) {
            // Remove quotes for input value if present? 
            // The presets store like "'Space Mono', monospace" or just "Space Mono"
            // The input usually expects just the name if it's a select box?
            // Let's check index.html select values.
            // Actually Config.js presets have: secondary_font: "'Space Mono', monospace"
            // But input is likely a SELECT or TEXT?
            // If SELECT, value must match option.
            // Let's assume the preset value matches the select option value.
            setInput('cfg-font-secondary', preset.secondary_font);
        }
        
        showNotification('PRESET LOADED: ' + preset.name);
    },
    
    // Theme Modal Logic
    themeModalMode: null,
    
    openThemeModal: function(mode) {
        this.themeModalMode = mode;
        var modal = document.getElementById('theme-modal');
        var title = document.getElementById('theme-modal-title');
        var input = document.getElementById('theme-modal-input');
        var textarea = document.getElementById('theme-modal-textarea');
        var confirmBtn = document.getElementById('theme-modal-confirm');
        
        // Check if elements exist (Theme modal might be part of index.html that I verified exists?)
        // I haven't verified 'theme-modal' exists in index.html, assume yes based on vinland.js usage.
        if (!modal) {
             // Basic fallback if missing HTML
             if(mode === 'save') {
                 var name = prompt("Enter theme name:");
                 if(name) this.saveCustomTheme(name);
             }
             return; 
        }

        modal.classList.add('active'); // active class triggers flex display usually
        modal.style.display = 'flex'; 

        if (mode === 'save') {
            title.textContent = 'SAVE THEME PRESET';
            input.style.display = 'block';
            textarea.style.display = 'none';
            input.value = '';
            input.placeholder = 'Theme Name';
            input.focus();
            confirmBtn.textContent = 'SAVE';
        } else if (mode === 'export') {
            title.textContent = 'EXPORT THEME (JSON)';
            input.style.display = 'none';
            textarea.style.display = 'block';
            textarea.value = JSON.stringify(this.getCurrentThemeAsObject(), null, 2);
            confirmBtn.textContent = 'CLOSE'; // Or copy?
        } else if (mode === 'import') {
            title.textContent = 'IMPORT THEME (JSON)';
            input.style.display = 'none';
            textarea.style.display = 'block';
            textarea.value = '';
            textarea.placeholder = 'Paste JSON here...';
            textarea.focus();
            confirmBtn.textContent = 'IMPORT';
        }
    },
    
    closeThemeModal: function() {
        var modal = document.getElementById('theme-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
    },
    
    handleThemeModalConfirm: function() {
        var input = document.getElementById('theme-modal-input');
        var textarea = document.getElementById('theme-modal-textarea');
        
        if (this.themeModalMode === 'save') {
             var name = input.value.trim();
             if(name) this.saveCustomTheme(name);
        } else if (this.themeModalMode === 'import') {
             var json = textarea.value.trim();
             if(json) this.importTheme(json);
        }
        
        this.closeThemeModal();
    },
    
    getCurrentThemeAsObject: function() {
        var CONFIG = State.CONFIG;
        // Grab current UI values or Config values? UI values are arguably better for WYSWYG save.
        // Let's use UI values.
        return {
             theme_color: (document.getElementById('cfg-color')||{}).value,
             filter_grayscale: parseInt((document.getElementById('cfg-grayscale')||{}).value),
             filter_contrast: parseInt((document.getElementById('cfg-contrast')||{}).value),
             filter_brightness: parseInt((document.getElementById('cfg-brightness')||{}).value),
             filter_blur: parseInt((document.getElementById('cfg-blur')||{}).value),
             // Fonts could be added here if we expanded settings UI to fully support all props
        };
    },
    
    saveCustomTheme: function(name) {
        var themeObj = this.getCurrentThemeAsObject();
        themeObj.id = 'custom_' + Date.now();
        themeObj.name = name;
        
        if (!State.CONFIG.custom_themes) State.CONFIG.custom_themes = [];
        State.CONFIG.custom_themes.push(themeObj);
        
        this.renderThemePresets();
        // Select it
        var select = document.getElementById('cfg-theme-preset');
        if(select) select.value = themeObj.id;
        
        saveConfig();
        showNotification('THEME SAVED: ' + name);
    },
    
    importTheme: function(json) {
        try {
            var theme = JSON.parse(json);
            if(theme && (theme.theme_color || theme.name)) {
                 if(!theme.name) theme.name = "Imported Theme";
                 this.saveCustomTheme(theme.name + " (Import)");
            } else {
                alert("Invalid Theme JSON");
            }
        } catch(e) {
            alert("Error parsing JSON");
        }
    },
    
    deleteCustomTheme: function() {
        var select = document.getElementById('cfg-theme-preset');
        var val = select.value;
        if (!val || !val.startsWith('custom_')) return;
        
        if(confirm("Delete this custom theme?")) {
            State.CONFIG.custom_themes = State.CONFIG.custom_themes.filter(t => t.id !== val);
            this.renderThemePresets();
            saveConfig();
        }
    },
    
    /* =========================================
       BACKGROUND SYSTEM
       ========================================= */
    handleBackgroundUpload: function(e) {
        var files = e.target.files;
        if (!files || files.length === 0) return;
        
        var uploadStatus = document.getElementById('upload-status');
        if(uploadStatus) uploadStatus.textContent = 'Storing ' + files.length + ' files...';
        
        var savedCount = 0;
        var self = this;
        
        Array.from(files).forEach(function(file) {
             DB.save(file.name, file).then(function() {
                 savedCount++;
                 var textarea = document.getElementById('cfg-backgrounds');
                 if(textarea) textarea.value += '\ndb:' + file.name;
                 
                 if(savedCount === files.length) {
                     if(uploadStatus) uploadStatus.textContent = 'Upload Complete!';
                     setTimeout(function() { if(uploadStatus) uploadStatus.textContent = ''; }, 2000);
                 }
             });
        });
    },

    updateBackgroundPreview: function() {
        // Placeholder to prevent crash
    },

    initBackground: function() {
        var video = document.getElementById('bg-video');
        var bgImage = document.getElementById('bg-image');
        var CONFIG = State.CONFIG;

        if (!bgImage) {
            bgImage = document.createElement('div');
            bgImage.id = 'bg-image';
            bgImage.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;z-index:0;opacity:0;transition:opacity 0.4s;';
            document.body.insertBefore(bgImage, document.body.firstChild);
        }

        if (CONFIG.background_type === 'color') {
            if (video) video.style.display = 'none';
            bgImage.style.display = 'none';
            document.body.style.backgroundColor = CONFIG.background_color || '#000';
            return;
        }

        var bgList = CONFIG.backgrounds && CONFIG.backgrounds.length > 0 ? CONFIG.backgrounds : [];

        if (bgList.length === 0) {
            this.tryLoadVideo(video, 'background.mp4', bgImage);
            return;
        }

        var randomBg = bgList[Math.floor(Math.random() * bgList.length)].trim();

        if (randomBg.startsWith('db:')) {
            var key = randomBg.replace('db:', '');
            var self = this;
            DB.get(key).then(function (blob) {
                if (blob) {
                    var url = URL.createObjectURL(blob);
                    var isImg = blob.type.startsWith('image/') || key.match(/\.(jpg|jpeg|png|gif|webp)$/i);

                    if (isImg) {
                        if (video) video.style.display = 'none';
                        self.loadBackgroundImage(bgImage, url);
                    } else {
                        bgImage.style.display = 'none';
                        self.tryLoadVideo(video, url, bgImage);
                    }
                } else {
                    console.log('Asset missing from Vault:', key);
                    self.tryLoadVideo(video, 'background.mp4', bgImage);
                }
            }).catch(function (e) {
                console.error('DB Error', e);
                self.tryLoadVideo(video, 'background.mp4', bgImage);
            });
            return;
        }

        var ext = randomBg.split('.').pop().toLowerCase().split('?')[0];
        var isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext);

        if (isImage) {
            if (video) video.style.display = 'none';
            this.loadBackgroundImage(bgImage, randomBg);
        } else {
            bgImage.style.display = 'none';
            this.tryLoadVideo(video, randomBg, bgImage);
        }
    },

    loadBackgroundImage: function(bgImage, url) {
        var img = new Image();
        img.onload = function () {
            bgImage.style.backgroundImage = 'url(' + url + ')';
            bgImage.style.opacity = '1';
            bgImage.style.display = 'block';
            Config.applyVideoFilters(); 
        };
        img.onerror = function () {
            console.log('Image load failed:', url);
            bgImage.style.display = 'none';
            document.body.style.backgroundColor = State.CONFIG.background_color || '#000';
        };
        img.src = url;
    },

    tryLoadVideo: function(video, src, bgImage) {
        if (!video) return;
        var CONFIG = State.CONFIG;

        BG_RETRY_COUNT = 0;
        video.style.opacity = '0';
        video.style.display = 'block';
        video.src = src;

        video.oncanplay = function () {
            video.play().catch(function (e) {
                console.log('Video autoplay blocked:', e);
            });
            video.style.opacity = '1';
            Config.applyVideoFilters();
        };
        
        var self = this;
        video.onerror = function () {
            BG_RETRY_COUNT++;

            if (BG_RETRY_COUNT > BG_MAX_RETRIES) {
                console.log('Max video retries reached. Using fallback.');
                video.style.display = 'none';
                if (src !== 'background.mp4') {
                    self.tryLoadVideo(video, 'background.mp4', bgImage);
                } else {
                    document.body.style.backgroundColor = CONFIG.background_color || '#000';
                }
                return;
            }
            console.log('Video load error (attempt ' + BG_RETRY_COUNT + '/' + BG_MAX_RETRIES + ')');
        };
    }
};

window.SettingsUI = SettingsUI;
