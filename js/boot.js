// js/boot.js - The Manual Wiring System

// 1. IMPORT ALL MANAGERS
import { State } from './core/Store.js';
import { Config } from './core/Config.js';
import { loadData } from './core/Storage.js';
import { Notes } from './modules/NotesController.js';
import { GraphManager } from './modules/GraphManager.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { ModalManager } from './ui/ModalManager.js';
import { TabManager } from './ui/TabManager.js';
import { KanbanManager } from './features/KanbanManager.js';
import { TaskAggregator } from './features/TaskAggregator.js'; 
import { BlockEditor } from './editor/BlockEditor.js';
import { PageManager } from './editor/PageManager.js'; 
import { Bookmarks } from './features/Bookmarks.js';
import { Pomodoro } from './features/Pomodoro.js';
import { CommandLine } from './features/CommandLine.js';
import { Clock } from './features/Clock.js';
import { PageActions } from './ui/PageActions.js';
import { SlashMenu } from './ui/SlashMenu.js';
import { initKeyboardShortcuts } from './core/Input.js';
import { renderMissions, checkStreakReset, addTask, toggleTaskComplete, updateProgressBar, clearCompletedTasks } from './features/Missions.js';
import { Audio } from './core/Audio.js'; 
import { Background } from './ui/Background.js';
import { fetchWeather } from './features/Weather.js';
import { safeCalculate } from './core/SafeCalc.js';
import { startPomodoro } from './features/Pomodoro.js';
import { CommandRegistry } from './core/CommandRegistry.js';
import { SystemCommands } from './config/SystemCommands.js';

// 2. EXPORT TO WINDOW (Fixes HTML onclick="" errors)
window.State = State;
window.Notes = Notes;
window.GraphManager = GraphManager;
window.ModalManager = ModalManager;
window.KanbanManager = KanbanManager;
window.TabManager = TabManager;
window.PageManager = PageManager; 
window.BlockEditor = BlockEditor;
window.SettingsUI = SettingsUI;
window.Config = Config;
window.TaskAggregator = TaskAggregator;
window.Bookmarks = Bookmarks;
window.fetchWeather = fetchWeather;
window.addTask = addTask;
window.toggleTaskComplete = toggleTaskComplete;
window.updateProgressBar = updateProgressBar;
window.clearCompletedTasks = clearCompletedTasks;
window.safeCalculate = safeCalculate;
window.Pomodoro = Pomodoro;
window.startPomodoro = startPomodoro;
window.Audio = Audio;
window.SlashMenu = SlashMenu;
window.PageActions = PageActions;

// 3. MAP LEGACY FUNCTIONS (Fixes specific HTML buttons)
window.toggleConfig = SettingsUI.toggleConfig.bind(SettingsUI); 
window.saveConfigFromUI = SettingsUI.saveConfigFromUI.bind(SettingsUI); 
window.toggleHelp = () => ModalManager.open('help-modal');
window.renderMissions = renderMissions;
// Re-implementing renderDock from main.js
window.renderDock = function() {
    var dock = document.getElementById('dock');
    if (!dock) return;
    dock.innerHTML = '';

    if (!State.CONFIG.dock_links || !Array.isArray(State.CONFIG.dock_links)) return;

    State.CONFIG.dock_links.forEach(function (link) {
        var a = document.createElement('a');
        a.href = link.url;
        var label = link.name || link.label || 'LINK'; // Fallback
        a.textContent = '[ ' + label.toUpperCase() + ' ]';
        dock.appendChild(a);
    });
}; 

// FIX: Global Toggles
window.toggleNotesPanel = function() {
    Notes.toggleSidebar();
};
window.toggleWeather = function() {
    const extra = document.getElementById('weather-extra');
    if (extra) {
        extra.classList.toggle('active');
        // Persist state
        var isActive = extra.classList.contains('active');
        console.log('[Weather] Toggled. Extended:', isActive);
        
        if (State && State.CONFIG) {
            State.CONFIG.weather_extended = isActive;
            Config.save();
        }
    } else {
        console.warn('Weather extra element not found');
    }
};

// V63: Explicitly bind to avoid inline handler scope issues and CSP violations
function bindGlobals() {
    console.log('[Boot] Binding globals...');
    // 1. Weather
    const wToggle = document.getElementById('weather-toggle');
    if (wToggle) wToggle.onclick = window.toggleWeather;
    
    // 2. Tasks
    const clrTasks = document.getElementById('clear-tasks');
    if (clrTasks) clrTasks.onclick = window.clearCompletedTasks;

    // 3. Top Bar Buttons (CSP Fix)
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) helpBtn.onclick = function() { window.toggleHelp(); };
    
    const notesToggle = document.getElementById('notes-toggle-btn');
    if (notesToggle) notesToggle.onclick = function() { window.toggleNotesPanel(); };

    // V75: Graph Toggle Binding
    const graphBtn = document.getElementById('open-graph-btn');
    if (graphBtn) graphBtn.onclick = function() { window.GraphManager.open(); };

    // 3. System Buttons
    const configBtn = document.getElementById('config-btn');
    if (configBtn) configBtn.onclick = function() { 
        console.log('[Boot] Config button clicked');
        if (window.SettingsUI) window.SettingsUI.toggleConfig(); 
        else console.error('[Boot] SettingsUI is missing!');
    };

    // Note: helpBtn defined above in "Top Bar Buttons"
    // We can just rely on that one, or verify if SettingsUI.toggleHelp is preferred.
    // window.toggleHelp calls ModalManager.open('help-modal'). 
    // SettingsUI.toggleHelp also calls ModalManager but handles active state.
    // Changing the upstream helper to point to SettingsUI.toggleHelp for consistency.
    if (helpBtn) helpBtn.onclick = function() { window.SettingsUI.toggleHelp(); };

    // 4. Modals (Close Buttons)
    // [FIX] Define safe close callback for ModalManager
    window.closeSettingsModal = function() {
        if (window.SettingsUI) window.SettingsUI.close();
    };

    const closeButtons = document.querySelectorAll('.close-modal');
    closeButtons.forEach(btn => {
        // [FIX] Do NOT force close. Let ModalManager handle safety checks.
        btn.onclick = function() { window.ModalManager.closeTop(false); };
    });
    
    const folderCancel = document.getElementById('folder-modal-cancel');
    if (folderCancel) folderCancel.onclick = function() { window.ModalManager.close('folder-create-modal'); };

    const noteHelpClose = document.getElementById('note-help-close');
    if (noteHelpClose) noteHelpClose.onclick = function() { window.ModalManager.close('note-help-modal'); };

    const noteHelpBtn = document.getElementById('note-help-btn');
    if (noteHelpBtn) noteHelpBtn.onclick = function() { window.ModalManager.toggle('note-help-modal'); };

    // 5. Config Actions
    const saveBtn = document.getElementById('config-save-btn');
    if (saveBtn) saveBtn.onclick = function() { window.SettingsUI.saveConfigFromUI(); };

    const headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) headerSaveBtn.onclick = function() { window.SettingsUI.saveConfigFromUI(); };

    const resetBtn = document.getElementById('reset-defaults-btn');
    if (resetBtn) resetBtn.onclick = function() { window.SettingsUI.resetToDefaults(); };
    
    const importBtn = document.getElementById('import-theme-btn');
    if (importBtn) importBtn.onclick = function() { window.SettingsUI.importTheme(); };
    
    const exportBtn = document.getElementById('export-theme-btn');
    if (exportBtn) exportBtn.onclick = function() { window.SettingsUI.exportTheme(); };
    
    const bgTypeSel = document.getElementById('cfg-bg-type');
    if (bgTypeSel) bgTypeSel.onchange = function() { window.SettingsUI.toggleBgType(); };

    // 6. Notes Actions
    const addNoteBtn = document.getElementById('note-add-btn');
    if (addNoteBtn) addNoteBtn.onclick = function() { window.Notes.addNote(); };

    const dlNoteBtn = document.getElementById('note-download-btn');
    if (dlNoteBtn) dlNoteBtn.onclick = function() { window.Notes.downloadNotes(); };

    // 7. Page Actions (Context Menu) — init() handles click binding

    const pinNoteBtn = document.getElementById('pin-note-btn');
    if (pinNoteBtn) pinNoteBtn.onclick = function() { window.Notes.togglePin(); };

    const favBtn = document.getElementById('page-fav-btn');
    if (favBtn) favBtn.onclick = function() { window.PageActions.toggleFavorite(); };

    const fullBtn = document.getElementById('page-fullscreen-btn');
    if (fullBtn) fullBtn.onclick = function() { window.PageActions.openFullscreen(); };
    
    const expBtn = document.getElementById('page-export-btn');
    if (expBtn) expBtn.onclick = function() { window.PageActions.exportMarkdown(); };
    
    const dupBtn = document.getElementById('page-dup-btn');
    if (dupBtn) dupBtn.onclick = function() { window.PageActions.duplicateNote(); };
    
    const delBtn = document.getElementById('page-del-btn');
    if (delBtn) delBtn.onclick = function() { window.PageActions.deleteNote(); };

    // 8. Pomodoro
    const pomoPause = document.getElementById('pomodoro-pause');
    if (pomoPause) pomoPause.onclick = function() { window.startPomodoro && window.Pomodoro ? window.Pomodoro.togglePause() : null; };
    
    const pomoStop = document.getElementById('pomodoro-stop');
    if (pomoStop) pomoStop.onclick = function() { window.Pomodoro ? window.Pomodoro.stop() : null; };
    
    const pomoAck = document.getElementById('pomo-dismiss-btn');
    if (pomoAck) pomoAck.onclick = function() { window.Pomodoro ? window.Pomodoro.acknowledgeComplete() : null; };
}



// 4. THE BOOT SEQUENCE
async function boot() {
    console.log("Vinland: Manual Boot Sequence Started...");

    // A. Load Core
    Config.load(); 
    await loadData(); 
    
    // B. Initialize UI Managers
    if(ModalManager) ModalManager.init();
    if(TabManager) TabManager.init();
    
    if (Notes) {
        Notes.init();
        // FIX: Render quick notes panel
        if (typeof Notes.renderNotes === 'function') Notes.renderNotes();
        // Also render sidebar if enabled
        if (State.CONFIG.notes_enabled !== false) {
             Notes.renderSidebar();
        }
    }
    
    if(KanbanManager) KanbanManager.init(); 
    if(SettingsUI) SettingsUI.init();

    // 2.5 Register Commands (New Registry System)
    // 2.5 Register Commands (New Registry System)
    SystemCommands.register();
    if(CommandLine) CommandLine.init();
    if(Pomodoro) Pomodoro.init();
    if(Bookmarks) Bookmarks.init();
    if(PageActions) PageActions.init();
    if(SlashMenu) SlashMenu.init();
    if(Clock) Clock.init();
    
    // Initialize global keyboard shortcuts (Cmd+S/E/P, tab nav, etc.)
    initKeyboardShortcuts();
    
    // C. Initial Renders & Features
    if(renderMissions) renderMissions();
    if(checkStreakReset) checkStreakReset();
    if(window.renderDock) window.renderDock(); // [NEW] Link render
    if(SettingsUI.initBackground) SettingsUI.initBackground();
    
    // D. Initialize Weather
    // FIX: Trigger weather fetch if location is set
    Config.applyTheme(); // Ensure theme applied
    if (typeof fetchWeather === 'function') {
        fetchWeather();
    }
    
    bindGlobals(); // [NEW] Bind static HTML buttons

    console.log("Vinland: Systems Online.");
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
