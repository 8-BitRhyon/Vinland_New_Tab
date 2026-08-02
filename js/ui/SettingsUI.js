import { State } from '../core/Store.js';
import { Config, saveConfig, loadConfig, THEME_PRESETS } from '../core/Config.js';
import { ModalManager } from './ModalManager.js';
import { DB, VinlandDB, saveData, clearAllNotes } from '../core/Storage.js';
import { safeText, validateURL } from '../core/Utils.js';
import { Audio, playNotificationSound } from '../core/Audio.js';
import { TabManager } from './TabManager.js';

var isConfigLoading = false;
var BG_RETRY_COUNT = 0;
var BG_MAX_RETRIES = 3;
var CONFIG_DIRTY = false;

// Global showNotification placeholder (improved with type-based styling)
function showNotification(msg, type) {
    if (typeof Audio !== 'undefined' && Audio.playNotificationSound) Audio.playNotificationSound();
    
    var existing = document.getElementById('notif-toast');
    if (existing) existing.remove();

    var borderColor, textColor, icon;
    switch (type) {
        case 'error':
            borderColor = 'var(--danger-color, #ff0055)';
            textColor = 'var(--danger-color, #ff0055)';
            icon = '\u2716 ';
            break;
        case 'success':
            borderColor = 'var(--callout-success, #00ff41)';
            textColor = 'var(--callout-success, #00ff41)';
            icon = '\u2714 ';
            break;
        case 'warning':
            borderColor = 'var(--callout-warning, #ffb800)';
            textColor = 'var(--callout-warning, #ffb800)';
            icon = '\u26A0 ';
            break;
        default:
            borderColor = 'var(--main-color, #00ff41)';
            textColor = 'var(--main-color, #00ff41)';
            icon = '';
    }

    var toast = document.createElement('div');
    toast.id = 'notif-toast';
    toast.textContent = icon + msg;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:var(--bg-overlay); border:1px solid ' + borderColor + '; color:' + textColor + '; padding:15px 30px; font-family:"Space Mono", monospace; font-size:14px; z-index:30000; box-shadow:0 0 20px rgba(0,0,0,0.5), 0 0 8px ' + borderColor + '; opacity:0; transition:opacity 0.3s; pointer-events:none; backdrop-filter:blur(5px);';

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        toast.style.opacity = '1';
    });

    var duration = type === 'error' ? 4000 : 3000;
    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 300);
    }, duration);
}
window.showNotification = showNotification;

function setUnsavedDots(visible) {
    document.querySelectorAll('.config-nav-dot').forEach(function(dot) {
        dot.classList.toggle('visible', visible);
    });
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
    setUnsavedDots(false);
}

function markDirty() {
    if (isConfigLoading) return;
    CONFIG_DIRTY = true;
    var headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) {
        headerSaveBtn.innerText = 'SAVE *';
        headerSaveBtn.style.background = 'var(--main-color)'; 
        headerSaveBtn.style.color = '#000';
        headerSaveBtn.style.boxShadow = '0 0 15px var(--main-color)';
        headerSaveBtn.style.textShadow = 'none';
        headerSaveBtn.style.border = '1px solid var(--main-color)'; 
    }
    setUnsavedDots(true);
}

export const SettingsUI = {
    applyTheme: function() { 
        Config.applyTheme(); 
        if (this.updateDynamicIcon && State.CONFIG) {
            this.updateDynamicIcon(State.CONFIG.theme_color || '#00FF41');
        }
    },
    
    updateDynamicIcon: function(color) {
        var link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.type = 'image/svg+xml';
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
        }
        
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
                  '<rect width="32" height="32" rx="6" fill="' + color + '"/>' +
                  '<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" ' +
                  'fill="black" font-family="monospace" font-weight="bold" font-size="20">V</text>' +
                  '</svg>';
                  
        link.href = 'data:image/svg+xml;base64,' + btoa(svg);
    },
    init: function() {
        // Expose for ModalManager (avoid circular import)
        window.closeSettingsModal = this.close.bind(this);

        // Tab Navigation Binding
        var navItems = document.querySelectorAll('.config-nav-item');
        var self = this;
        navItems.forEach(function(item) {
            item.onclick = function() {
                navItems.forEach(n => n.classList.remove('active'));
                this.classList.add('active');
                
                var tab = this.getAttribute('data-tab');
                document.querySelectorAll('.config-tab').forEach(t => t.style.display = 'none');

                var target = document.getElementById('tab-' + tab);
                if (target) target.style.display = 'block';

                // Populate Raw Config (It's in the maintenance tab)
                if (tab === 'maintenance') {
                     var rawArea = document.getElementById('cfg-json-dump'); 
                     if (rawArea) rawArea.value = JSON.stringify(State.CONFIG, null, 4);
                }

                // Update tab badges when switching to a tab
                self.updateNavBadges();
            };
        });
        
        // Background upload and URL binding
        var uploadBtn = document.getElementById('upload-bg-btn');
        var fileInput = document.getElementById('bg-file-input');
        if (uploadBtn && fileInput) {
            uploadBtn.onclick = function() { fileInput.click(); };
            fileInput.onchange = this.handleBackgroundUpload.bind(this);
        }

        var addUrlBtn = document.getElementById('bg-add-url-btn');
        var addUrlInput = document.getElementById('bg-add-url');
        if (addUrlBtn && addUrlInput) {
            addUrlBtn.onclick = function() {
                var val = addUrlInput.value.trim();
                if (!val) return;
                var ta = document.getElementById('cfg-backgrounds');
                if (ta) {
                    ta.value += (ta.value ? '\n' : '') + val;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                }
                addUrlInput.value = '';
                if (window.SettingsUI) window.SettingsUI.renderBgThumbnails();
            };
            addUrlInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') addUrlBtn.click();
            });
        }

        this.bindBackupButtons();

        // Bind sync tab buttons
        this.bindSyncButtons();

        // Bind graph layout buttons in Settings
        // Note: GraphManager.pinAllNodes/unpinAllNodes/resetLayout already call
        // showNotification internally, so we don't duplicate notifications here.
        var graphPinBtn = document.getElementById('settings-graph-pin-btn');
        if (graphPinBtn) {
            graphPinBtn.onclick = function() {
                if (window.GraphManager && window.GraphManager.pinAllNodes) {
                    window.GraphManager.pinAllNodes();
                }
            };
        }
        var graphUnpinBtn = document.getElementById('settings-graph-unpin-btn');
        if (graphUnpinBtn) {
            graphUnpinBtn.onclick = function() {
                if (window.GraphManager && window.GraphManager.unpinAllNodes) {
                    window.GraphManager.unpinAllNodes();
                }
            };
        }
        var graphResetBtn = document.getElementById('settings-graph-reset-btn');
        if (graphResetBtn) {
            graphResetBtn.onclick = function() {
                if (window.GraphManager && window.GraphManager.resetLayout) {
                    window.GraphManager.resetLayout();
                }
            };
        }

        var self = this;
        var btnSaveTheme = document.getElementById('btn-save-theme');
        if(btnSaveTheme) btnSaveTheme.onclick = function() { self.openThemeModal('save'); };
        
        var btnExportTheme = document.getElementById('btn-export-theme');
        if(btnExportTheme) btnExportTheme.onclick = function() { self.openThemeModal('export'); };
        
        var btnImportTheme = document.getElementById('btn-import-theme');
        if(btnImportTheme) btnImportTheme.onclick = function() { self.openThemeModal('import'); };
        
        var btnDeleteTheme = document.getElementById('btn-delete-theme');
        if(btnDeleteTheme) btnDeleteTheme.onclick = function() { self.deleteCustomTheme(); };

        // Theme modal bindings
        var themeCancel = document.getElementById('theme-modal-cancel');
        if(themeCancel) themeCancel.onclick = this.closeThemeModal.bind(this);
        
        var themeClose = document.getElementById('theme-modal-close');
        if(themeClose) themeClose.onclick = this.closeThemeModal.bind(this);
        
        var themeConfirm = document.getElementById('theme-modal-confirm');
        if(themeConfirm) themeConfirm.onclick = this.handleThemeModalConfirm.bind(this);
        
        // Bind all config inputs to checkDirty
        var checkDirtyHandler = function(e) {
             if (ModalManager.stack.includes('config-modal')) {
                 if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                     // Debounce slightly to ensure value is propogated
                     setTimeout(function() { 
                        if (window.SettingsUI && window.SettingsUI.checkDirty) {
                            window.SettingsUI.checkDirty();
                        } else {
                            markDirty();
                        }
                     }, 10);
                 }
             }
        };
        document.addEventListener('input', checkDirtyHandler);
        document.addEventListener('change', checkDirtyHandler);
        
        // Bind settings search filter
        this.bindSearchFilter();

        // Keyboard shortcuts (capture-phase: fires before Input.js capture handlers
        // because SettingsUI.init() is called before initKeyboardShortcuts() in boot.js)
        document.addEventListener('keydown', function(e) {
            // Only active if config modal is showing
            var configModal = document.getElementById('config-modal');
            var isOpen = ModalManager.stack.includes('config-modal') || (configModal && configModal.classList.contains('active'));
            if (!isOpen) return;

            // Determine if EventTarget is an input field — shortcuts that are safe to use
            // while typing will check this individually instead of returning early.
            var isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

            // Escape: if search input is focused and has text, clear it first.
            // Otherwise, ModalManager's global Escape handler closes the modal.
            if (e.key === 'Escape') {
                var searchInput = document.getElementById('config-search-input');
                if (searchInput && document.activeElement === searchInput && searchInput.value.trim().length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Trigger clear button click to reset the filter
                    var clearBtn = document.getElementById('config-search-clear');
                    if (clearBtn) clearBtn.click();
                    return;
                }
            }

            // Cmd/Ctrl + W: close settings (works even when focused on an input)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
                e.preventDefault();
                e.stopPropagation();
                if (self.close) self.close();
                return;
            }

            // Cmd/Ctrl + S: save config (allowed even when focused on an input)
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                e.stopPropagation();
                if (CONFIG_DIRTY) {
                    if (self.saveConfigFromUI) {
                        self.saveConfigFromUI();
                    }
                } else {
                    showNotification('NO CHANGES TO SAVE');
                }
                return;
            }

            // Cmd/Ctrl + 1-6: switch to tab by index (allowed even when focused on an input)
            if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '6') {
                e.preventDefault();
                e.stopPropagation();
                var idx = parseInt(e.key) - 1;
                var navItems = Array.from(document.querySelectorAll('.config-nav-item'));
                if (idx >= 0 && idx < navItems.length) {
                    navItems[idx].click();
                }
                return;
            }

            // Cmd/Ctrl + F: focus search input (allowed even when focused on an input)
            if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                e.stopPropagation();
                var searchInput = document.getElementById('config-search-input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
                return;
            }

            // Remaining shortcuts require NOT being in an input field
            if (isInput) return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                var navItems = Array.from(document.querySelectorAll('.config-nav-item'));
                var activeIndex = navItems.findIndex(n => n.classList.contains('active'));
                
                if (activeIndex === -1 && navItems.length > 0) activeIndex = 0;
                
                if (e.key === 'ArrowDown') {
                    var nextIndex = (activeIndex + 1) % navItems.length;
                    navItems[nextIndex].click();
                } else if (e.key === 'ArrowUp') {
                    var prevIndex = (activeIndex - 1 + navItems.length) % navItems.length;
                    navItems[prevIndex].click();
                }
            }
        }, true);
    },

    toggleConfig: function() {
        console.log('[SettingsUI] toggleConfig called');
        var modal = document.getElementById('config-modal');
        var helpModal = document.getElementById('help-modal');
        if (ModalManager.stack.includes('config-modal') || (modal && modal.classList.contains('active'))) {
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
        
        if (ModalManager.stack.includes('help-modal') || modal.classList.contains('active')) {
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
    
    // Theme modal logic
    themeModalMode: null,
    
    openThemeModal: function(mode) {
        this.themeModalMode = mode;
        var modal = document.getElementById('theme-modal');
        var title = document.getElementById('theme-modal-title');
        var input = document.getElementById('theme-modal-input');
        var textarea = document.getElementById('theme-modal-textarea');
        var confirmBtn = document.getElementById('theme-modal-confirm');
        
        if (!modal) {
             if(mode === 'save') {
                 var name = prompt("Enter theme name:");
                 if(name) this.saveCustomTheme(name);
             }
             return; 
        }

        // Open via ModalManager
        ModalManager.open('theme-modal');

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
            confirmBtn.textContent = 'CLOSE'; 
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
        ModalManager.close('theme-modal');
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
        this.renderBgThumbnails();
        this.updateBackgroundPreview();

        // Sync tab
        this.loadSyncTab();

        // Update nav badges
        this.updateNavBadges();

        // Raw
        var rawInput = document.getElementById('cfg-json-dump');
        if (rawInput) rawInput.value = JSON.stringify(CONFIG, null, 4);
        
        document.querySelectorAll('.config-tab').forEach(t => t.style.display = 'none');
        var defaultTabContent = document.getElementById('tab-interface');
        if(defaultTabContent) defaultTabContent.style.display = 'block';

        // Capture baseline state for dirty tracking
        if (this.getConfigFromUI) {
            this.baseline = JSON.stringify(this.getConfigFromUI());
        }

        isConfigLoading = false; // UNLOCK dirty tracker
        CONFIG_DIRTY = false;
        resetSaveButtonState();

        // Restore persisted search query
        var savedQuery = localStorage.getItem('vinland_settings_search');
        if (savedQuery) {
            var searchInput = document.getElementById('config-search-input');
            var clearBtn = document.getElementById('config-search-clear');
            if (searchInput) {
                searchInput.value = savedQuery;
                if (clearBtn) clearBtn.classList.toggle('visible', savedQuery.length > 0);
                this._applySearchFilter(savedQuery);
            }
        }
    },

    close: function(force) {
        if (!force && CONFIG_DIRTY) {
            if (window.showConfirmModal) {
                var self = this;
                window.showConfirmModal(
                    "UNSAVED CHANGES",
                    "You have unsaved changes.",
                    function() {
                        self.saveConfigFromUI();
                    },
                    function() {
                        CONFIG_DIRTY = false;
                        resetSaveButtonState();
                        loadConfig(); 
                        Config.applyTheme();
                        ModalManager.close('config-modal');
                    },
                    "SAVE & CLOSE",
                    "DISCARD CHANGES"
                );
                return;
            }
        }
        CONFIG_DIRTY = false;
        resetSaveButtonState();
        ModalManager.close('config-modal');
    },

    getConfigFromUI: function() {
        // Clone existing config to start (preserves detailed objects not in UI)
        var draft = JSON.parse(JSON.stringify(State.CONFIG));
        // Volatile sync bookkeeping must not trip dirty tracking — a backup or
        // Drive sync updating these while the modal is open is not a user edit.
        delete draft.last_backup_time;
        delete draft.drive_last_sync;
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
        el = document.getElementById('cfg-auto-backup'); if (el) draft.auto_backup_interval = parseInt(el.value, 10) || 0;
        el = document.getElementById('cfg-habit'); if (el) draft.habit_id = el.value.trim();
        el = document.getElementById('cfg-life'); if (el) draft.life_id = el.value.trim();
        el = document.getElementById('cfg-trello'); if (el) draft.trello_board = el.value.trim();
        el = document.getElementById('cfg-notion'); if (el) draft.notion_page = el.value.trim();
        el = document.getElementById('cfg-github'); if (el) draft.github_username = el.value.trim();

        // Notes Tab
        el = document.getElementById('cfg-notes-tabs-enabled'); if (el) draft.notes_tabs_enabled = el.checked;
        
        return draft;
    },
    
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
            var rawInput = document.getElementById('cfg-json-dump');
            if (rawInput) {
                // Confirm before applying raw JSON (destructive operation)
                if (!confirm('Apply raw JSON config? This will overwrite ALL settings.')) {
                    return;
                }
                try {
                    var newConfig = JSON.parse(rawInput.value);
                    State.CONFIG = Object.assign(State.CONFIG, newConfig);
                    // Proceed to save directly, skipping UI field reading
                    Config.save();
                    // Raw JSON may include auto_backup_interval — keep the timer in sync
                    if (window.BackupManager) window.BackupManager.scheduleAutoBackup();
                    Config.applyTheme();
                    if (window.renderMissions) window.renderMissions();
                    State.WEATHER_CACHE = null; 
                    if (window.fetchWeather) window.fetchWeather();
                    if (window.renderBottomBar) window.renderBottomBar(State.ROOT_ID);
                    if (window.renderDock) window.renderDock();
                    if (window.Bookmarks && window.Bookmarks.init) window.Bookmarks.init();
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
        el = document.getElementById('cfg-sounds'); if(el) CONFIG.typing_sounds = el.checked;
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
        el = document.getElementById('cfg-auto-backup'); if (el) CONFIG.auto_backup_interval = parseInt(el.value, 10) || 0;
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
        
        // Post-save re-renders
        if (window.renderMissions) window.renderMissions();
        if (window.TabManager) TabManager.init();
        // Reschedule the auto-backup timer with the newly saved interval
        if (window.BackupManager) window.BackupManager.scheduleAutoBackup();
        
        State.WEATHER_CACHE = null; 
        if (window.fetchWeather) window.fetchWeather();
        if (window.renderBottomBar) window.renderBottomBar(State.ROOT_ID);
        if (window.renderDock) window.renderDock();
        if (window.Bookmarks && window.Bookmarks.init) window.Bookmarks.init();
        if (window.initIntegrations) window.initIntegrations();
        this.initBackground();
        if (typeof updateTime === 'function') updateTime();
        
        CONFIG_DIRTY = false;

        // Show a brief "SAVED ✓" flash on the save button before resetting
        var savedBtn = document.getElementById('header-save-btn');
        if (savedBtn) {
            savedBtn.innerText = 'SAVED \u2714';
            savedBtn.style.background = 'var(--callout-success, #00ff41)';
            savedBtn.style.color = '#000';
            savedBtn.style.boxShadow = '0 0 20px var(--callout-success, #00ff41)';
            savedBtn.style.border = '1px solid var(--callout-success, #00ff41)';
        }

        // Short delay so the user sees the confirmation before the modal closes
        var self = this;
        setTimeout(function () {
            resetSaveButtonState();
            showNotification('CONFIGURATION SAVED');
            self.close(true);
        }, 300);
    },

    initBackground: function() {
        var CONFIG = State.CONFIG;
        var video = document.getElementById('bg-video');
        
        // Filter and overlay setup
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
                 // Source management handled by video module; just ensure visibility
                 if (window.BackgroundManager && window.BackgroundManager.playRandom) {
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

    
    renderDockLinksConfig: function() {
        var container = document.getElementById('dock-list');
        if (!container) return;
        container.innerHTML = '';
        
        var self = this;
        var links = State.CONFIG.dock_links || [];
        
        if (links.length === 0) {
            container.innerHTML = '<div class="config-empty-state"><span class="empty-icon">🔗</span>No dock links yet. Add your first link above.</div>';
        }

        links.forEach(function(link, index) {
            var row = document.createElement('div');
            row.className = 'config-list-item'; // Reuse or new class
            // Inline styles for now to ensure look
            row.style.cssText = 'display:flex; gap:10px; margin-bottom:8px; align-items:center; background:rgba(255,255,255,0.03); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.05);';
            
            // Label Input
            var inputLabel = document.createElement('input');
            inputLabel.type = 'text';
            inputLabel.value = safeText(link.name || ''); 
            inputLabel.className = 'config-input';
            inputLabel.style.flex = '1';
            inputLabel.style.minWidth = '0';
            inputLabel.placeholder = 'Label';
            inputLabel.title = 'Link Label';
            inputLabel.onchange = function() { self.updateDockLink(index, 'name', this.value); };
            
            // URL Input
            var inputUrl = document.createElement('input');
            inputUrl.type = 'text';
            inputUrl.value = safeText(link.url || '');
            inputUrl.className = 'config-input';
            inputUrl.style.flex = '2';
            inputUrl.style.minWidth = '0';
            inputUrl.placeholder = 'URL';
            inputUrl.title = 'Link URL';
            inputUrl.onchange = function() { self.updateDockLink(index, 'url', this.value); };
            
            // Delete Button
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn danger-btn';
            deleteBtn.style.cssText = 'width:32px; height:32px; display:flex; align-items:center; justify-content:center; padding:0; background:rgba(255,50,50,0.2); color:#ff5555; border:1px solid rgba(255,50,50,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;';
            deleteBtn.innerHTML = '&#10005;';
            deleteBtn.title = 'Remove Link';
            deleteBtn.onclick = function() { self.removeDockLink(index); };
            deleteBtn.onmouseover = function() { this.style.background = 'rgba(255,50,50,0.4)'; };
            deleteBtn.onmouseout = function() { this.style.background = 'rgba(255,50,50,0.2)'; };
            
            row.appendChild(inputLabel);
            row.appendChild(inputUrl);
            row.appendChild(deleteBtn);
            container.appendChild(row);
        });
        
        var addBtn = document.getElementById('add-dock-btn');
        if(addBtn) {
            // Unbind old to be safe
            addBtn.onclick = function() {
                var nameInput = document.getElementById('new-dock-name');
                var urlInput = document.getElementById('new-dock-url');
                var nameVal = nameInput.value.trim();
                var urlVal = urlInput.value.trim();
                
                if(nameVal && urlVal) {
                    if(!State.CONFIG.dock_links) State.CONFIG.dock_links = [];
                    State.CONFIG.dock_links.push({ name: nameVal, url: urlVal });
                    nameInput.value = '';
                    urlInput.value = '';
                    markDirty();
                    self.renderDockLinksConfig();
                    nameInput.focus();
                } else {
                    alert('Please enter both a Label and URL.');
                }
            }
        }
    },
    
    updateDockLink: function(index, field, value) {
        if (State.CONFIG.dock_links[index]) {
            State.CONFIG.dock_links[index][field] = value;
            markDirty();
        }
    },
    
    removeDockLink: function(index) {
        var confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && confirmModal.classList.contains('active')) {
             if (window.ModalManager) ModalManager.close('confirm-modal');
             return;
        }

        var self = this;
        if (window.showConfirmModal) {
            window.showConfirmModal(
                'REMOVE DOCK LINK',
                'Are you sure you want to remove this link?',
                function() {
                    State.CONFIG.dock_links.splice(index, 1);
                    markDirty();
                    self.renderDockLinksConfig();
                }
            );
        } else if(confirm('Remove this dock link?')) {
            State.CONFIG.dock_links.splice(index, 1);
            markDirty();
            this.renderDockLinksConfig();
        }
    },

    renderCustomCommandsList: function() {
        var container = document.getElementById('custom-cmd-list');
        if (!container) return;
        container.innerHTML = '';
        
        var self = this;
        var cmds = State.CONFIG.custom_commands || [];
        
        if (cmds.length === 0) {
            container.innerHTML = '<div class="config-empty-state"><span class="empty-icon">⚡</span>No custom commands yet. Create your first command above.</div>';
        }

        cmds.forEach(function(cmd, index) {
            var row = document.createElement('div');
            // Re-use style from Dock Links for consistency
            row.style.cssText = 'display:flex; gap:10px; margin-bottom:8px; align-items:center; background:rgba(255,255,255,0.03); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.05);';
            
            // Trigger Input
            var inputTrig = document.createElement('input');
            inputTrig.type = 'text';
            inputTrig.value = safeText(cmd.trigger || '');
            inputTrig.className = 'config-input';
            inputTrig.style.flex = '1';
            inputTrig.style.minWidth = '0';
            inputTrig.placeholder = 'Trigger';
            inputTrig.title = 'Command Trigger';
            inputTrig.onchange = function() { self.updateCommand(index, 'trigger', this.value); };
            
            // URL Input
            var inputUrl = document.createElement('input');
            inputUrl.type = 'text';
            inputUrl.value = safeText(cmd.url || '');
            inputUrl.className = 'config-input';
            inputUrl.style.flex = '2';
            inputUrl.style.minWidth = '0';
            inputUrl.placeholder = 'URL';
            inputUrl.title = 'Command URL';
            inputUrl.onchange = function() { self.updateCommand(index, 'url', this.value); };
            
            // Delete button
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn danger-btn';
            deleteBtn.style.cssText = 'width:32px; height:32px; display:flex; align-items:center; justify-content:center; padding:0; background:rgba(255,50,50,0.2); color:#ff5555; border:1px solid rgba(255,50,50,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;';
            deleteBtn.innerHTML = '&#10005;';
            deleteBtn.title = 'Remove Command';
            deleteBtn.onclick = function() { self.removeCommand(index); };
            deleteBtn.onmouseover = function() { this.style.background = 'rgba(255,50,50,0.4)'; };
            deleteBtn.onmouseout = function() { this.style.background = 'rgba(255,50,50,0.2)'; };
            
            row.appendChild(inputTrig);
            row.appendChild(inputUrl);
            row.appendChild(deleteBtn);
            container.appendChild(row);
        });
        
        var addBtn = document.getElementById('add-cmd-btn');
        if(addBtn) {
            // Unbind old to be safe
            addBtn.onclick = function() {
                var trigInput = document.getElementById('new-cmd-trigger');
                var urlInput = document.getElementById('new-cmd-url');
                var trigVal = trigInput.value.trim();
                var urlVal = urlInput.value.trim();
                
                if(trigVal && urlVal) {
                    if(!State.CONFIG.custom_commands) State.CONFIG.custom_commands = [];
                    State.CONFIG.custom_commands.push({ trigger: trigVal, url: urlVal });
                    trigInput.value = '';
                    urlInput.value = '';
                    markDirty();
                    self.renderCustomCommandsList();
                    trigInput.focus();
                } else {
                    alert('Please enter both a Trigger and URL.');
                }
            }
        }
    },
    
    updateCommand: function(index, field, value) {
        if (State.CONFIG.custom_commands[index]) {
             State.CONFIG.custom_commands[index][field] = value;
             markDirty();
        }
    },
    
    removeCommand: function(index) {
        var confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && confirmModal.classList.contains('active')) {
             if (window.ModalManager) ModalManager.close('confirm-modal');
             return;
        }

        var self = this;
        if (window.showConfirmModal) {
            window.showConfirmModal(
                'REMOVE COMMAND',
                'Are you sure you want to remove this command?',
                function() {
                    State.CONFIG.custom_commands.splice(index, 1);
                    markDirty();
                    self.renderCustomCommandsList();
                }
            );
        } else if(confirm('Remove this command?')) {
            State.CONFIG.custom_commands.splice(index, 1);
            markDirty();
            this.renderCustomCommandsList();
        }
    },
   
    
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
            setInput('cfg-font-secondary', preset.secondary_font);
        }

        // apply preset tokens immediately (live preview) and write to CONFIG
        // so applyTheme picks up the full surface look.
        var CONFIG = State.CONFIG;
        CONFIG.theme_preset = key;
        ['theme_color','secondary_color','bg_color','danger_color','warning_color','board_color','dim_color'].forEach(function(k) {
            if (preset[k] !== undefined) CONFIG[k] = preset[k];
        });
        ['1','2','3','4','5'].forEach(function(i) {
            var k = 'graph_col_'+i;
            if (preset[k] !== undefined) CONFIG[k] = preset[k];
        });
        CONFIG.filter_grayscale = preset.filter_grayscale;
        CONFIG.filter_contrast = preset.filter_contrast;
        CONFIG.filter_brightness = preset.filter_brightness;
        CONFIG.filter_blur = preset.filter_blur;
        if (preset.clock_font) CONFIG.clock_font = preset.clock_font;
        if (preset.secondary_font) CONFIG.secondary_font = preset.secondary_font;
        // Overlay toggles (retrogreen enables crt; retroma disables all)
        if (preset.crt_effect !== undefined) CONFIG.crt_effect = preset.crt_effect;
        if (preset.vignette_effect !== undefined) CONFIG.vignette_effect = preset.vignette_effect;
        if (preset.noise_effect !== undefined) CONFIG.noise_effect = preset.noise_effect;
        Config.applyTheme();
    },
    
    themeModalMode: null,
    
    openThemeModal: function(mode) {
        this.themeModalMode = mode;
        var modal = document.getElementById('theme-modal');
        var title = document.getElementById('theme-modal-title');
        var input = document.getElementById('theme-modal-input');
        var textarea = document.getElementById('theme-modal-textarea');
        var confirmBtn = document.getElementById('theme-modal-confirm');
        
        if (!modal) {
             if(mode === 'save') {
                 var name = prompt("Enter theme name:");
                 if(name) this.saveCustomTheme(name);
             }
             return; 
        }

        // Use ModalManager
        ModalManager.open('theme-modal');

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
            confirmBtn.textContent = 'CLOSE'; 
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
        ModalManager.close('theme-modal');
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
        // Grab current UI values or Config values; UI values give WYSWYG save.
        return {
             theme_color: (document.getElementById('cfg-color')||{}).value,
             filter_grayscale: parseInt((document.getElementById('cfg-grayscale')||{}).value),
             filter_contrast: parseInt((document.getElementById('cfg-contrast')||{}).value),
             filter_brightness: parseInt((document.getElementById('cfg-brightness')||{}).value),
             filter_blur: parseInt((document.getElementById('cfg-blur')||{}).value),
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
                     if (window.SettingsUI) window.SettingsUI.renderBgThumbnails();
                 }
             });
        });
    },

    renderBgThumbnails: function() {
        var grid = document.getElementById('bg-thumbnails');
        var ta = document.getElementById('cfg-backgrounds');
        if (!grid || !ta) return;
        var urls = ta.value.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
        grid.innerHTML = '';

        urls.forEach(function(url, i) {
            var card = document.createElement('div');
            card.className = 'bg-thumb-card';
            card.title = url;

            var del = document.createElement('button');
            del.className = 'thumb-delete';
            del.textContent = '✕';
            del.title = 'Remove';
            del.setAttribute('aria-label', 'Remove background');
            del.addEventListener('click', function(e) {
                e.stopPropagation();
                var lines = ta.value.split('\n').map(function(s) { return s.trim(); });
                lines.splice(i, 1);
                ta.value = lines.join('\n');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.SettingsUI) window.SettingsUI.renderBgThumbnails();
            });
            card.appendChild(del);

            var label = document.createElement('div');
            label.className = 'thumb-label';
            var display = url.replace(/^db:/, '').replace(/^.*[/\\]/, '');
            label.textContent = display.length > 20 ? display.slice(0, 18) + '…' : display;
            card.appendChild(label);

            // Show preview: image or video
            var isVideo = /\.(mp4|webm|ogg)$/i.test(url);
            if (url.startsWith('db:')) {
                isVideo = /\.(mp4|webm|ogg)$/i.test(url.replace('db:', ''));
            }

            if (isVideo) {
                var vid = document.createElement('video');
                vid.muted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.preload = 'metadata';
                if (url.startsWith('db:')) {
                    var key = url.replace('db:', '');
                    DB.get(key).then(function(blob) {
                        if (blob) {
                            var objUrl = URL.createObjectURL(blob);
                            vid.src = objUrl;
                            vid.play().catch(function(){});
                        }
                    }).catch(function(err) {
                        console.error('renderBgThumbnails: failed to load', key, err);
                    });
                } else {
                    vid.src = url;
                    vid.play().catch(function(){});
                }
                card.appendChild(vid);
            } else {
                var img = document.createElement('img');
                img.loading = 'lazy';
                if (url.startsWith('db:')) {
                    var key = url.replace('db:', '');
                    DB.get(key).then(function(blob) {
                        if (blob) {
                            img.src = URL.createObjectURL(blob);
                        }
                    }).catch(function(err) {
                        console.error('renderBgThumbnails: failed to load', key, err);
                    });
                } else {
                    img.src = url;
                }
                img.addEventListener('error', function() {
                    img.style.display = 'none';
                    card.style.borderColor = '#ff4444';
                    label.textContent = '(failed) ' + label.textContent;
                });
                card.appendChild(img);
            }

            // Click to preview: apply this background immediately
            card.addEventListener('click', function() {
                var CONFIG = window.State ? window.State.CONFIG : null;
                if (!CONFIG) return;
                CONFIG.background_type = 'media';
                var bgSelect = document.getElementById('cfg-bg-type');
                if (bgSelect) bgSelect.value = 'media';

                // Set this as the only active background temporarily
                var prev = CONFIG.backgrounds;
                CONFIG.backgrounds = [url];
                if (window.SettingsUI && window.SettingsUI.initBackground) {
                    window.SettingsUI.initBackground();
                }
                CONFIG.backgrounds = prev;

                grid.querySelectorAll('.bg-thumb-card').forEach(function(c) { c.classList.remove('active'); });
                card.classList.add('active');
                setTimeout(function() { card.classList.remove('active'); }, 2000);
            });

            grid.appendChild(card);
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

        // No backgrounds configured — hide the custom background layers and let
        // the active theme's surface (CSS var --bg-color) show through. Do NOT
        // request the missing background.mp4 (that 404 fired on every boot) and
        // do NOT set an inline body color: an inline style would override the
        // theme's CSS variable and break light/paper themes like retroma
        // (regression caught by tests/ui-polish retroma test).
        if (bgList.length === 0) {
            if (video) video.style.display = 'none';
            bgImage.style.display = 'none';
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
    },

    

    exportAllData: function() {
        // Single canonical backup builder — same payload as BackupManager's
        // downloadBackup() (config/tasks/notes/boards/canvases/commands).
        var exportData = (window.BackupManager && window.BackupManager.buildBackupData)
            ? window.BackupManager.buildBackupData()
            : {
                config: State.CONFIG,
                tasks: State.TASKS,
                notes: State.NOTES,
                boards: State.BOARDS,
                canvases: State.CANVASES,
                commands: State.COMMAND_HISTORY
            };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var dlNode = document.createElement('a');
        dlNode.href = url;
        dlNode.download = 'operator_backup_' + new Date().toISOString().slice(0,10) + '.json';
        document.body.appendChild(dlNode);
        dlNode.click();
        document.body.removeChild(dlNode);
        URL.revokeObjectURL(url);
        showNotification('BACKUP EXPORTED SUCCESSFULLY');
    },

    triggerImport: function() {
        var fileInput = document.getElementById('import-file');
        if (fileInput) fileInput.click();
    },

    importDataFile: function(e) {
        var file = e.target.files[0];
        if (!file) return;
        
        var reader = new FileReader();
        reader.onload = function (evt) {
            try {
                var imported = JSON.parse(evt.target.result);
                
                // Validate structure roughly
                if (!imported.config && !imported.tasks && !imported.notes) {
                     throw new Error("Invalid Backup Format"); 
                }

                if (imported.config) { 
                    State.CONFIG = Object.assign(State.CONFIG || {}, imported.config); 
                    Config.save(); 
                }
                if (imported.tasks) State.TASKS = imported.tasks;
                if (imported.notes) State.NOTES = imported.notes;
                if (imported.boards) State.BOARDS = imported.boards;
                if (imported.canvases) State.CANVASES = imported.canvases;
                // Canonical key is 'commands'; accept legacy 'history' key too.
                var importedHistory = imported.commands || imported.history;
                if (importedHistory) State.COMMAND_HISTORY = importedHistory;
                
                // Save Everything
                saveData(); // Persist tasks/notes/history
                
                // Refresh UI
                Config.applyTheme();
                if (window.renderMissions) window.renderMissions();
                if (window.renderNotes) window.renderNotes(); // Quick Notes
                if (window.Notes && window.Notes.renderSidebar) window.Notes.renderSidebar();
                
                showNotification('DATA RESTORED SUCCESSFULLY // RELOAD RECOMMENDED');
                setTimeout(function() { location.reload(); }, 1500);

            } catch (err) {
                console.error(err);
                alert('CORRUPT DATA FILE OR INVALID FORMAT');
            }
        };
        reader.readAsText(file);
    },
    
    

    bindSearchFilter: function() {
        var searchInput = document.getElementById('config-search-input');
        var clearBtn = document.getElementById('config-search-clear');
        if (!searchInput) return;

        var self = this;
        var searchTimeout = null;

        function updateClearButton() {
            if (clearBtn) {
                clearBtn.classList.toggle('visible', searchInput.value.trim().length > 0);
            }
        }

        searchInput.addEventListener('input', function() {
            updateClearButton();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function() {
                self._applySearchFilter(searchInput.value.trim());
            }, 150);
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                searchInput.value = '';
                updateClearButton();
                localStorage.removeItem('vinland_settings_search');
                self._applySearchFilter('');
                searchInput.focus();
            });
        }
    },

    _applySearchFilter: function(query) {
        var self = this;
        localStorage.setItem('vinland_settings_search', query);
        var tabs = document.querySelectorAll('.config-tab');
        var navItems = document.querySelectorAll('.config-nav-item');
        var searchInput = document.getElementById('config-search-input');
        var noResults = document.getElementById('config-no-results');

        // Remove previous highlights before re-applying
        this._removeHighlights();

        var matchCount = document.getElementById('config-match-count');

        if (!query) {
            // Reset: restore nav, click active tab to refresh display
            navItems.forEach(function(n) { n.style.opacity = ''; });
            var activeNav = document.querySelector('.config-nav-item.active');
            if (activeNav) activeNav.click();
            if (noResults) noResults.style.display = 'none';
            searchInput.classList.remove('has-results');
            if (matchCount) matchCount.classList.remove('visible');
            // Hide all per-tab match counts
            document.querySelectorAll('.config-nav-match-count').forEach(function(b) { b.classList.remove('visible'); });
            return;
        }

        var q = query.toLowerCase();
        var firstMatch = null;
        var anyMatch = false;

        tabs.forEach(function(tab, index) {
            var text = tab.textContent.toLowerCase();
            var matches = text.indexOf(q) !== -1;

            // Also search in placeholders of inputs within this tab
            if (!matches) {
                var inputs = tab.querySelectorAll('input, textarea');
                inputs.forEach(function(inp) {
                    var ph = inp.getAttribute('placeholder');
                    if (ph && ph.toLowerCase().indexOf(q) !== -1) {
                        matches = true;
                    }
                });
            }

            // Also search option text in selects
            if (!matches) {
                var selects = tab.querySelectorAll('select option');
                selects.forEach(function(opt) {
                    if (opt.textContent.toLowerCase().indexOf(q) !== -1) {
                        matches = true;
                    }
                });
            }

            tab.style.display = matches ? 'block' : 'none';

            if (matches) {
                anyMatch = true;
                if (!firstMatch) firstMatch = index;
            }

            // Dim nav items for non-matching tabs
            if (navItems[index]) {
                navItems[index].style.opacity = matches ? '1' : '0.25';
            }
        });

        // Show first matching tab
        if (firstMatch !== null) {
            navItems[firstMatch].click();
        }

        // Show/hide no results message
        if (!anyMatch) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.id = 'config-no-results';
                noResults.className = 'config-empty-state';
                var firstTab = document.querySelector('.config-tab');
                if (firstTab && firstTab.parentNode) {
                    firstTab.parentNode.insertBefore(noResults, firstTab);
                }
            }
            if (noResults) {
                noResults.textContent = '';
                var icon = document.createElement('span');
                icon.className = 'empty-icon';
                icon.textContent = '🔍';
                noResults.appendChild(icon);
                noResults.appendChild(document.createTextNode('No settings match "' + query + '"'));
                noResults.style.display = 'block';
            }
            searchInput.classList.remove('has-results');
            if (matchCount) matchCount.classList.remove('visible');
            // Hide all per-tab match counts when no results
            document.querySelectorAll('.config-nav-match-count').forEach(function(b) { b.classList.remove('visible'); });
        } else {
            if (noResults) noResults.style.display = 'none';
            searchInput.classList.add('has-results');

            // Highlight matching text in visible tabs and nav items
            tabs.forEach(function(tab) {
                if (tab.style.display !== 'none') {
                    self._highlightText(tab, query);
                }
            });
            navItems.forEach(function(nav) {
                self._highlightText(nav, query);
            });

            // Update match count badge (only when there are matching tabs)
            if (matchCount) {
                var totalCount = document.querySelectorAll('.config-hl').length;
                if (totalCount > 0) {
                    matchCount.textContent = totalCount + ' match' + (totalCount !== 1 ? 'es' : '');
                    matchCount.classList.add('visible');
                    // Trigger pop animation
                    matchCount.classList.remove('pop');
                    void matchCount.offsetWidth;
                    matchCount.classList.add('pop');
                } else {
                    matchCount.classList.remove('visible');
                }
            }

            // Update per-tab match count badges in nav items
            if (!self._prevTabCounts) self._prevTabCounts = {};
            tabs.forEach(function(tab, index) {
                var navItem = navItems[index];
                if (!navItem) return;
                var badge = navItem.querySelector('.config-nav-match-count');
                if (!badge) return;
                if (tab.style.display !== 'none') {
                    var tabCount = tab.querySelectorAll('.config-hl').length;
                    if (tabCount > 0) {
                        badge.textContent = tabCount.toString();
                        badge.classList.add('visible');
                        // Trigger pop animation, or pop-up if count increased on active tab
                        var prevCount = self._prevTabCounts[index] || 0;
                        var increased = tabCount > prevCount;
                        var isActive = navItem.classList.contains('active');
                        badge.classList.remove('pop', 'pop-up');
                        void badge.offsetWidth;
                        badge.classList.add(increased && isActive ? 'pop-up' : 'pop');
                    } else {
                        badge.classList.remove('visible');
                    }
                    self._prevTabCounts[index] = tabCount;
                } else {
                    badge.classList.remove('visible');
                    self._prevTabCounts[index] = 0;
                }
            });
        }
    },

    _removeHighlights: function() {
        var marks = document.querySelectorAll('.config-hl');
        marks.forEach(function(mark) {
            var parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        });
    },

    _highlightText: function(element, query) {
        if (!element || !query) return;
        var q = query.toLowerCase();
        var textNodes = [];

        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                var parent = node.parentNode;
                if (parent && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP'].indexOf(parent.tagName) !== -1) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        // Process in reverse to avoid index shifting
        textNodes.reverse();
        textNodes.forEach(function(node) {
            var text = node.textContent;
            var lower = text.toLowerCase();
            var idx = lower.indexOf(q);
            if (idx === -1) return;

            var frag = document.createDocumentFragment();
            var lastIndex = 0;

            // Loop through all occurrences in this text node
            while (idx !== -1) {
                // Text before this match
                if (idx > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
                }
                // The matching portion, wrapped in <mark>
                var mark = document.createElement('mark');
                mark.className = 'config-hl';
                mark.textContent = text.slice(idx, idx + query.length);
                frag.appendChild(mark);

                lastIndex = idx + query.length;
                idx = lower.indexOf(q, lastIndex);
            }

            // Remaining text after the last match
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            node.parentNode.replaceChild(frag, node);
        });
    },

    

    updateNavBadges: function() {
        // Modules badge: count dock links + custom commands
        var moduleBadge = document.getElementById('nav-badge-modules');
        if (moduleBadge) {
            var dockCount = (State.CONFIG.dock_links || []).length;
            var cmdCount = (State.CONFIG.custom_commands || []).length;
            var total = dockCount + cmdCount;
            if (total > 0) {
                moduleBadge.textContent = total.toString();
                moduleBadge.style.display = 'inline-flex';
            } else {
                moduleBadge.style.display = 'none';
            }
        }

        // Sync badge: show backup status
        var syncBadge = document.getElementById('nav-badge-sync');
        if (syncBadge) {
            var lastBackup = State.CONFIG.last_backup_time;
            if (lastBackup) {
                var hoursAgo = (Date.now() - lastBackup) / 3600000;
                if (hoursAgo < 24) {
                    syncBadge.textContent = Math.round(hoursAgo) + 'h';
                    syncBadge.style.display = 'inline-flex';
                } else {
                    syncBadge.style.display = 'none';
                }
            } else {
                syncBadge.style.display = 'none';
            }
        }
    },

    

    _syncBtn: function(id) { return document.getElementById(id); },
    _syncMsg: function(id, text, type) {
        var el = this._syncBtn(id);
        if (!el) return;
        if (text) {
            el.textContent = text;
            el.className = 'sync-msg ' + type;
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    },
    _syncLoading: function(btnId, loading) {
        var btn = this._syncBtn(btnId);
        if (!btn) return;
        btn.disabled = loading;
        btn.classList.toggle('loading', loading);
    },

    bindSyncButtons: function() {
        var self = this;

        // Backup now button
        var backupBtn = this._syncBtn('sync-backup-now-btn');
        if (backupBtn) {
            backupBtn.onclick = function() {
                if (!window.BackupManager) return;
                self._syncLoading('sync-backup-now-btn', true);
                self._syncMsg('sync-backup-status', null);
                try {
                    window.BackupManager.triggerBackup('auto');
                    self._syncMsg('sync-backup-status', '✅ Backup saved', 'success');
                } catch (e) {
                    console.error('[Sync] Backup failed:', e);
                    self._syncMsg('sync-backup-status', '❌ Backup failed', 'error');
                }
                self._syncLoading('sync-backup-now-btn', false);
                self.loadSyncTab();
            };
        }

        // Auto-backup interval change — staged for the modal's SAVE flow.
        // The global change listener → checkDirty() shows SAVE *; persistence
        // happens in saveConfigFromUI, which also reschedules the timer.
        // (Immediate save here previously bypassed dirty tracking entirely.)
        var intervalSelect = this._syncBtn('cfg-auto-backup');
        if (intervalSelect) {
            intervalSelect.onchange = function() {
                self._syncMsg('sync-backup-status', '⏱ Save to apply the backup interval', 'info');
                setTimeout(function() { self._syncMsg('sync-backup-status', null); }, 3000);
            };
        }

        // Drive connect
        var connectBtn = this._syncBtn('drive-connect-btn');
        if (connectBtn) {
            connectBtn.onclick = function() {
                if (!window.BackupManager) return;
                self._syncLoading('drive-connect-btn', true);
                self._syncMsg('drive-sync-status', null);
                window.BackupManager.connectDrive(function(success) {
                    self._syncLoading('drive-connect-btn', false);
                    if (success) {
                        self._syncMsg('drive-sync-status', '✅ Drive connected', 'success');
                    } else {
                        self._syncMsg('drive-sync-status', '❌ Failed to connect Drive', 'error');
                    }
                    self.loadSyncTab();
                });
            };
        }

        // Drive disconnect
        var disconnectBtn = this._syncBtn('drive-disconnect-btn');
        if (disconnectBtn) {
            disconnectBtn.onclick = function() {
                if (!window.BackupManager) return;
                self._syncLoading('drive-disconnect-btn', true);
                window.BackupManager.disconnectDrive(function() {
                    self._syncLoading('drive-disconnect-btn', false);
                    self._syncMsg('drive-sync-status', '🔌 Drive disconnected', 'info');
                    self.loadSyncTab();
                });
            };
        }

        // Drive sync push
        var pushBtn = this._syncBtn('drive-sync-push-btn');
        if (pushBtn) {
            pushBtn.onclick = function() {
                if (!window.BackupManager) return;
                self._syncLoading('drive-sync-push-btn', true);
                self._syncMsg('drive-sync-status', null);
                window.BackupManager.syncToDrive(function(success) {
                    self._syncLoading('drive-sync-push-btn', false);
                    if (success) {
                        self._syncMsg('drive-sync-status', '✅ Synced to Drive', 'success');
                    } else {
                        self._syncMsg('drive-sync-status', '❌ Sync failed', 'error');
                    }
                    self.loadSyncTab();
                });
            };
        }

        // Drive sync pull
        var pullBtn = this._syncBtn('drive-sync-pull-btn');
        if (pullBtn) {
            pullBtn.onclick = function() {
                if (!window.BackupManager) return;
                self._syncLoading('drive-sync-pull-btn', true);
                self._syncMsg('drive-sync-status', null);
                window.BackupManager.syncFromDrive(function(success) {
                    self._syncLoading('drive-sync-pull-btn', false);
                    if (success) {
                        self._syncMsg('drive-sync-status', '✅ Restored from Drive', 'success');
                    } else {
                        self._syncMsg('drive-sync-status', '❌ Restore failed', 'error');
                    }
                    self.loadSyncTab();
                });
            };
        }
    },

    loadSyncTab: function() {
        // Update backup interval selector
        var interval = State.CONFIG.auto_backup_interval || 0;
        var intervalSelect = this._syncBtn('cfg-auto-backup');
        if (intervalSelect) intervalSelect.value = interval.toString();

        // Update last backup info
        var lastBackupEl = this._syncBtn('sync-last-backup');
        if (lastBackupEl) {
            var lastTime = State.CONFIG.last_backup_time;
            lastBackupEl.textContent = lastTime
                ? new Date(lastTime).toLocaleString()
                : 'never';
        }

        // Update drive sync info
        var lastDriveEl = this._syncBtn('sync-last-drive');
        if (lastDriveEl) {
            var lastSync = State.CONFIG.drive_last_sync;
            lastDriveEl.textContent = lastSync
                ? new Date(lastSync).toLocaleString()
                : 'never';
        }

        // Update Drive connection status
        var statusEl = this._syncBtn('drive-status');
        var connectBtn = this._syncBtn('drive-connect-btn');
        var disconnectBtn = this._syncBtn('drive-disconnect-btn');
        var pushBtn = this._syncBtn('drive-sync-push-btn');
        var pullBtn = this._syncBtn('drive-sync-pull-btn');

        var isConnected = window.BackupManager && window.BackupManager.driveConnected;

        if (statusEl) {
            statusEl.innerHTML = '<span class="sync-status-dot' + (isConnected ? ' connected' : '') + '"></span> ' + (isConnected ? 'Connected' : 'Not connected');
        }
        if (connectBtn) connectBtn.style.display = isConnected ? 'none' : 'inline-flex';
        if (disconnectBtn) disconnectBtn.style.display = isConnected ? 'inline-flex' : 'none';
        if (pushBtn) pushBtn.style.display = isConnected ? 'inline-flex' : 'none';
        if (pullBtn) pullBtn.style.display = isConnected ? 'inline-flex' : 'none';
    },

    // Import data from Drive sync (called by BackupManager.syncFromDrive)
    importFromSync: function(data) {
        if (!data) return;

        if (data.config) {
            Object.assign(State.CONFIG, data.config);
        }
        if (data.tasks && Array.isArray(data.tasks)) {
            State.TASKS = data.tasks;
        }
        if (data.notes && Array.isArray(data.notes)) {
            State.NOTES = data.notes;
        }
        if (data.boards && Array.isArray(data.boards)) {
            State.BOARDS = data.boards;
        }
        if (data.canvases && Array.isArray(data.canvases)) {
            State.CANVASES = data.canvases;
        }
        // Canonical key is 'commands'; accept legacy 'history' key too.
        var syncedHistory = data.commands || data.history;
        if (syncedHistory && Array.isArray(syncedHistory)) {
            State.COMMAND_HISTORY = syncedHistory;
        }

        // Persist and re-render
        saveConfig();
        if (window.saveData) window.saveData();
        if (Config.applyTheme) Config.applyTheme();
        if (window.renderMissions) window.renderMissions();
        if (window.MetadataCache) window.MetadataCache.init();
        if (window.Notes) {
            window.Notes.renderNotes();
            window.Notes.renderSidebar();
        }

        // Full vault restore — reload so every module picks up the new state
        // (mirrors the local importDataFile flow).
        showNotification('DATA RESTORED FROM DRIVE // RELOAD RECOMMENDED');
        setTimeout(function() {
            if (typeof location !== 'undefined') location.reload();
        }, 1500);

        console.log('[SettingsUI] Data imported from Drive sync');
    },

    // Bind Backup Buttons
    bindBackupButtons: function() {
        var exportBtn = document.getElementById('export-config');
        if (exportBtn) exportBtn.onclick = this.exportAllData.bind(this);
        
        var importBtn = document.getElementById('import-btn');
        if (importBtn) importBtn.onclick = this.triggerImport.bind(this);
        
        var importFile = document.getElementById('import-file');
        if (importFile) importFile.onchange = this.importDataFile.bind(this);

        var clearDataBtn = document.getElementById('clear-data');
        if (clearDataBtn) clearDataBtn.onclick = function() {
             if (window.clearAllData) window.clearAllData();
             else if (confirm("CLEAR ALL DATA (Tasks, Notes, History)? This cannot be undone.")) {
                 State.TASKS = [];
                 State.NOTES = [];
                 State.COMMAND_HISTORY = [];
                 clearAllNotes();
                 saveData();
                 location.reload();
             }
        };
    }
};

window.SettingsUI = SettingsUI;
