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
        this.showDefaultHint();
    },

    showDefaultHint: function() {
        const hintBox = document.getElementById('command-hint');
        if (!hintBox) return;
        hintBox.innerHTML = '<span class="hint-syntax">Try:</span> task &lt;text&gt; · pomo 25 · note &lt;title&gt; · daily · help';
        hintBox.style.display = 'block';
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
            this.showDefaultHint();
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
        
        let allSuggestions = [];

        // 1. Add Bookmark suggestions if B command (V101: Priority)
        if (State.CONFIG.show_bookmarks && query.toLowerCase().startsWith('b ')) {
             const fullQuery = query.slice(2).trim();
             let bmQuery = fullQuery.toLowerCase();
             let parentFolder = null;

             // Path-based navigation: "b Folder/SubQuery"
             if (fullQuery.includes('/')) {
                 const parts = fullQuery.split('/');
                 const folderName = parts[0].trim().toLowerCase();
                 bmQuery = parts.slice(1).join('/').trim().toLowerCase();
                 
                 // Find the folder
                 parentFolder = (State.FLAT_BOOKMARKS || []).find(b => 
                    b.type === 'folder' && b.title.toLowerCase() === folderName
                 );
             }

             const bmMatches = (State.FLAT_BOOKMARKS || []).filter(b => {
                const matchesText = b.title.toLowerCase().includes(bmQuery) || (b.url && b.url.toLowerCase().includes(bmQuery));
                if (parentFolder) {
                    return b.parentId === parentFolder.id && matchesText;
                }
                return matchesText;
             }).slice(0, 5);
             
             bmMatches.forEach(bm => {
                 allSuggestions.push({ type: 'bookmark', data: bm });
             });
        }

        // 2. Add Command suggestions
        matches.slice(0, 5).forEach(cmd => {
            allSuggestions.push({ type: 'command', data: cmd });
        });

        if (allSuggestions.length === 0) {
            box.style.display = 'none';
            currentSuggestions = [];
            return;
        }

        // 3. Render unified list
        allSuggestions.forEach((s, idx) => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            
            if (s.type === 'bookmark') {
                const isFolder = s.data.type === 'folder';
                const badge = isFolder ? 'FOLDER' : 'BOOKMARK';
                const icon = isFolder ? '📁 ' : '';
                div.innerHTML = `<span>${icon}${safeText(s.data.title)}</span><span class="type-badge">${badge}</span>`;
                
                div.onclick = () => { 
                    if (isFolder) {
                        const input = document.getElementById('cmd-input');
                        input.value = `b ${s.data.title}/`;
                        input.focus();
                        this.handleInput({ target: input }); // Refresh suggestions
                    } else {
                        window.location.href = s.data.url; 
                    }
                };
            } else {
                const cmd = s.data;
                div.innerHTML = `
                    <span class="cmd-trigger" style="color:#fff; font-weight:bold;">${cmd.trigger}</span>
                    <span class="cmd-title" style="color:#888;"> - ${cmd.title}</span>
                `;
                div.onclick = () => {
                    if (cmd.hint) {
                        const input = document.getElementById('cmd-input');
                        input.value = cmd.trigger + ' ';
                        input.focus();
                    } else {
                        this.execute(cmd, '');
                    }
                };
            }
            box.appendChild(div);
        });
        
        box.style.display = 'block';
        currentSuggestions = allSuggestions; 
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
                const s = currentSuggestions[suggestionIndex];
                if (s.type === 'bookmark') {
                    if (s.data.type === 'folder') {
                        input.value = `b ${s.data.title}/`;
                        this.handleInput({ target: input });
                        return;
                    }
                    window.location.href = s.data.url;
                    return;
                }
                const cmd = s.data;
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
        
        this.showDefaultHint();
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
                div.style.cssText = 'padding:10px; border-bottom:1px solid #333; color:#aaa; font-size:0.85rem; cursor:pointer; font-family:var(--font-primary); transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.2s cubic-bezier(0.2, 0, 0, 1), padding-left 0.2s cubic-bezier(0.2, 0, 0, 1);';
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
