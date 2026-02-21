import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { saveConfig } from '../core/Config.js';
import { ModalManager } from '../ui/ModalManager.js';
import { Notes, clearNotes, toggleNotesPanel, renderNotes } from '../modules/NotesController.js';
import { safeText } from '../core/Utils.js';
import { CommandRegistry } from '../core/CommandRegistry.js';

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
        const val = e.target.value;
        const suggestionsBox = document.getElementById('suggestions');
        const hintBox = document.getElementById('command-hint');
        
        if (!val.trim()) {
            suggestionsBox.style.display = 'none';
            if (hintBox) hintBox.style.display = 'none';
            return;
        }

        // 1. Search Registry
        const matches = CommandRegistry.search(val);
        
        // 2. Render Suggestions
        this.renderSuggestions(matches, val);

        // 3. Render Hint (if exact trigger match found)
        const exactMatch = matches.find(m => val.toLowerCase().startsWith(m.trigger));
        if (exactMatch && exactMatch.hint && hintBox) {
            hintBox.innerHTML = `<span class="hint-syntax">${safeText(exactMatch.trigger)} ${safeText(exactMatch.hint)}</span>`;
            hintBox.style.display = 'block';
        } else if (hintBox) {
            hintBox.style.display = 'none';
        }
    },

    renderSuggestions: function(matches, query) {
        const box = document.getElementById('suggestions');
        if (!box) return;
        box.innerHTML = '';
        suggestionIndex = -1;
        
        // Add Bookmark suggestions if B command
        if (State.CONFIG.show_bookmarks && query.toLowerCase().startsWith('b ') && query.length > 2) {
             const bmQuery = query.slice(2).toLowerCase();
             const bmMatches = (State.FLAT_BOOKMARKS || []).filter(b => b.title.toLowerCase().includes(bmQuery)).slice(0, 5);
             if (bmMatches.length > 0) {
                 bmMatches.forEach((bm, idx) => {
                     const div = document.createElement('div');
                     div.className = 'suggestion-item';
                     div.innerHTML = `<span>Example: ${safeText(bm.title)}</span><span class="type-badge">BOOKMARK</span>`;
                     div.onclick = () => { window.location.href = bm.url; };
                     box.appendChild(div);
                 });
                 // Return to avoid mixing? actually we can mix, but let's keep simple
             }
        }

        if (matches.length === 0) {
            if (box.children.length === 0) box.style.display = 'none';
            else box.style.display = 'block'; // Keep showing bookmarks if any
            return;
        }

        matches.slice(0, 5).forEach((cmd, idx) => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            // Highlight matching part
            div.innerHTML = `
                <span class="cmd-trigger" style="color:#fff; font-weight:bold;">${cmd.trigger}</span>
                <span class="cmd-title" style="color:#888;"> - ${cmd.title}</span>
            `;
            div.onclick = () => {
                // If command accepts args, autocomplete it
                if (cmd.hint) {
                    const input = document.getElementById('cmd-input');
                    input.value = cmd.trigger + ' ';
                    input.focus();
                } else {
                    this.execute(cmd, '');
                }
            };
            box.appendChild(div);
        });
        
        box.style.display = 'block';
        currentSuggestions = matches; // Store for arrow nav
    },

    handleKeydown: function(e) {
        const input = document.getElementById('cmd-input');
        const box = document.getElementById('suggestions');
        const items = box.querySelectorAll('.suggestion-item');
        
        // Arrow Navigation
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length === 0) {
                // History Nav Fallback
                if (State.COMMAND_HISTORY.length > 0) {
                    if (e.key === 'ArrowUp') {
                        if (historyIndex === -1) historyIndex = State.COMMAND_HISTORY.length - 1;
                        else if (historyIndex > 0) historyIndex--;
                        input.value = State.COMMAND_HISTORY[historyIndex] || '';
                    } else {
                         if (historyIndex !== -1 && historyIndex < State.COMMAND_HISTORY.length - 1) {
                            historyIndex++;
                            input.value = State.COMMAND_HISTORY[historyIndex] || '';
                        } else {
                            historyIndex = -1;
                            input.value = '';
                        }
                    }
                }
                return;
            }
            
            if (suggestionIndex > -1 && items[suggestionIndex]) items[suggestionIndex].classList.remove('active');
            
            if (e.key === 'ArrowDown') {
                suggestionIndex = suggestionIndex < items.length - 1 ? suggestionIndex + 1 : 0;
            } else {
                suggestionIndex = suggestionIndex > 0 ? suggestionIndex - 1 : items.length - 1;
            }
            
            if (items[suggestionIndex]) {
                items[suggestionIndex].classList.add('active');
                items[suggestionIndex].scrollIntoView({ block: 'nearest' });
            }
            return;
        }

        if (e.key === 'Enter') {
            // Suggestion Selection
            if (suggestionIndex >= 0 && currentSuggestions[suggestionIndex]) {
                e.preventDefault();
                const cmd = currentSuggestions[suggestionIndex];
                if (cmd.hint && !input.value.includes(' ')) {
                     input.value = cmd.trigger + ' '; // Autocomplete trigger
                     return;
                }
                this.execute(cmd, '');
                return;
            }

            const raw = input.value.trim();
            if (!raw) return;
            
            // Execute logic
            // 1. Split Trigger vs Args
            // Handle "task buy milk" -> trigger="task", args="buy milk"
            // Handle "clear done" -> trigger="clear done", args=""
            
            let bestCmd = null;
            let bestArgs = '';
            
            // Sort matches by length desc to capture "clear done" before "clear"
            const matches = CommandRegistry.commands.filter(c => raw.toLowerCase().startsWith(c.trigger));
            matches.sort((a,b) => b.trigger.length - a.trigger.length);
            
            if (matches.length > 0) {
                bestCmd = matches[0];
                bestArgs = raw.substring(bestCmd.trigger.length).trim();
            }
            
            if (bestCmd) {
                this.execute(bestCmd, bestArgs);
            } else {
                // Fallback: Google Search or Custom
                // Check custom commands first
                const custom = (State.CONFIG.custom_commands || []).find(c => c.trigger === raw.split(' ')[0].toLowerCase());
                if (custom) {
                    if (custom.url.startsWith('sys:')) {
                        // legacy format support?
                    } else {
                        window.location.href = custom.url;
                    }
                } else if (raw.startsWith('http')) {
                    window.location.href = raw;
                } else {
                    // Search Engine
                    let searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
                     var engine = State.CONFIG.search_engine || 'google';
                    switch (engine) {
                        case 'ddg': searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(raw); break;
                        case 'bing': searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(raw); break;
                        case 'brave': searchUrl = 'https://search.brave.com/search?q=' + encodeURIComponent(raw); break;
                        case 'perplexity': searchUrl = 'https://www.perplexity.ai/search?q=' + encodeURIComponent(raw); break;
                        case 'chatgpt': searchUrl = 'https://chat.openai.com/?q=' + encodeURIComponent(raw); break;
                        case 'youtube': searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(raw); break;
                    }
                    window.location.href = searchUrl;
                }
            }
        }
    },

    execute: function(cmd, args) {
        const input = document.getElementById('cmd-input');
        
        console.log(`[CLI] Executing ${cmd.id} with args: "${args}"`);
        try {
            cmd.action(args);
            // V105: visual feedback
             if (window.showNotification) showNotification(`COMMAND: ${cmd.title}`);
        } catch(e) {
            console.error(e);
            if (window.showNotification) showNotification(`ERROR: ${e.message}`, 'error');
        }
        
        // Cleanup
        input.value = '';
        const sBox = document.getElementById('suggestions');
        if(sBox) sBox.style.display = 'none';
        
        const hBox = document.getElementById('command-hint');
        if(hBox) hBox.style.display = 'none';
        
        // Save to history
        this.addToHistory(cmd.trigger + (args ? ' ' + args : ''));
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

        // Bind Close Button
        var closeBtn = modal.querySelector('.close-modal');
        if(closeBtn) {
            closeBtn.onclick = function() {
                ModalManager.close('history-modal');
            };
        }

        // Bind Overlay Click
        modal.onclick = function(e) {
            if (e.target === modal) {
                ModalManager.close('history-modal');
            }
        };

        list.innerHTML = '';
        if (State.COMMAND_HISTORY.length === 0) {
            list.innerHTML = '<div style="color:#555; padding:10px;">No history yet.</div>';
        } else {
            State.COMMAND_HISTORY.slice(-20).reverse().forEach(function (cmd) {
                var div = document.createElement('div');
                div.className = 'history-item';
                div.style.cssText = 'padding:10px; border-bottom:1px solid #333; color:#aaa; font-size:0.85rem; cursor:pointer; font-family:var(--font-primary); transition: all 0.2s;';
                div.textContent = cmd;
                
                div.onmouseover = function() { 
                    this.style.backgroundColor = 'rgba(255,255,255,0.05)'; 
                    this.style.color = 'var(--main-color)'; 
                    this.style.paddingLeft = '15px';
                };
                div.onmouseout = function() { 
                    this.style.backgroundColor = 'transparent'; 
                    this.style.color = '#aaa'; 
                    this.style.paddingLeft = '10px';
                };
                
                div.onclick = function () {
                    var input = document.getElementById('cmd-input');
                    if (input) input.value = cmd;
                    ModalManager.close('history-modal');
                    if (input) input.focus();
                };
                list.appendChild(div);
            });
        }
        
        ModalManager.open('history-modal');
    }
};
