import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { ModalManager } from '../ui/ModalManager.js';
import { safeText } from '../core/Utils.js';
import { CommandRegistry } from '../core/CommandRegistry.js';



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
        if (localStorage.getItem('VINLAND_CLI_HINTS_DISMISSED') === '1') return;
        const text = document.getElementById('command-hint-text');
        if (text) text.innerHTML = '<span class="hint-syntax">Try:</span> task &lt;text&gt; · pomo 25 · note &lt;title&gt; · daily · help';
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

        // 1. Search Registry (now returns scored results)
        const matches = CommandRegistry.search(val);
        
        // 2. Render Suggestions
        this.renderSuggestions(matches, val);

        // 3. Render Hint (if exact trigger match found)
        // matches is now array of { command, score, ... }
        var exactMatch = null;
        for (var i = 0; i < matches.length; i++) {
            if (val.toLowerCase().startsWith(matches[i].command.trigger)) {
                exactMatch = matches[i].command;
                break;
            }
        }
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

        // 2. Add Command suggestions (up to 5, already scored & sorted by CommandRegistry)
        for (var mi = 0; mi < Math.min(matches.length, 5); mi++) {
            allSuggestions.push({ type: 'command', data: matches[mi] });
        }

        if (allSuggestions.length === 0) {
            box.style.display = 'none';
            currentSuggestions = [];
            return;
        }

        // 3. Render unified list
        for (var idx = 0; idx < allSuggestions.length; idx++) {
            var s = allSuggestions[idx];
            var div = document.createElement('div');
            div.className = 'suggestion-item';
            
            if (s.type === 'bookmark') {
                var isFolder = s.data.type === 'folder';
                var badge = isFolder ? 'FOLDER' : 'BOOKMARK';
                var icon = isFolder ? '📁 ' : '';
                div.innerHTML = '<span>' + icon + safeText(s.data.title) + '</span><span class="type-badge">' + badge + '</span>';
                
                div.onclick = (function(data) {
                    return function() {
                        if (data.type === 'folder') {
                            var input = document.getElementById('cmd-input');
                            input.value = 'b ' + data.title + '/';
                            input.focus();
                            CommandLine.handleInput({ target: input });
                        } else {
                            window.location.href = data.url;
                        }
                    };
                })(s.data);
            } else {
                var result = s.data; // { command, score, matchField, matchedIndices, isExactArg }
                var cmd = result.command;
                var displayText = result.matchField === 'trigger' ? cmd.trigger : cmd.title;
                
                // Build trigger title with matched character highlighting
                var triggerHtml = '';
                var fieldText = cmd.trigger;
                if (result.matchedIndices && result.matchedIndices.length > 0 && result.matchField === 'trigger') {
                    for (var ci = 0; ci < fieldText.length; ci++) {
                        if (result.matchedIndices[ci]) {
                            triggerHtml += '<span class="match-highlight">' + safeText(fieldText[ci]) + '</span>';
                        } else {
                            triggerHtml += safeText(fieldText[ci]);
                        }
                    }
                } else {
                    triggerHtml = safeText(fieldText);
                }
                
                // Build title with matched character highlighting
                var titleHtml = '';
                var titleText = cmd.title;
                if (result.matchedIndices && result.matchedIndices.length > 0 && result.matchField === 'title') {
                    for (var ci2 = 0; ci2 < titleText.length; ci2++) {
                        if (result.matchedIndices[ci2]) {
                            titleHtml += '<span class="match-highlight">' + safeText(titleText[ci2]) + '</span>';
                        } else {
                            titleHtml += safeText(titleText[ci2]);
                        }
                    }
                } else {
                    titleHtml = safeText(titleText);
                }
                
                // Match quality label (color-coded, numbers are internal and opaque to users)
                var scoreLabel = result.score >= 70 ? 'BEST' : result.score >= 40 ? 'CLOSE' : 'WEAK';
                var scoreClass = 'score-' + (result.score >= 70 ? 'high' : result.score >= 40 ? 'med' : 'low');
                div.innerHTML = '<span class="cmd-trigger" style="color:#fff;font-weight:bold;">' + triggerHtml + '</span>' +
                    '<span class="cmd-title" style="color:#888;"> - ' + titleHtml + '</span>' +
                    '<span class="type-badge score-badge ' + scoreClass + '">' + scoreLabel + '</span>';
                
                div.onclick = (function(cmd, result) {
                    return function() {
                        if (cmd.hint && !result.isExactArg) {
                            var input = document.getElementById('cmd-input');
                            input.value = cmd.trigger + ' ';
                            input.focus();
                        } else {
                            CommandLine.execute(cmd, '');
                        }
                    };
                })(cmd, result);
            }
            box.appendChild(div);
        }
        
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
                const cmd = s.data.command;
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
            // visual feedback
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

        // First command executed: dismiss the first-run CLI hints.
        if (window.dismissCliHints) window.dismissCliHints();
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
