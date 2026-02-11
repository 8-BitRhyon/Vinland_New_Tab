import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { saveConfig } from '../core/Config.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes, addNote, clearNotes, toggleNotesPanel, renderNotes } from '../modules/NotesController.js';
import { safeText } from '../core/Utils.js';

/* =========================================
   COMMAND LINE INTERFACE
   ========================================= */

// Local UI State
let historyIndex = -1;
let suggestionIndex = -1;
let currentSuggestions = [];

const QUOTES = [
    "The best way to predict the future is to create it.",
    "Do what you can, with what you have, where you are.",
    "Focus on being productive instead of busy.",
    "Simplicity is the ultimate sophistication.",
    "Automate the boring stuff.",
    "Code is poetry.",
    "Stay hungry, stay foolish."
];

export const CommandLine = {
    init: function() {
        this.bindEvents();
    },

    bindEvents: function() {
        var input = document.getElementById('cmd-input');
        if (input) {
            input.addEventListener('input', this.handleInput.bind(this));
            input.addEventListener('keydown', this.handleKeydown.bind(this));
        }

        var suggestionsBox = document.getElementById('suggestions');
        if (suggestionsBox) {
            // Optional: Close suggestions on click outside?
        }
    },

    handleInput: function(e) {
        var val = e.target.value;
        var hint = document.getElementById('command-hint');
        var suggestionsBox = document.getElementById('suggestions');

        historyIndex = -1;

        var valLower = val.toLowerCase();

        if (valLower.startsWith('task')) {
            hint.innerHTML = '<span class="hint-syntax">task [!!|!|~] [@category] [text] [time] or task [text] at [time]</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('focus')) {
            hint.innerHTML = '<span class="hint-syntax">focus [25 | 1:30 | 90s]</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('note')) {
            hint.innerHTML = '<span class="hint-syntax">note [text]</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('done')) {
            hint.innerHTML = '<span class="hint-syntax">done [#]</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('clear')) {
            hint.innerHTML = '<span class="hint-syntax">clear [tasks | task # | task name | notes | note # | all]</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('hide')) {
            hint.innerHTML = '<span class="hint-syntax">hide done</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('show')) {
            hint.innerHTML = '<span class="hint-syntax">show done</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('quote')) {
            hint.innerHTML = '<span class="hint-syntax">quote - Display random motivational quote</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('history')) {
            hint.innerHTML = '<span class="hint-syntax">history - Show command history</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('gcal') || valLower.startsWith('gtasks') || valLower.startsWith('gmail') || valLower.startsWith('gdrive')) {
            hint.innerHTML = '<span class="hint-syntax">gcal | gtasks | gmail | gdrive | gdocs</span>';
            hint.style.display = 'block';
        } else if (valLower.startsWith('calc')) {
            hint.innerHTML = '<span class="hint-syntax">calc [expression]</span>';
            hint.style.display = 'block';
        } else {
            hint.innerHTML = '';
            hint.style.display = 'none';
        }

        if (State.CONFIG.show_bookmarks && val.toLowerCase().startsWith('b ') && val.length > 2) {
            var query = val.slice(2).toLowerCase();
            var matches = (State.FLAT_BOOKMARKS || []).filter(function (b) { return b.title.toLowerCase().includes(query); }).slice(0, 8);
            currentSuggestions = matches;
            this.renderSuggestions(matches);
        } else {
            suggestionsBox.style.display = 'none';
            currentSuggestions = [];
        }
    },

    renderSuggestions: function(matches) {
        var box = document.getElementById('suggestions');
        if (!box) return;
        box.innerHTML = '';
        suggestionIndex = -1;

        if (!matches || matches.length === 0) {
            box.style.display = 'none';
            return;
        }

        var self = this;
        matches.forEach(function (match, idx) {
            var div = document.createElement('div');
            div.className = 'suggestion-item';
            div.setAttribute('data-index', idx);
            var typeText = match.type === 'folder' ? 'FOLDER' : 'BOOKMARK';
            div.innerHTML = '<span>' + safeText(match.title) + '</span><span class="type-badge">' + typeText + '</span>';
            div.onclick = function () { 
                if (match.type === 'folder') {
                    if (window.NAV_STACK) window.NAV_STACK.push(State.CURRENT_BOOKMARK_FOLDER); // Assuming globals for now
                    if (window.renderBottomBar) window.renderBottomBar(match.id);
                    document.getElementById('cmd-input').value = '';
                    document.getElementById('suggestions').style.display = 'none';
                } else if (match.url) {
                    window.location.href = match.url; 
                }
            };
            box.appendChild(div);
        });
        box.style.display = 'block';
    },

    updateSuggestionHighlight: function() {
        var box = document.getElementById('suggestions');
        if (!box) return;
        var items = box.querySelectorAll('.suggestion-item');
        items.forEach(function (item, i) {
            if (i === suggestionIndex) item.classList.add('active');
            else item.classList.remove('active');
        });
    },

    handleKeydown: function(e) {
        var input = document.getElementById('cmd-input');
        var suggestionsBox = document.getElementById('suggestions');

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentSuggestions.length > 0 && suggestionsBox.style.display !== 'none') {
                suggestionIndex = suggestionIndex > 0 ? suggestionIndex - 1 : currentSuggestions.length - 1;
                this.updateSuggestionHighlight();
            } else if (State.COMMAND_HISTORY.length > 0) {
                if (historyIndex === -1) historyIndex = State.COMMAND_HISTORY.length - 1;
                else if (historyIndex > 0) historyIndex--;
                input.value = State.COMMAND_HISTORY[historyIndex] || '';
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentSuggestions.length > 0 && suggestionsBox.style.display !== 'none') {
                suggestionIndex = suggestionIndex < currentSuggestions.length - 1 ? suggestionIndex + 1 : 0;
                this.updateSuggestionHighlight();
            } else if (historyIndex !== -1) {
                if (historyIndex < State.COMMAND_HISTORY.length - 1) {
                    historyIndex++;
                    input.value = State.COMMAND_HISTORY[historyIndex] || '';
                } else {
                    historyIndex = -1;
                    input.value = '';
                }
            }
            return;
        }

        if (e.key === 'Enter') {
            if (suggestionIndex >= 0 && currentSuggestions[suggestionIndex]) {
                var selectedMatch = currentSuggestions[suggestionIndex];
                if (selectedMatch.url) window.location.href = selectedMatch.url;
                return;
            }

            var raw = input.value.trim();
            if (!raw) return;

            this.addToHistory(raw);

            var funcMatch = raw.match(/^(\w+)\s*=\s*(\w+)\(\s*(.*?)\s*\)$/);
            if (funcMatch) {
                var baseCmd = funcMatch[1].toLowerCase();
                var action = funcMatch[2].toLowerCase();
                var args = funcMatch[3];
                if (baseCmd === 'task' && action === 'create') { 
                    if (window.addTask) window.addTask(args); 
                    input.value = ''; return; 
                }
                if (baseCmd === 'mail' && action === 'create') { 
                    window.location.href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(args); 
                    return; 
                }
            }

            var firstSpace = raw.indexOf(' ');
            var cmd = firstSpace === -1 ? raw : raw.substring(0, firstSpace);
            var query = firstSpace === -1 ? '' : raw.substring(firstSpace + 1);
            var cmdLower = cmd.toLowerCase();

            if (cmdLower === 'help' || cmdLower === 'man') { ModalManager.open('help-modal'); input.value = ''; return; }
            if (cmdLower === 'history') { this.showHistory(); input.value = ''; return; }
            if (cmdLower === 'notes') { toggleNotesPanel(); input.value = ''; return; }
            if (cmdLower === 'focus') { if (window.startPomodoro) window.startPomodoro(query); input.value = ''; return; }
            if (cmdLower === 'task') { 
                if (query) { if (window.addTask) window.addTask(query); }
                else window.location.href = 'https://calendar.google.com/calendar/u/0/r/tasks'; 
                input.value = ''; return; 
            }
            if (cmdLower === 'note') { if (query) addNote(query); input.value = ''; return; }
            if (cmdLower === 'done') { 
                var idx = parseInt(query) - 1; 
                if (!isNaN(idx) && idx >= 0 && State.TASKS[idx]) {
                    if (window.toggleTaskComplete) window.toggleTaskComplete(idx);
                }
                input.value = ''; return; 
            }

            if (cmdLower === 'hide' && query.toLowerCase() === 'done') {
                State.CONFIG.hide_completed_tasks = true;
                saveConfig();
                if (window.renderMissions) window.renderMissions();
                // showNotification('COMPLETED TASKS HIDDEN');
                input.value = '';
                return;
            }
            if (cmdLower === 'show' && query.toLowerCase() === 'done') {
                State.CONFIG.hide_completed_tasks = false;
                saveConfig();
                if (window.renderMissions) window.renderMissions();
                // showNotification('COMPLETED TASKS VISIBLE');
                input.value = '';
                return;
            }
            
            if (cmdLower === 'clear') {
                var qLower = query.toLowerCase();
                if (qLower === 'notes' || qLower === 'note') {
                    clearNotes();
                } else if (qLower.startsWith('note ') || qLower.startsWith('notes ')) {
                    var noteNum = parseInt(query.split(' ')[1]) - 1;
                    if (!isNaN(noteNum) && noteNum >= 0 && State.NOTES[noteNum]) {
                        State.NOTES.splice(noteNum, 1);
                        saveData();
                        renderNotes();
                        // showNotification('NOTE ' + (noteNum + 1) + ' DELETED');
                    }
                } else if (qLower.startsWith('task ')) {
                    var taskArg = query.substring(5).trim();
                    var taskNum = parseInt(taskArg);
                    if (!isNaN(taskNum) && taskNum > 0) {
                        var idx = taskNum - 1;
                        if (idx >= 0 && State.TASKS[idx]) {
                            State.TASKS.splice(idx, 1);
                            saveData();
                            if (window.renderMissions) window.renderMissions();
                            if (window.updateProgressBar) window.updateProgressBar();
                        }
                    } else {
                        // Clear by name
                        var searchName = taskArg.toLowerCase();
                        var matchingIndices = [];
                        for (var i = 0; i < State.TASKS.length; i++) {
                            if (State.TASKS[i].text.toLowerCase().includes(searchName)) {
                                matchingIndices.push(i);
                            }
                        }
                        if (matchingIndices.length > 0) {
                            for (var j = matchingIndices.length - 1; j >= 0; j--) {
                                State.TASKS.splice(matchingIndices[j], 1);
                            }
                            saveData();
                            if (window.renderMissions) window.renderMissions();
                            if (window.updateProgressBar) window.updateProgressBar();
                        }
                    }
                } else if (qLower === 'tasks' || qLower === 'task' || qLower === '') {
                    State.TASKS = [];
                    saveData();
                    if (window.renderMissions) window.renderMissions();
                    if (window.updateProgressBar) window.updateProgressBar();
                } else if (qLower === 'history') {
                    State.COMMAND_HISTORY = [];
                    saveData();
                } else if (qLower === 'all') {
                    // clearAllData(); // Can call global
                    if (window.clearAllData) window.clearAllData();
                }
                input.value = '';
                return;
            }

            if (cmdLower === 'weather') {
                if (query.toLowerCase().startsWith('set ')) {
                    var newLoc = query.substring(4).trim();
                    if (newLoc) {
                        State.CONFIG.location = newLoc;
                        State.WEATHER_CACHE = null; 
                        saveConfig();
                        if (window.fetchWeather) window.fetchWeather();
                    }
                } else {
                    if (window.fetchWeather) window.fetchWeather();
                }
                input.value = '';
                return;
            }

            if (cmdLower === 'mail') { window.location.href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(query); return; }
            
            if (cmdLower === 'sheet') {
                var queryLower = query.toLowerCase();
                if (queryLower === 'habit') {
                    if (State.CONFIG.habit_id) window.location.href = 'https://docs.google.com/spreadsheets/d/' + State.CONFIG.habit_id;
                } else if (queryLower === 'life') {
                    if (State.CONFIG.life_id) window.location.href = 'https://docs.google.com/spreadsheets/d/' + State.CONFIG.life_id;
                } else {
                    window.location.href = 'https://docs.google.com/spreadsheets';
                }
                return;
            }

            if (cmdLower === 'trello') { if (State.CONFIG.trello_board) window.location.href = 'https://trello.com/b/' + State.CONFIG.trello_board; else window.location.href = 'https://trello.com'; return; }
            if (cmdLower === 'notion') { if (State.CONFIG.notion_page) window.location.href = 'https://notion.so/' + State.CONFIG.notion_page; else window.location.href = 'https://notion.so'; return; }
            if (cmdLower === 'github') { if (State.CONFIG.github_user) window.location.href = 'https://github.com/' + State.CONFIG.github_user; else window.location.href = 'https://github.com'; return; }

            if (cmdLower === 'gcal' || cmdLower === 'calendar') { window.location.href = 'https://calendar.google.com'; return; }
            if (cmdLower === 'gtasks' || cmdLower === 'tasks') { window.location.href = 'https://tasks.google.com'; return; }
            if (cmdLower === 'gmail' || cmdLower === 'email') { window.location.href = 'https://mail.google.com'; return; }
            if (cmdLower === 'gdrive' || cmdLower === 'drive') { window.location.href = 'https://drive.google.com'; return; }
            if (cmdLower === 'gdocs' || cmdLower === 'docs') { window.location.href = 'https://docs.google.com'; return; }

            if (cmdLower === 'yt') { window.location.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query); return; }

            if (cmdLower === 'roll' || cmdLower === 'dice') { 
                // showNotification("DICE ROLLED: " + (Math.floor(Math.random() * 6) + 1)); 
                input.value = ''; return; 
            }
            if (cmdLower === 'coin' || cmdLower === 'flip') { 
                // showNotification("COIN FLIP: " + (Math.random() > 0.5 ? "HEADS" : "TAILS")); 
                input.value = ''; return; 
            }
            if (cmdLower === 'quote') { 
                // showNotification(QUOTES[Math.floor(Math.random() * QUOTES.length)]); 
                input.value = ''; return; 
            }
            
            if (cmdLower === 'calc') {
                if (window.safeCalculate) {
                   var result = window.safeCalculate(query);
                   // showNotification("RESULT: " + result);
                }
                input.value = '';
                return;
            }

            if (cmdLower === 'b') {
                if (query && currentSuggestions.length > 0) {
                    var selectedMatch = currentSuggestions[0];
                    if (selectedMatch.type === 'folder') {
                        if (window.NAV_STACK) window.NAV_STACK.push(State.CURRENT_BOOKMARK_FOLDER);
                        if (window.renderBottomBar) window.renderBottomBar(selectedMatch.id);
                        input.value = '';
                        return;
                    } else if (selectedMatch.url) {
                        window.location.href = selectedMatch.url;
                        return;
                    }
                }
                if (query) raw = query; else return;
            }

            var custom = null;
            if (State.CONFIG.custom_commands && Array.isArray(State.CONFIG.custom_commands)) {
                custom = State.CONFIG.custom_commands.find(function (c) { return c.trigger === cmdLower; });
            }
            if (custom) {
                if (custom.url.startsWith('sys:')) {
                    var sysAction = custom.url.split(':')[1];
                    if (sysAction === 'note') addNote(query);
                    else if (sysAction === 'task') { if (window.addTask) window.addTask(query); }
                    input.value = '';
                    return;
                }
                window.location.href = custom.url;
                return;
            }

            if (raw.startsWith('http://') || raw.startsWith('https://')) { window.location.href = raw; return; }

            var searchUrl;
            var engine = State.CONFIG.search_engine || 'google';
            switch (engine) {
                case 'ddg': searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(raw); break;
                case 'bing': searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(raw); break;
                case 'brave': searchUrl = 'https://search.brave.com/search?q=' + encodeURIComponent(raw); break;
                case 'perplexity': searchUrl = 'https://www.perplexity.ai/search?q=' + encodeURIComponent(raw); break;
                case 'chatgpt': searchUrl = 'https://chat.openai.com/?q=' + encodeURIComponent(raw); break;
                case 'youtube': searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(raw); break;
                default: searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
            }
            window.location.href = searchUrl;
        }
    },

    addToHistory: function(cmd) {
        if (!cmd || !cmd.trim()) return;
        if (State.COMMAND_HISTORY.length > 0 && State.COMMAND_HISTORY[State.COMMAND_HISTORY.length - 1] === cmd) return;
        State.COMMAND_HISTORY.push(cmd);
        if (State.COMMAND_HISTORY.length > 50) State.COMMAND_HISTORY = State.COMMAND_HISTORY.slice(-50);
        saveData();
    },

    showHistory: function() {
        var modal = document.getElementById('history-modal');
        var list = document.getElementById('history-list');
        if (!modal || !list) return;

        list.innerHTML = '';
        if (State.COMMAND_HISTORY.length === 0) {
            list.innerHTML = '<div style="color:#555; padding:10px;">No history yet.</div>';
        } else {
            State.COMMAND_HISTORY.slice(-20).reverse().forEach(function (cmd) {
                var div = document.createElement('div');
                div.style.cssText = 'padding:10px; border-bottom:1px solid #222; color:#888; font-size:0.85rem; cursor:pointer;';
                div.textContent = cmd;
                div.onclick = function () {
                    var input = document.getElementById('cmd-input');
                    if (input) input.value = cmd;
                    modal.style.display = 'none';
                    if (input) input.focus();
                };
                list.appendChild(div);
            });
        }
        modal.style.display = 'block';
    }
};
