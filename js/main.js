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
import { SlashMenu } from './editor/SlashMenu.js';
import { renderMissions, checkStreakReset } from './features/Missions.js';
import { Audio } from './core/Audio.js'; 
import { Background } from './ui/Background.js';

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
    
    // 7. Initialize Inline Systems (Dock/Weather)
    if (typeof renderDock === 'function') renderDock(State.ROOT_ID);
    if (typeof fetchWeather === 'function' && State.CONFIG.weather_enabled !== false) fetchWeather();

    initCollapsibleSections();
    
    // 8. Global Event Listeners (The "Missing Glue")
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('input', handleGlobalInput); // Restores typing sounds

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

// Audio Globals
if (typeof Audio !== 'undefined') {
    window.playClickSound = Audio.playClickSound;
}

// --- LEGACY INLINE LOGIC (Keep these until moved to modules) ---

window.renderDock = function() {
    var dock = document.getElementById('dock-links');
    if (!dock) return;
    dock.innerHTML = '';
    if (!Array.isArray(State.CONFIG.dock_links)) {
        State.CONFIG.dock_links = [
            { name: "GMAIL", url: "https://mail.google.com" },
            { name: "CAL", url: "https://calendar.google.com" },
            { name: "GPT", url: "https://chat.openai.com" }
        ];
    }
    State.CONFIG.dock_links.forEach(function (link, index) {
        var a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.name;
        a.className = 'dock-item';
        a.oncontextmenu = function (e) {
            e.preventDefault();
            if (confirm('Delete dock link "' + link.name + '"?')) {
                State.CONFIG.dock_links.splice(index, 1);
                saveConfig();
                renderDock();
            }
        };
        dock.appendChild(a);
    });
    var addBtn = document.createElement('span');
    addBtn.textContent = '+';
    addBtn.className = 'dock-add';
    addBtn.title = 'Add Link';
    addBtn.onclick = function () { SettingsUI.open('dock'); };
    dock.appendChild(addBtn);
};

window.fetchWeather = function() {
    var el = document.getElementById('weather-widget');
    if (!el) return;
    if (!State.CONFIG.weather_location || State.CONFIG.weather_location === '') {
        el.textContent = 'SET_LOCATION //';
        el.onclick = function() { SettingsUI.open('weather'); };
        return;
    }

    // Cache Check (30 mins)
    var now = Date.now();
    if (State.WEATHER_CACHE && (now - State.WEATHER_CACHE.time < 1800000)) {
        renderWeather(State.WEATHER_CACHE.data);
        return;
    }

    var location = State.CONFIG.weather_location || 'London';
    var url = 'https://wttr.in/' + encodeURIComponent(location) + '?format=j1';

    el.textContent = 'LOADING //';

    fetch(url)
        .then(res => res.json())
        .then(data => {
            State.WEATHER_CACHE = { time: Date.now(), data: data };
            renderWeather(data);
             try {
                localStorage.setItem('OPERATOR_WEATHER_CACHE', JSON.stringify(State.WEATHER_CACHE));
            } catch(e) {}
        })
        .catch(err => {
            console.error('Weather error:', err);
            el.textContent = 'OFFLINE //';
        });
};

function renderWeather(data) {
    var el = document.getElementById('weather-widget');
    if (!el || !data) return;

    var current = data.current_condition[0];
    var temp = State.CONFIG.use_celsius ? current.temp_C + 'C' : current.temp_F + 'F';
    var cond = current.weatherDesc[0].value;
    
    var text = (State.CONFIG.weather_location || 'WEATHER').toUpperCase() + ' : ' + temp + ' / ' + cond.toUpperCase();
    
    if (State.CONFIG.weather_extended) {
        text += ' / H:' + current.humidity + '%';
    }
    
    el.textContent = text;
    el.onclick = function() { SettingsUI.open('weather'); };
}

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
