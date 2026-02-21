import { State } from './core/Store.js';
import { loadData, saveData } from './core/Storage.js';
import { Config, loadConfig, saveConfig } from './core/Config.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { ModalManager } from './ui/ModalManager.js';
import { TabManager } from './ui/TabManager.js';
import { Notes } from './modules/NotesController.js';
import { GraphManager } from './modules/GraphManager.js';
import { Bookmarks } from './features/Bookmarks.js';
import { Pomodoro } from './features/Pomodoro.js';
import { CommandLine } from './features/CommandLine.js';
import { Clock } from './features/Clock.js';
import { PageActions } from './ui/PageActions.js';
import { SlashMenu } from './ui/SlashMenu.js';
import { renderMissions, checkStreakReset } from './features/Missions.js';
import { Audio } from './core/Audio.js'; 
import { Background } from './ui/Background.js';
import { Weather } from './features/Weather.js'; // V101: Modularized
import { Dock } from './features/Dock.js';       // V101: Modularized

// Phase 3: Second Brain Modules
import { MetadataCache } from './core/MetadataCache.js';
import { QueryEngine } from './core/QueryEngine.js';
import { CanvasManager } from './modules/CanvasManager.js';
import { HoverPreview } from './ui/HoverPreview.js';
import { CalloutModal } from './ui/CalloutModal.js';
import * as Sidebar from './ui/Sidebar.js'; // V88: Voltron Pattern for Trash View

// --- MAIN ENTRY POINT ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
    console.log("Vinland: System Booting...");

    // 1. Load Core Data
    Config.load();
    Config.applyTheme(); // Immediate visual update
    await loadData(); // Await data to prevent blank UI
    // 2. Initialize UI & Features
    ModalManager.init();
    if (TabManager) TabManager.init();
    if (SettingsUI) SettingsUI.init(); // Ensures theme is applied
    
    // 3. Initialize Background (Critical Fix)
    if (typeof Background !== 'undefined' && Background.init) {
        Background.init();
    } else if (SettingsUI.initBackground) {
        SettingsUI.initBackground();
    }

    // 4. Render Primary Views
    if (State.CONFIG.notes_enabled !== false) {
        if (Notes && Notes.init) Notes.init(); 
        if (Notes && Notes.renderSidebar) Notes.renderSidebar();
    }
    
    // Render Quick Notes (Legacy Panel)
    if (Notes && Notes.renderNotes) Notes.renderNotes(); 

    // 5. Initialize Sub-Modules
    if (CommandLine) CommandLine.init();
    if (Pomodoro) Pomodoro.init();
    if (Bookmarks) Bookmarks.init();
    if (PageActions) PageActions.init();
    if (SlashMenu && SlashMenu.init) SlashMenu.init();
    if (Clock && Clock.init) Clock.init();

    // 6. Restore Legacy Global Functions
    if (typeof renderMissions === 'function') renderMissions();
    if (typeof checkStreakReset === 'function') checkStreakReset();
    
    initCollapsibleSections();
    
    // 7. Global Event Listeners (The "Missing Glue")
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('input', handleGlobalInput); // Restores typing sounds

    // 8. Phase 3: Second Brain Features
    MetadataCache.init();
    CanvasManager.init();
    HoverPreview.init();
    CalloutModal.init();

    // 9. Data Safety Net
    window.addEventListener('beforeunload', function() {
        saveData(); 
    });

    console.log("Vinland: System Online");
}

// --- GLOBAL EVENT HANDLERS ---

function handleGlobalClick(e) {
    // Modal Close Buttons
    if (e.target.closest('.close-modal') || e.target.closest('.close-btn')) {
        var modal = e.target.closest('.modal');
        if (modal && modal.id) ModalManager.close(modal.id);
        else ModalManager.closeTop();
    }
    
    // Pin Note Button
    if (e.target.closest('#pin-note-btn')) {
        if (Notes && Notes.togglePin) Notes.togglePin();
    }
    
    // Page Actions Button (Delegate)
    if (e.target.closest('#page-actions-btn') || e.target.closest('.page-actions-trigger')) {
        if (PageActions && PageActions.toggle) PageActions.toggle();
    }
    
    // Preview Toggle Button
    if (e.target.closest('#preview-toggle')) {
        if (Notes && Notes.togglePreview) Notes.togglePreview();
    }
    
    // Sound on Click (for specific interactive elements)
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.closest('button')) {
        if (Audio && Audio.playClickSound) Audio.playClickSound();
    }
}

function handleGlobalInput(e) {
    // Restores Typing Sounds
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        if (Audio && Audio.playTypingSound) Audio.playTypingSound();
    }
}

// --- GLOBAL EXPORTS (For HTML onclick="") ---
window.State = State;
window.saveConfig = saveConfig;
window.saveData = saveData;
window.SettingsUI = SettingsUI;
window.ModalManager = ModalManager;
window.Notes = Notes;
window.GraphManager = GraphManager;
window.renderMissions = renderMissions;
window.PageActions = PageActions; // V74: Voltron Pattern
window.saveConfigFromUI = SettingsUI.saveConfigFromUI.bind(SettingsUI);

// Phase 3: Second Brain Globals (Voltron Pattern)
window.MetadataCache = MetadataCache;
window.QueryEngine = QueryEngine;
window.CanvasManager = CanvasManager;
window.HoverPreview = HoverPreview;
window.CalloutModal = CalloutModal;
window.Sidebar = Sidebar; // V88: Voltron Pattern

// CLI Globals (V101: Restoration)
// These are required for CommandLine.js 'eval' or direct function calls
import { addTask, toggleTaskComplete } from './features/Missions.js';
import { safeCalculate } from './core/SafeCalc.js';

window.addTask = addTask;
window.toggleTaskComplete = toggleTaskComplete;
window.safeCalculate = safeCalculate;
// Also expose for legacy inline calls if any
window.calc = safeCalculate; 

// Audio Globals
if (typeof Audio !== 'undefined') {
    window.playClickSound = Audio.playClickSound;
}

// Inline Dock/Weather removed - Modularized in V101

function initCollapsibleSections() {
    var coll = document.getElementsByClassName("collapsible-header");
    for (var i = 0; i < coll.length; i++) {
        coll[i].addEventListener("click", function () {
            this.classList.toggle("active");
            var content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    }
}

