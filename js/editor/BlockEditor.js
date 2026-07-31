import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { PageManager } from './PageManager.js';
import { ModalManager } from '../ui/ModalManager.js';

/* =========================================
   HISTORY MANAGER (Undo/Redo)
   ========================================= */
export const HistoryManager = {
    stack: [],
    redoStack: [],
    limit: 50,
    
    push: function(pageId) {
        var page = State.NOTES.find(function(n) { return n.id === pageId; });
        if (!page) return;
        var snapshot = JSON.parse(JSON.stringify(page.blocks));
        this.stack.push({ pageId: pageId, blocks: snapshot });
        if (this.stack.length > this.limit) this.stack.shift();
        this.redoStack = [];
    },

    undo: function() {
        if (this.stack.length === 0) return;
        var state = this.stack.pop();
        var page = State.NOTES.find(function(n) { return n.id === state.pageId; });
        if (page) {
            this.redoStack.push({ pageId: page.id, blocks: JSON.parse(JSON.stringify(page.blocks)) });
            page.blocks = state.blocks;
            page.modified = Date.now();
            saveData();
            if (typeof BlockEditor !== 'undefined') BlockEditor.render(page.id);
        }
    },

    redo: function() {
        if (this.redoStack.length === 0) return;
        var state = this.redoStack.pop();
        var page = State.NOTES.find(function(n) { return n.id === state.pageId; });
        if (page) {
            this.stack.push({ pageId: page.id, blocks: JSON.parse(JSON.stringify(page.blocks)) });
            page.blocks = state.blocks;
            page.modified = Date.now();
            saveData();
            if (typeof BlockEditor !== 'undefined') BlockEditor.render(page.id);
        }
    }
};

/* =========================================
   BLOCK EDITOR ENGINE
   ========================================= */

// Global Listeners
document.addEventListener('keydown', function(e) {
    if (!((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A'))) return;

    var isNotesActive = ModalManager.stack.includes('note-editor-modal');
    if (!isNotesActive) return;

    var blockEditorEl = document.getElementById('block-editor');
    if (!blockEditorEl || !blockEditorEl.contains(document.activeElement)) return;

    var now = Date.now();
    var lastA = window.BlockEditorLastCmdATime || 0;
    var timeSinceLastA = now - lastA;
    
    if (timeSinceLastA < 400) {
        e.preventDefault();
        BlockEditor.selectAll();
        window.BlockEditorLastCmdATime = 0;
    } else {
        window.BlockEditorLastCmdATime = now;
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (typeof BlockEditor === 'undefined' || !BlockEditor.selectedBlockIds || BlockEditor.selectedBlockIds.length === 0) return;
    
    var isNotesActive = ModalManager.stack.includes('note-editor-modal');
    if (!isNotesActive) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    BlockEditor.clearSelection();
}, true);

export const BlockEditor = {
    container: null,
    activePageId: null,
    focusedBlockId: null,
    saveTimeout: null,
    
    selectedBlockIds: [],
    isSelecting: false,
    selectionStartY: 0,
    lastSelectedId: null,

    // ─── HELPERS ───
    _getActivePage: function() {
        return State.NOTES.find(function(n) { return n.id === this.activePageId; }.bind(this));
    },

    // Helper for Callout Icons
    getCalloutIcon: function(type) {
        var icons = {
            info: 'ℹ️', warning: '⚠️', danger: '🛑', success: '✅',
            note: '📝', tip: '💡', quote: '💬'
        };
        return icons[type.toLowerCase()] || 'ℹ️';
    },

    // Helper for block-type badge labels
    _getTypeLabel: function(type) {
        var labels = {
            h1: 'H1', h2: 'H2', h3: 'H3',
            p: 'P', bullet: '∘', numbered: '1.',
            task: '☐', quote: '"', code: '</>',
            divider: '—', image: 'IMG', callout: '!!',
            kanban_ref: '≡', table: '#', query: '◇',
            embed: '📎'
        };
        return labels[type] || '?';
    },

    getCalcPreviewHtml: function(text) {
        var parts = (text || '').split('//');
        var expr = parts[0].trim();
        var result = parts.length > 1 ? parts[1].replace('=', '').trim() : '';
        
        var html = '<div class="calc-preview" style="margin:0; border:none; background:transparent; padding:0;">';
        html += '<span class="calc-expression">' + expr + '</span>';
        if (result) {
            html += '<span class="calc-arrow" style="margin:0 8px;">&rarr;</span>';
            html += '<span class="calc-result">' + result + '</span>';
        }
        return html + '</div>';
    },

    safeMathEval: function(expr) {
        var tokens = [];
        var numberBuffer = '';
        expr = expr.split('//')[0].trim();
        expr = expr.replace(/x/gi, '*').replace(/×/g, '*');
        expr = expr.replace(/÷/g, '/').replace(/:/g, '/');
        expr = expr.replace(/\s+/g, '');
        
        for (var i = 0; i < expr.length; i++) {
            var char = expr[i];
            if (/\d|\./.test(char)) {
                numberBuffer += char;
            } else {
                if (numberBuffer.length > 0) {
                    tokens.push(parseFloat(numberBuffer));
                    numberBuffer = '';
                }
                if ('+-*/^%()'.indexOf(char) !== -1) {
                    if (char === '-' && (tokens.length === 0 || typeof tokens[tokens.length - 1] === 'string' && tokens[tokens.length - 1] !== ')')) {
                        numberBuffer += '-'; 
                    } else {
                        tokens.push(char);
                    }
                }
            }
        }
        if (numberBuffer.length > 0) tokens.push(parseFloat(numberBuffer));

        var outputQueue = [];
        var operatorStack = [];
        var precedence = { '^': 4, '*': 3, '/': 3, '%': 3, '+': 2, '-': 2 };
        var associativity = { '^': 'Right', '*': 'Left', '/': 'Left', '%': 'Left', '+': 'Left', '-': 'Left' };
        var isNum = function(t) { return typeof t === 'number' && !isNaN(t); };

        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (isNum(token)) {
                outputQueue.push(token);
            } else if ('+-*/^%'.indexOf(token) !== -1) {
                while (operatorStack.length > 0) {
                    var top = operatorStack[operatorStack.length - 1];
                    if (top === '(') break;
                    if ((associativity[token] === 'Left' && precedence[token] <= precedence[top]) ||
                        (associativity[token] === 'Right' && precedence[token] < precedence[top])) {
                        outputQueue.push(operatorStack.pop());
                    } else {
                        break;
                    }
                }
                operatorStack.push(token);
            } else if (token === '(') {
                operatorStack.push(token);
            } else if (token === ')') {
                while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                    outputQueue.push(operatorStack.pop());
                }
                if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] === '(') {
                    operatorStack.pop(); 
                } else return 'Error: Mismatched parentheses';
            }
        }
        while (operatorStack.length > 0) {
            var op = operatorStack.pop();
            if (op === '(') return 'Error: Mismatched parentheses';
            outputQueue.push(op);
        }

        var evalStack = [];
        for (var i = 0; i < outputQueue.length; i++) {
            var token = outputQueue[i];
            if (isNum(token)) {
                evalStack.push(token);
            } else {
                if (evalStack.length < 2) return 'Error: Invalid expression';
                var b = evalStack.pop();
                var a = evalStack.pop();
                var res = 0;
                switch(token) {
                    case '+': res = a + b; break;
                    case '-': res = a - b; break;
                    case '*': res = a * b; break;
                    case '/': res = a / b; break;
                    case '%': res = a % b; break;
                    case '^': res = Math.pow(a, b); break;
                }
                evalStack.push(res);
            }
        }
        return evalStack.length === 1 ? evalStack[0] : 'Error: Invalid expression';
    },

    highlightSyntax: function(code, lang) {
        if (!code) return '';
        // 1. Escape HTML Entities
        var safeCode = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        if (['javascript', 'js', 'json', 'calc'].includes(lang)) {
            var tokens = [];
            var storeToken = function(match, color) {
                var key = '___TOKEN_' + tokens.length + '___';
                tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match + '</span>' });
                return key;
            };

            // 2. Protect Strings
            safeCode = safeCode.replace(/(["'`])(?:\\.|[^\\])*?\1/g, function(m) { 
                return storeToken(m, 'var(--syntax-string)'); 
            });

            // 3. Protect Comments
            safeCode = safeCode.replace(/(\/\/.*)/g, function(m) { 
                return storeToken(m, 'var(--syntax-comment)'); 
            });

            // 4. Highlight Keywords
            var keywords = 'var|let|const|function|return|if|else|for|while|class|this|async|await|export|import|from|default|switch|case|break|continue';
            var kwRegex = new RegExp('\\b(' + keywords + ')\\b', 'g');
            safeCode = safeCode.replace(kwRegex, '<span style="color:var(--syntax-keyword);">$1</span>');

            // 5. Highlight Booleans/Null
            safeCode = safeCode.replace(/\b(true|false|null|undefined)\b/g, '<span style="color:var(--syntax-boolean);">$1</span>');

            // 6. Highlight Numbers
            safeCode = safeCode.replace(/\b(\d+)\b/g, '<span style="color:var(--syntax-number);">$1</span>');

            // 7. Restore Tokens
            tokens.forEach(function(token) {
                safeCode = safeCode.replace(token.key, token.value);
            });
        } else if (window.CodeBlockTools && ['python', 'html', 'css', 'bash'].includes(lang)) {
            safeCode = window.CodeBlockTools._extendedHighlight(code, lang);
        }
        
        // Wiki Link Highlighting (Global)
        // This runs AFTER code highlighting to ensure links work even in mixed content
        // Pattern: [[Note Title]] or [[Note Title|Display]]
        safeCode = safeCode.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function(match, noteTitle, displayText) {
            displayText = displayText || noteTitle;
            return '<span class="wiki-link" data-note-title="' + noteTitle.trim() + '">' + displayText.trim() + '</span>';
        });

        return safeCode;
    },

    // ─── FORMATTING & TRANSLATION ───

    // Converts raw DOM HTML (generated by execCommand or paste) into Vinland Markdown
    htmlToMarkdown: function(html) {
        if (!html) return '';
        var md = html;
        
        // 1. Line breaks
        md = md.replace(/<div><br><\/div>/gi, '\n');
        md = md.replace(/<br\s*\/?>/gi, '\n');
        md = md.replace(/<div>/gi, '\n');
        md = md.replace(/<\/div>/gi, '');
        md = md.replace(/<p>/gi, '\n');
        md = md.replace(/<\/p>/gi, '');
        
        // 2. Bold
        md = md.replace(/<b(\s+[^>]+)?>/gi, '**');
        md = md.replace(/<\/b>/gi, '**');
        md = md.replace(/<strong(\s+[^>]+)?>/gi, '**');
        md = md.replace(/<\/strong>/gi, '**');
        
        // 3. Italic
        md = md.replace(/<i(\s+[^>]+)?>/gi, '*');
        md = md.replace(/<\/i>/gi, '*');
        md = md.replace(/<em(\s+[^>]+)?>/gi, '*');
        md = md.replace(/<\/em>/gi, '*');
        
        // 4. Underline (Vinland uses raw HTML for underline)
        md = md.replace(/<u(\s+[^>]+)?>/gi, '<u>');
        md = md.replace(/<\/u>/gi, '</u>');
        
        // 5. Links
        // Extract href from anchor tags and format as [text](url)
        var anchorRegex = /<a[^>]+href="(.*?)"[^>]*>(.*?)<\/a>/gi;
        md = md.replace(anchorRegex, '[$2]($1)');
        
        // 6. Decode entities last (except for those needed by formatting)
        md = md.replace(/&nbsp;/g, ' ');
        md = md.replace(/&amp;/g, '&');
        md = md.replace(/&lt;/g, '<');
        md = md.replace(/&gt;/g, '>');
        
        return md;
    },

    // Bi-directional WYSIWYG Translator
    // Converts Vinland Markdown from the DB into raw DOM HTML for the WYSIWYG Editor
    markdownToHtml: function(md) {
        if (!md) return '';
        var html = md;
        
        // 1. Encode specific HTML entities to prevent XSS while allowing styling
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // 2. Bold (**text**)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        
        // 3. Italic (*text*)
        html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
        
        // 4. Underline (<u>text</u>) -> Already escaped by step 1, so unescape them
        html = html.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>');
        
        // 5. Links ([text](url))
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="external-link">$1</a>');
        
        return html;
    },

    // ─── SELECTION & FORMATTING ───

    setSelectionOffsets: function (el, start, end) {
        // If textarea (legacy fallback)
        if (el.tagName === 'TEXTAREA') {
            el.focus();
            el.selectionStart = start;
            el.selectionEnd = end;
            return;
        }

        el.focus();
        var sel = window.getSelection();
        var range = document.createRange();
        
        // Traverse variables
        var charCount = 0;
        var startNode = null, startOffset = 0;
        var endNode = null, endOffset = 0;
        var foundStart = false, foundEnd = false;

        function traverse(node) {
            if (node.nodeType === 3) { // Text node
                var nextCharCount = charCount + node.length;
                if (!foundStart && start >= charCount && start <= nextCharCount) {
                    startNode = node;
                    startOffset = start - charCount;
                    foundStart = true;
                }
                if (!foundEnd && end >= charCount && end <= nextCharCount) {
                    endNode = node;
                    endOffset = end - charCount;
                    foundEnd = true;
                }
                charCount = nextCharCount;
            } else {
                for (var i = 0; i < node.childNodes.length; i++) {
                    traverse(node.childNodes[i]);
                }
            }
        }
        
        traverse(el);
        
        // Fallback for empty or edge cases
        if (!startNode || !endNode) {
             // Try to just set to end if we failed logic
             return;
        }

        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    // Restored WYSIWYG Formatting via execCommand
    // Now that handleInput parses innerHTML to Markdown, we can use native browser formatting
    // for immediate visual feedback without breaking the database.
    applyFormatting: function(key) {
        var targetEl = document.activeElement;
        var blockWrapper = targetEl ? targetEl.closest('.block-wrapper') : null;
        if (!blockWrapper) return;
        
        var contentEl = targetEl && targetEl.getAttribute('contenteditable') === 'true' ? targetEl : null;
        if (!contentEl) return;
        
        switch (key) {
            case 'b': 
                document.execCommand('bold', false, null); 
                break;
            case 'i': 
                document.execCommand('italic', false, null); 
                break;
            case 'u': 
                document.execCommand('underline', false, null); 
                break;
            case 'k':
                var url = prompt('Enter URL:', 'https://');
                if (url) {
                    document.execCommand('createLink', false, url);
                    // Add external-link class for visual consistency
                    var sel = window.getSelection();
                    if (sel.rangeCount > 0) {
                        var node = sel.anchorNode.parentNode;
                        if (node.tagName === 'A') node.className = 'external-link';
                    }
                }
                break;
            case 'l':
                // Wiki Link Injection logic (retained)
                var sel = window.getSelection();
                if (!sel.rangeCount) return;
                var range = sel.getRangeAt(0);
                var selectedText = range.toString() || 'New Note';
                document.execCommand('insertHTML', false, `[[${selectedText}]]`);
                break;
            default: return;
        }

        // Trigger input event to immediately translate the HTML to Markdown
        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
        contentEl.dispatchEvent(inputEvent);
    },

    // ─── LIFECYCLE ───
    init: function (containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        // Listen on document to catch keys even when focus is lost (e.g. after drag-select blur)
        document.addEventListener('keydown', function(e) {
            if (self.container && self.container.offsetParent !== null) {
                self.handleKeydown(e);
            }
        });
        this.container.addEventListener('input', this.handleInput.bind(this));
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.container.addEventListener('paste', this.handlePaste.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
        
        this.container.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        var self = this;
        
        // 🛡️ FIX 3: Clear selection when clicking outside the editor container
        document.addEventListener('mousedown', function(e) {
            if (self.selectedBlockIds.length > 0 && self.container && !self.container.contains(e.target)) {
                self.clearSelection();
            }
        });

        this.container.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            var blockEl = e.target.closest('.block-wrapper');
            if (e.shiftKey && blockEl) {
                e.preventDefault();
                var blockId = blockEl.getAttribute('data-block-id');
                if (!self.lastSelectedId) self.selectBlock(blockId, false);
                else self.selectRange(blockId);
                return;
            }
            if ((e.metaKey || e.ctrlKey) && blockEl) {
                e.preventDefault();
                var blockId = blockEl.getAttribute('data-block-id');
                self.selectBlock(blockId, true);
                return;
            }
            if (blockEl && !e.target.closest('.block-content, .task-text, .code-inner, .image-caption, input, .block-action-btn, .table-cell')) {
                var blockId = blockEl.getAttribute('data-block-id');
                
                // Drag Handle Logic (Notion-Style)
                // 1. Did they click the Drag Handle?
                if (e.target.closest('.block-drag-handle')) {
                    // Select the block visually, but DO NOT focus the text cursor
                    self.selectBlock(blockId, false);
                    self.lastSelectedId = blockId;
                    
                    // Blur any active text input so the block is purely "selected"
                    if (document.activeElement && self.container.contains(document.activeElement)) {
                        document.activeElement.blur();
                    }
                    // Do not preventDefault here, so the HTML5 Drag starts naturally
                    return; 
                }

                // 2. Did they click the empty padding/wrapper?
                // Allow multi-select if modifier or already selected
                if (self.selectedBlockIds.length > 1 && self.selectedBlockIds.includes(blockId)) return;
                
                self.selectBlock(blockId, false);
                self.lastSelectedId = blockId;
                
                // Auto-focus the text because they clicked the general block area
                self.focusBlock(blockId);
                e.preventDefault(); 
                return;
            }
            if (!blockEl) {
                self.clearSelection();
                self.isSelecting = true;
                var containerRect = self.container.getBoundingClientRect();
                self.selectionStartX = e.clientX - containerRect.left;
                self.selectionStartY = e.clientY - containerRect.top + self.container.scrollTop;
                
                var box = document.createElement('div');
                box.className = 'block-selection-box';
                box.id = 'block-selection-box';
                box.style.left = self.selectionStartX + 'px';
                box.style.top = self.selectionStartY + 'px';
                box.style.width = '0px';
                box.style.height = '0px';
                self.container.appendChild(box);
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (!self.isSelecting || !self.container) return;
            var box = document.getElementById('block-selection-box');
            if (!box) return;
            
            var containerRect = self.container.getBoundingClientRect();
            var currentX = e.clientX - containerRect.left;
            var currentY = e.clientY - containerRect.top + self.container.scrollTop;
            
            var left = Math.min(self.selectionStartX, currentX);
            var top = Math.min(self.selectionStartY, currentY);
            var width = Math.abs(currentX - self.selectionStartX);
            var height = Math.abs(currentY - self.selectionStartY);
            
            box.style.left = left + 'px';
            box.style.top = top + 'px';
            box.style.width = width + 'px';
            box.style.height = height + 'px';
            
            var selectionRect = { left: left, top: top, right: left + width, bottom: top + height };
            self.selectedBlockIds = [];
            var blocks = self.container.querySelectorAll('.block-wrapper');
            blocks.forEach(function(block) {
                var blockRect = block.getBoundingClientRect();
                var blockTop = blockRect.top - containerRect.top + self.container.scrollTop;
                var blockBottom = blockRect.bottom - containerRect.top + self.container.scrollTop;
                if (blockBottom > selectionRect.top && blockTop < selectionRect.bottom) {
                    self.selectedBlockIds.push(block.getAttribute('data-block-id'));
                }
            });
            self.updateSelectionVisuals();
        });

        document.addEventListener('mouseup', function(e) {
            if (!self.isSelecting) return;
            self.isSelecting = false;
            var box = document.getElementById('block-selection-box');
            if (box) box.remove();
            if (self.selectedBlockIds.length > 0) {
                self.lastSelectedId = self.selectedBlockIds[0];
                if (document.activeElement && self.container.contains(document.activeElement)) document.activeElement.blur();
            }
        });
    },

    processImageFile: function (file) {
        var self = this;
        var reader = new FileReader();
        reader.onload = function (e) {
            var dataUrl = e.target.result;
            var note = State.NOTES.find(function(n) { return n.id === self.activePageId; });
            if (note) {
                var newBlock = PageManager.addBlock(note, 'image', dataUrl, self.focusedBlockId);
                self.render(self.activePageId);
                PageManager.syncContent(self.activePageId);
                saveData();
                if (newBlock) self.focusedBlockId = newBlock.id;
            }
        };
        reader.readAsDataURL(file);
    },

    // ─── DROP HANDLING ───
    handleDrop: function (e) {
        var files = e.dataTransfer.files;
        if (files && files.length > 0) {
            var hasImage = false;
            for (var i = 0; i < files.length; i++) {
                if (files[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.processImageFile(files[i]);
                    hasImage = true;
                }
            }
            if (hasImage) return;
        }
    },

    // ─── RENDERING ───
    render: function (pageId, skipFocus) {
        this.activePageId = pageId;
        var page = State.NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return;

        this.container.innerHTML = '';
        if (!page.blocks || page.blocks.length === 0) PageManager.addBlock(page, 'p', '');

        var self = this;
        var listCounter = 0;

        page.blocks.forEach(function (block) {
            // Smart Numbering Logic (Match PageManager generator)
            if (block.type === 'numbered') {
                listCounter++;
                block._tempIndex = listCounter;
            } else {
                listCounter = 0; // Reset on break
                block._tempIndex = null;
            }

            var el = self.renderBlock(block);
            self.container.appendChild(el);
        });

        // Initialize find bar once
        if (!this._findBarInitialized) {
            this._findBarInitialized = true;
            this._initFindBar();
        }

        // Update stats
        this._updateStats(page);

        // Render local graph
        this._renderLocalGraph(pageId);

        // Apply find highlights if find mode is active
        if (this._findState.query) {
            var self = this;
            setTimeout(function() {
                self._findApplyHighlights();
                self._findUpdateCurrentHighlight();
            }, 10);
        }

        if (this.focusedBlockId && !skipFocus) this.focusBlock(this.focusedBlockId);
    },
    
    _updateStats: function(page) {
        if (!page || !page.blocks) return;
        var totalWords = 0;
        var totalChars = 0;
        var blockCount = page.blocks.length;

        page.blocks.forEach(function(b) {
            if (b.content) {
                totalChars += b.content.length;
                var words = b.content.trim() ? b.content.trim().split(/\s+/).length : 0;
                totalWords += words;
            }
        });

        var rawReadTime = Math.round(totalWords / 200);

        var wordEl = document.getElementById('stat-word-count');
        var charEl = document.getElementById('stat-char-count');
        var blockEl = document.getElementById('stat-block-count');
        var timeEl = document.getElementById('stat-reading-time');
        var editedEl = document.getElementById('stat-last-edited');

        if (wordEl) wordEl.textContent = totalWords.toLocaleString() + ' words';
        if (charEl) charEl.textContent = totalChars.toLocaleString() + ' chars';
        if (blockEl) blockEl.textContent = blockCount + ' block' + (blockCount !== 1 ? 's' : '');
        if (timeEl) timeEl.textContent = (rawReadTime > 0 ? rawReadTime : '<1') + ' min read';
        if (editedEl) {
            var modified = page.modified;
            var created = page.created;
            if (modified) {
                var d = new Date(modified);
                editedEl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            } else if (created) {
                var d = new Date(created);
                editedEl.textContent = 'Created ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            } else {
                editedEl.textContent = '--';
            }
        }
    },

    duplicateBlock: function(blockId) {
        HistoryManager.push(this.activePageId);
        var page = State.NOTES.find(function(n) { return n.id === this.activePageId; }.bind(this));
        if (!page || !page.blocks) return;
        var idx = page.blocks.findIndex(function(b) { return b.id === blockId; });
        if (idx === -1) return;
        var newBlock = JSON.parse(JSON.stringify(page.blocks[idx]));
        newBlock.id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        page.blocks.splice(idx + 1, 0, newBlock);
        this.render(this.activePageId);
        this.focusBlock(newBlock.id);
    },

    focusBlock: function (blockId) {
        this.focusedBlockId = blockId;
        var el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-content');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .task-text');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .code-inner');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-divider-wrapper');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-image-wrapper');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-image'); // Fallback
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .kanban-hud-wrapper');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-table');
        if (!el) el = this.container.querySelector('[data-block-id="' + blockId + '"] .block-embed');
        if (el) {
            el.focus();
            var range = document.createRange();
            var sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    },

    // ─── LOCAL GRAPH ───

    _renderLocalGraph: function(noteId) {
        if (typeof d3 === 'undefined') return;
        // Stop previous simulation to prevent CPU leak on re-render
        if (this._localGraphSim) this._localGraphSim.stop();
        var svg = document.getElementById('local-graph-svg');
        var emptyEl = document.getElementById('local-graph-empty');
        var countEl = document.getElementById('local-graph-count');
        if (!svg) return;

        // Wire toggle header once (before early-return so it works even with 0 connections)
        if (!this._localGraphToggleWired) {
            this._localGraphToggleWired = true;
            var toggleEl = document.getElementById('local-graph-toggle');
            if (toggleEl) {
                toggleEl.addEventListener('click', function() {
                    var graphEl = document.getElementById('editor-local-graph');
                    if (!graphEl) return;
                    graphEl.classList.toggle('collapsed');
                });
            }
        }

        var note = State.NOTES.find(function(n) { return n.id === noteId; });
        if (!note) return;

        // Gather connected notes: backlinks + forward links
        var connectedIds = new Set();
        var connectedNotes = [];

        // Backlinks (notes that link TO this note)
        if (window.MetadataCache && window.MetadataCache.getBacklinks) {
            var backlinkData = window.MetadataCache.getBacklinks(noteId);
            backlinkData.forEach(function(m) {
                if (m.id && m.id !== noteId && !connectedIds.has(m.id)) {
                    connectedIds.add(m.id);
                    var n = State.NOTES.find(function(x) { return x.id === m.id; });
                    if (n) connectedNotes.push({ id: n.id, name: n.title || 'Untitled', direction: 'incoming' });
                }
            });
        }

        // Forward links (notes this note links TO) — parse [[wiki links]] from content/blocks
        var wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        var textToSearch = '';
        if (note.blocks && Array.isArray(note.blocks)) {
            textToSearch = note.blocks.map(function(b) { return (b.content || ''); }).join('\n');
        } else {
            textToSearch = note.content || '';
        }
        var match;
        while ((match = wikiLinkRegex.exec(textToSearch)) !== null) {
            var targetTitle = match[1].trim().toLowerCase();
            var target = State.NOTES.find(function(n) {
                return n.title && n.title.trim().toLowerCase() === targetTitle && n.id !== noteId;
            });
            if (target && !connectedIds.has(target.id)) {
                connectedIds.add(target.id);
                connectedNotes.push({ id: target.id, name: target.title || 'Untitled', direction: 'outgoing' });
            }
        }

        // Update count badge
        if (countEl) {
            countEl.textContent = connectedNotes.length > 0 ? connectedNotes.length + ' connection' + (connectedNotes.length !== 1 ? 's' : '') : '';
        }

        // Empty state
        if (connectedNotes.length === 0) {
            svg.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        // Build D3 nodes & links: center note + connected notes
        var centerNote = { id: note.id, name: note.title || 'Untitled', isCenter: true };
        var nodes = [centerNote].concat(connectedNotes);
        var links = connectedNotes.map(function(cn) {
            return { source: note.id, target: cn.id };
        });

        // Clear and render
        svg.innerHTML = '';
        var width = svg.clientWidth || 400;
        var height = 180;

        var svgSel = d3.select(svg);
        svgSel.attr('viewBox', [0, 0, width, height]);

        var g = svgSel.append('g');

        var simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(120))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));

        var link = g.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', function(d) {
                var cn = connectedNotes.find(function(n) { return n.id === (d.target.id || d.target); });
                return cn && cn.direction === 'incoming' ? 'var(--graph-col-3, #ff0055)' : 'var(--secondary-color, #555)';
            })
            .attr('stroke-width', '1.5px')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-dasharray', function(d) {
                var cn = connectedNotes.find(function(n) { return n.id === (d.target.id || d.target); });
                return cn && cn.direction === 'incoming' ? '4,3' : 'none';
            });

        var node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .style('cursor', function(d) { return d.isCenter ? 'default' : 'pointer'; })
            .attr('title', function(d) { return d.isCenter ? '' : 'Open "' + d.name + '"'; })
            .on('click', function(event, d) {
                if (!d.isCenter && window.Notes && window.Notes.open) {
                    window.Notes.open(d.id);
                }
            })
            .on('mouseenter', function() {
                d3.select(this).select('circle').transition().duration(200).attr('r', function(d2) {
                    return (d2.isCenter ? 8 : 5) * 1.3;
                });
            })
            .on('mouseleave', function() {
                d3.select(this).select('circle').transition().duration(200).attr('r', function(d2) {
                    return d2.isCenter ? 8 : 5;
                });
            });

        // Color: main color for center, graph colors for connected
        var mainColor = 'var(--main-color, #00ff41)';
        node.append('circle')
            .attr('r', function(d) { return d.isCenter ? 8 : 5; })
            .attr('fill', function(d) {
                if (d.isCenter) return mainColor;
                var cn = connectedNotes.find(function(n) { return n.id === d.id; });
                return cn && cn.direction === 'incoming'
                    ? 'var(--graph-col-3, #ff0055)'
                    : 'var(--graph-col-2, #00e5ff)';
            })
            .attr('stroke', '#000')
            .attr('stroke-width', '1px');

        node.append('text')
            .text(function(d) {
                return d.name.length > 20 ? d.name.substring(0, 18) + '…' : d.name;
            })
            .attr('x', function(d) { return d.isCenter ? 12 : 9; })
            .attr('y', 4)
            .style('font-size', '9px')
            .style('fill', function(d) { return d.isCenter ? 'var(--main-color, #00ff41)' : '#ccc'; })
            .style('font-weight', function(d) { return d.isCenter ? 'bold' : 'normal'; })
            .style('pointer-events', 'none');

        simulation.on('tick', function() {
            link
                .attr('x1', function(d) { return d.source.x; })
                .attr('y1', function(d) { return d.source.y; })
                .attr('x2', function(d) { return d.target.x; })
                .attr('y2', function(d) { return d.target.y; });

            node.attr('transform', function(d) {
                return 'translate(' + d.x + ',' + d.y + ')';
            });
        });

        // Store simulation reference so it can be stopped if needed
        this._localGraphSim = simulation;
    },

    // ─── SELECTION ───
    selectBlock: function(blockId, additive) {
        if (additive) {
            var idx = this.selectedBlockIds.indexOf(blockId);
            if (idx === -1) this.selectedBlockIds.push(blockId);
            else this.selectedBlockIds.splice(idx, 1);
        } else {
            this.selectedBlockIds = [blockId];
        }
        this.lastSelectedId = blockId;
        this.updateSelectionVisuals();
    },

    selectRange: function(toId) {
        if (!this.lastSelectedId) {
            this.selectBlock(toId, false);
            return;
        }
        var page = this._getActivePage();
        if (!page || !page.blocks) return;
        var fromIdx = page.blocks.findIndex(function(b) { return b.id === BlockEditor.lastSelectedId; });
        var toIdx = page.blocks.findIndex(function(b) { return b.id === toId; });
        if (fromIdx === -1 || toIdx === -1) return;
        var start = Math.min(fromIdx, toIdx);
        var end = Math.max(fromIdx, toIdx);
        this.selectedBlockIds = [];
        for (var i = start; i <= end; i++) this.selectedBlockIds.push(page.blocks[i].id);
        this.updateSelectionVisuals();
    },
    
    selectAll: function() {
        var page = this._getActivePage();
        if (!page || !page.blocks) return;
        this.selectedBlockIds = page.blocks.map(b => b.id);
        this.updateSelectionVisuals();
    },

    clearSelection: function() {
        this.selectedBlockIds = [];
        this.lastSelectedId = null; 
        this.updateSelectionVisuals();
    },

    // ─── MULTI-SELECT ───
    updateSelectionVisuals: function() {
        var allBlocks = this.container.querySelectorAll('.block-wrapper');
        allBlocks.forEach(b => b.classList.remove('block-selected'));
        var self = this;
        this.selectedBlockIds.forEach(function(id) {
            var block = self.container.querySelector('[data-block-id="' + id + '"]');
            if (block) block.classList.add('block-selected');
        });
    },

    getSelectedBlocks: function() {
        var page = this._getActivePage();
        if (!page || !page.blocks) return [];
        var selected = [];
        this.selectedBlockIds.forEach(function(id) {
            var block = page.blocks.find(function(b) { return b.id === id; });
            if (block) selected.push(block);
        });
        return selected;
    },

    // ─── DRAG REORDER ───
    reorderBlock: function(draggedId, targetId, dropPosition) {
        var note = this._getActivePage();
        if (!note || !note.blocks) return;
        
        if (this.selectedBlockIds.length > 1 && this.selectedBlockIds.includes(draggedId)) {
            this.reorderSelectedBlocks(targetId, dropPosition);
            return;
        }

        var draggedIdx = note.blocks.findIndex(function(b) { return b.id === draggedId; });
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return;

        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        var draggedBlock = note.blocks.splice(draggedIdx, 1)[0];
        
        // Find target's new index after splice, then insert at correct position
        var newTargetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (dropPosition === 'after') {
            newTargetIdx++;
        }

        note.blocks.splice(newTargetIdx, 0, draggedBlock);
        PageManager.reorderBlocks(note); 
        saveData();
        PageManager.syncContent(this.activePageId);
        
        this.focusedBlockId = draggedId;
        this.render(this.activePageId); 
        this.flashBlock(draggedId);
    },

    reorderSelectedBlocks: function(targetId, dropPosition) {
        var note = this._getActivePage();
        if (!note || !note.blocks) return;
        
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (targetIdx === -1) return;

        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        var selectedBlocks = [];
        var remainingBlocks = [];

        note.blocks.forEach(function(block, idx) {
            if (BlockEditor.selectedBlockIds.includes(block.id)) {
                selectedBlocks.push(block);
            } else {
                remainingBlocks.push(block);
            }
        });

        var newTargetIdx = remainingBlocks.findIndex(function(b) { return b.id === targetId; });
        if (newTargetIdx === -1) newTargetIdx = remainingBlocks.length;
        
        if (dropPosition === 'after') {
            newTargetIdx++;
        }

        remainingBlocks.splice.apply(remainingBlocks, [newTargetIdx, 0].concat(selectedBlocks));
        note.blocks = remainingBlocks;
        PageManager.reorderBlocks(note);
        saveData();
        PageManager.syncContent(this.activePageId);
        
        this.render(this.activePageId);
        this.updateSelectionVisuals();
    },

    renderBlock: function (block) {
        var wrapper = document.createElement('div');
        wrapper.className = 'block-wrapper';
        wrapper.setAttribute('data-block-id', block.id);
        wrapper.setAttribute('data-block-type', block.type);
        if (block._tempIndex) wrapper.setAttribute('data-number', block._tempIndex);
        wrapper.setAttribute('draggable', 'true');

        var dragHandle = this._createBlockChrome(block, wrapper);

        var content;

        wrapper.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', block.id);
            e.dataTransfer.effectAllowed = 'move';
            wrapper.classList.add('dragging');
            BlockEditor.draggedBlockId = block.id;
        });
        wrapper.addEventListener('dragend', function(e) {
            wrapper.classList.remove('dragging');
            BlockEditor.draggedBlockId = null;
            document.querySelectorAll('.block-wrapper.drop-before, .block-wrapper.drop-after').forEach(function(el) {
                el.classList.remove('drop-before', 'drop-after');
            });
        });
        wrapper.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!BlockEditor.draggedBlockId || BlockEditor.draggedBlockId === block.id) return;
            var rect = wrapper.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            wrapper.classList.toggle('drop-before', e.clientY < midY);
            wrapper.classList.toggle('drop-after', e.clientY >= midY);
        });
        wrapper.addEventListener('dragleave', function(e) { 
            wrapper.classList.remove('drop-before', 'drop-after'); 
        });
        wrapper.addEventListener('drop', function(e) {
            e.preventDefault();
            var isBefore = wrapper.classList.contains('drop-before');
            wrapper.classList.remove('drop-before', 'drop-after');
            var draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== block.id) {
                BlockEditor.reorderBlock(draggedId, block.id, isBefore ? 'before' : 'after');
            }
        });

        switch (block.type) {
            case 'h1': case 'h2': case 'h3':
                content = this._renderHeadingBlock(block, wrapper);
                break;
            case 'task':
                content = this._renderTaskBlock(block, wrapper);
                break;
            case 'code':
                content = this._renderCodeBlock(block, wrapper);
                break;
            case 'bullet': case 'numbered':
                content = this._renderListBlock(block, wrapper);
                break;
            case 'quote':
                content = this._renderQuoteBlock(block, wrapper);
                break;
            case 'callout':
                content = this._renderCalloutBlock(block, wrapper);
                break;
            case 'image':
                content = this._renderImageBlock(block, wrapper);
                break;
            case 'kanban_ref':
                content = this._renderKanbanBlock(block, wrapper);
                break;
            case 'table':
                content = this._renderTableBlock(block, wrapper);
                break;
            case 'query':
                content = this._renderQueryBlock(block, wrapper);
                break;
            case 'embed':
                content = this._renderEmbedBlock(block, wrapper);
                break;
            case 'divider':
                content = this._renderDividerBlock(block, wrapper);
                break;
            default:
                content = this._renderParagraphBlock(block, wrapper);
}
        wrapper.appendChild(dragHandle);
        wrapper.appendChild(content);
        // Clicking the drag handle opens the SlashMenu for intuitive block options
        dragHandle.addEventListener('click', function(e) {
            // Prevent event from bubbling and unfocusing
            e.stopPropagation();
            if (typeof SlashMenu !== 'undefined') {
                SlashMenu.show(wrapper, e);
            }
        });
        
        return wrapper;
    },


    /**
     * Build the shared block chrome: drag handle, type badge, duplicate button,
     * level indent, alignment, and color. Appends chrome to the wrapper and
     * returns the drag handle element (for DnD wiring + SlashMenu in renderBlock).
     */
    _createBlockChrome: function(block, wrapper) {
        var self = this;
        var dragHandle = document.createElement('div');
        dragHandle.className = 'block-drag-handle';
        dragHandle.setAttribute('title', 'Drag to reorder');
        var gripDots = document.createElement('span');
        gripDots.className = 'grip-dots';
        dragHandle.appendChild(gripDots);
        var gripExpander = document.createElement('span');
        gripExpander.className = 'grip-expander';
        dragHandle.appendChild(gripExpander);

        // Block-type badge (shows 'H1', 'P', '•', etc. on hover)
        var typeBadge = document.createElement('span');
        typeBadge.className = 'block-type-badge';
        typeBadge.textContent = this._getTypeLabel(block.type);
        wrapper.appendChild(typeBadge);

        // Duplicate button (visible on hover in the drag-handle column)
        var dupBtn = document.createElement('button');
        dupBtn.className = 'block-dup-btn';
        dupBtn.title = 'Duplicate block (Cmd+D)';
        dupBtn.textContent = '⧉';
        dupBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            self.duplicateBlock(block.id);
        });
        wrapper.appendChild(dupBtn);
        
        if (block.level) wrapper.style.paddingLeft = (block.level * 24) + 'px';
        
        // Alignment Logic
        // For Editor Mode to match Preview:
        // 1. Text blocks (p, h1, h2, h3): wrapper.style.textAlign works effectively.
        // 2. Lists (bullet, numb): markers are usually ::before or absolute. 
        //    If wrapper is text-align: center, the marker (if inline) might move?
        //    We need to ensure content + marker move as a unit.
        
        if (block.align) {
            wrapper.setAttribute('data-align', block.align);
            // We do NOT set wrapper.style.textAlign anymore - CSS Flexbox handles it via data-align
        } else {
            wrapper.setAttribute('data-align', 'left');
        }

        // ── Block color ──
        if (block.color) {
            wrapper.style.setProperty('--block-color', block.color);
            wrapper.classList.add('has-block-color');
        }

        wrapper.appendChild(dragHandle);
        return dragHandle;
    },

    _renderHeadingBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement(block.type);
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.className = 'block-content block-' + block.type;
                content.setAttribute('data-placeholder', block.type === 'h1' ? 'Heading 1' : block.type === 'h2' ? 'Heading 2' : 'Heading 3');
        return content;
    },

    _renderTaskBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.className = 'block-content block-task';
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = 'task-check-' + block.id;
                checkbox.name = 'task-check-' + block.id;
                checkbox.checked = block.checked;
                checkbox.className = 'task-checkbox-inline';
                checkbox.addEventListener('change', function () {
                    var pageId = BlockEditor.activePageId;
                    var textEl = wrapper.querySelector('.task-text');
                    var updates = { checked: checkbox.checked };
                    if (textEl) updates.content = textEl.textContent;
                    PageManager.updateBlock(pageId, block.id, updates);
                    PageManager.syncContent(pageId);
                    wrapper.classList.toggle('completed', checkbox.checked);
                    saveData();
                });
                var taskText = document.createElement('div');
                taskText.className = 'task-text';
                taskText.contentEditable = 'true';
                taskText.innerHTML = this.markdownToHtml(block.content || '');
                taskText.setAttribute('data-placeholder', 'To-do');
                if (block.checked) wrapper.classList.add('completed');
                content.appendChild(checkbox);
                content.appendChild(taskText);
        return content;
    },

    _renderListBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-content', 'block-' + block.type);
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.setAttribute('data-placeholder', 'List item');
        return content;
    },

    _renderQuoteBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-content', 'block-quote');
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.setAttribute('data-placeholder', 'Quote');
        return content;
    },

    _renderDividerBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-divider-wrapper');
                content.classList.add('block-divider-wrapper');
                content.contentEditable = false;
                content.tabIndex = 0; // Allow focus for keyboard delete
                var hr = document.createElement('hr');
                hr.className = 'block-divider';
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'divider-delete-btn';
                deleteBtn.textContent = 'X';
                deleteBtn.onclick = function(e) {
                    e.stopPropagation();
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                content.appendChild(hr);
                content.appendChild(deleteBtn);
        return content;
    },

    _renderParagraphBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.contentEditable = 'true';
                // Process markdown into visual HTML tags for WYSIWYG editor
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.classList.add('block-content', 'block-p');
                content.setAttribute('data-placeholder', 'Type / for commands');
        
        return content;
    },


    _renderCodeBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-code');
                content.contentEditable = false;
                var inner = document.createElement('div');
                inner.className = 'code-inner';
                inner.contentEditable = true;
                inner.setAttribute('data-placeholder', 'Code...');
                
                var rawCode = block.content || '';
                var lang = block.language || 'javascript';
                
                // Corruption fix (simplified)
                if (lang === 'calc') {
                    inner.innerHTML = BlockEditor.getCalcPreviewHtml(rawCode);
                    inner.setAttribute('data-highlighted', 'true');
                    inner.addEventListener('focus', function() {
                        if (this.getAttribute('data-highlighted') === 'true') {
                            var safePage = State.NOTES.find(p => p.id === BlockEditor.activePageId);
                            var safeBlock = safePage ? safePage.blocks.find(b => b.id === block.id) : block;
                            this.textContent = safeBlock ? safeBlock.content : block.content;
                            this.removeAttribute('data-highlighted');
                        }
                    });
                    inner.addEventListener('blur', function() {
                         if (this.textContent !== block.content) block.content = this.textContent;
                         this.innerHTML = BlockEditor.getCalcPreviewHtml(this.textContent);
                         this.setAttribute('data-highlighted', 'true');
                    });
                } else {
                    inner.innerHTML = BlockEditor.highlightSyntax(rawCode, lang);
                    inner.setAttribute('data-highlighted', 'true');
                    inner.addEventListener('focus', function() {
                        if (this.getAttribute('data-highlighted') === 'true') {
                            this.textContent = rawCode;
                            this.removeAttribute('data-highlighted');
                        }
                    });
                    inner.addEventListener('blur', function() {
                        rawCode = this.textContent;
                        this.innerHTML = BlockEditor.highlightSyntax(rawCode, lang);
                        this.setAttribute('data-highlighted', 'true');
                    });
                }
                // Language selector (clickable label)
                var langLabel = document.createElement('span');
                langLabel.className = 'code-lang-label';
                langLabel.textContent = lang;
                langLabel.title = 'Click to change language';
                langLabel.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var langPicker = wrapper.querySelector('.code-lang-picker');
                    if (langPicker) { langPicker.remove(); return; }

                    var LANGUAGES = ['javascript', 'python', 'html', 'css', 'typescript', 'jsx', 'tsx', 'json', 'markdown', 'bash', 'sql', 'yaml', 'rust', 'go', 'java', 'c', 'cpp', 'ruby', 'php', 'graphql', 'diff', 'plaintext'];
                    var picker = document.createElement('div');
                    picker.className = 'code-lang-picker';
                    picker.style.cssText = 'position:absolute;top:24px;right:4px;z-index:200;';

                    var currentLang = block.language || 'javascript';
                    var html = LANGUAGES.map(function(l) {
                        var cls = l === currentLang ? ' lang-opt active' : ' lang-opt';
                        return '<div class="' + cls + '" data-lang="' + l + '">' + l + '</div>';
                    }).join('');
                    picker.innerHTML = html;

                    picker.addEventListener('click', function(ce) {
                        var opt = ce.target.closest('.lang-opt');
                        if (!opt) return;
                        var newLang = opt.getAttribute('data-lang');
                        if (newLang !== (block.language || 'javascript')) {
                            block.language = newLang;
                            PageManager.updateBlock(self.activePageId, block.id, { language: newLang });
                            self.render(self.activePageId);
                        }
                        picker.remove();
                    });

                    content.appendChild(picker);

                    // Close on outside click
                    setTimeout(function() {
                        var closeHandler = function(ce2) {
                            if (!picker.contains(ce2.target) && ce2.target !== langLabel) {
                                picker.remove();
                                document.removeEventListener('mousedown', closeHandler);
                            }
                        };
                        document.addEventListener('mousedown', closeHandler);
                    }, 10);
                });
                content.appendChild(langLabel);
                content.appendChild(inner);
                
                // Enhance code block with line numbers, copy button, Tab support
                requestAnimationFrame(function() {
                    if (window.CodeBlockTools) {
                        window.CodeBlockTools.enhanceBlock(wrapper, block);
                    }
                });
        return content;
    },


    _renderCalloutBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-callout', 'callout-' + (block.calloutType || 'info').toLowerCase());
                content.contentEditable = false;
                content.tabIndex = 0;
                
                var cType = (block.calloutType || 'info').toLowerCase();
                var cTitle = block.calloutTitle || '';
                var cContent = '';
                
                if (block.content) {
                    var cLines = block.content.split('\n').map(l => l.replace(/^>\s?/, '')); // Strip '>' prefix
                    if (cLines[0] && cLines[0].match(/^\[!\w+\]/)) {
                        cType = cLines[0].match(/^\[!(\w+)\]/)[1].toLowerCase(); // Extract type robustly
                        cContent = cLines.slice(1).join('\n').trim();
                        if (!cTitle) cTitle = cLines[0].replace(/^\[!\w+\]\s*/, '').trim();
                    } else {
                        cContent = cLines.join('\n'); // Join what's left
                    }
                }
                
                // Build callout header
                var calloutHeader = document.createElement('div');
                calloutHeader.className = 'callout-header';
                
                var iconSpan = document.createElement('span');
                iconSpan.className = 'callout-icon';
                // Icons will be injected via CSS content or left as is if you prefer emojis
                iconSpan.textContent = BlockEditor.getCalloutIcon(cType); 
                
                var titleSpan = document.createElement('span');
                titleSpan.className = 'callout-title';
                titleSpan.textContent = cTitle || cType.toUpperCase();
                
                calloutHeader.appendChild(iconSpan);
                calloutHeader.appendChild(titleSpan);
                
                // Build callout body
                var calloutBody = document.createElement('div');
                calloutBody.className = 'callout-body';
                if (cContent) {
                    calloutBody.innerHTML = cContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                }

                // Build action buttons container
                var actionsDiv = document.createElement('div');
                actionsDiv.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 8px;';
                
                // EDIT button - pure DOM with direct onclick
                var editBtn = document.createElement('span');
                editBtn.className = 'block-action-btn'; // Added class for mousedown whitelist
                editBtn.textContent = 'EDIT';
                editBtn.style.cssText = 'cursor: pointer; color: #666; font-size: 11px; padding: 2px 6px; border: 1px solid #444; border-radius: 3px;';
                editBtn.onmouseenter = function() { editBtn.style.color = 'var(--callout-color)'; editBtn.style.borderColor = 'var(--callout-color)'; };
                editBtn.onmouseleave = function() { editBtn.style.color = '#666'; editBtn.style.borderColor = '#444'; };
                (function(bid, bcontent) {
                    editBtn.onclick = function(e) {
                        console.log('[BlockEditor] Edit button clicked for', bid);
                        e.stopPropagation();
                        e.preventDefault();
                        if (window.CalloutModal) {
                            console.log('[BlockEditor] CalloutModal exists, opening...');
                            window.CalloutModal.open(bid, bcontent);
                        } else {
                            console.error('[BlockEditor] window.CalloutModal is undefined!');
                        }
                        return false;
                    };
                })(block.id, block.content);
                
                // DELETE button - pure DOM with direct onclick  
                var delBtn = document.createElement('span');
                delBtn.className = 'block-action-btn'; // Added class for mousedown whitelist
                delBtn.textContent = 'X';
                delBtn.style.cssText = 'cursor: pointer; color: #666; font-size: 11px; padding: 2px 6px; border: 1px solid #444; border-radius: 3px;';
                delBtn.onmouseenter = function() { delBtn.style.color = '#FF0055'; delBtn.style.borderColor = '#FF0055'; };
                delBtn.onmouseleave = function() { delBtn.style.color = '#666'; delBtn.style.borderColor = '#444'; };
                (function(bid) {
                    delBtn.onclick = function(e) {
                        e.stopPropagation();
                        e.preventDefault();
                        PageManager.deleteBlock(self.activePageId, bid);
                        self.render(self.activePageId);
                        return false;
                    };
                })(block.id);
                
                actionsDiv.appendChild(editBtn);
                actionsDiv.appendChild(delBtn);
                
                content.appendChild(calloutHeader);
                content.appendChild(calloutBody);
                content.appendChild(actionsDiv);
        return content;
    },


    _renderImageBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-image');
                content.contentEditable = false;
                content.tabIndex = 0; // Allow focus for keyboard delete
                
                var innerWrapper = document.createElement('div');
                innerWrapper.className = 'image-inner-wrapper';
                var img = document.createElement('img');
                img.src = block.url || block.content;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '500px';
                img.style.display = 'block';
                img.style.margin = '0 auto';
                innerWrapper.appendChild(img);
                var imgDeleteBtn = document.createElement('button');
                imgDeleteBtn.className = 'image-delete-btn block-action-btn'; // Whitelist for click
                imgDeleteBtn.textContent = 'X';
                imgDeleteBtn.onclick = function(e) {
                    e.stopPropagation();
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                var caption = document.createElement('div');
                caption.className = 'image-caption';
                caption.contentEditable = 'true';
                caption.innerHTML = this.markdownToHtml(block.caption || '');
                caption.setAttribute('data-placeholder', 'Add caption…');
                content.appendChild(innerWrapper);
                content.appendChild(caption);
                content.appendChild(imgDeleteBtn);
        return content;
    },

    _renderKanbanBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('kanban-hud-wrapper'); 
                content.classList.add('kanban-hud-wrapper'); 
                content.contentEditable = false;
                content.tabIndex = 0; // Allow focus for keyboard delete
                var BOARDS = State.BOARDS || [];
                var board = BOARDS.find(function(b) { return b.id === block.boardId; });
                
                if (board) {
                    // Telemetry (Robust Math)
                    var totalCards = 0;
                    board.columns.forEach(function(c) { totalCards += c.cards.length; });
                    var doneCol = board.columns[board.columns.length - 1];
                    var doneCount = doneCol ? doneCol.cards.length : 0;
                    var percent = totalCards === 0 ? 0 : Math.round((doneCount / totalCards) * 100);

                    // Active Stream (Smart List)
                    var activeCol = board.columns.find(function(c) { return c.cards.length > 0 && c !== doneCol; }) || board.columns[0];
                    var activeCards = activeCol ? activeCol.cards.slice(0, 3) : [];

                    var listHtml = activeCards.map(function(card) {
                        var displayContent = (card.content || '').replace(/#(\w+)/g, '<span class="hud-tag">#$1</span>');
                        return '<li class="hud-item" data-card-id="' + card.id + '">' +
                            '<span class="hud-item-text">' + displayContent + '</span>' +
                            '<span class="hud-advance-btn" title="Advance">>></span>' +
                        '</li>';
                    }).join('');

                    content.innerHTML = 
                        '<div class="hud-header-compact" title="Click to Open Board">' +
                            '<div class="hud-title-row">' +
                                '<span class="hud-icon">[=]</span>' +
                                '<span class="hud-name">' + board.title.toUpperCase() + '</span>' +
                                '<span class="hud-percent">' + percent + '%</span>' +
                                '<button class="hud-delete-btn" title="Remove Block" style="opacity:0.3; cursor:pointer; margin-left:auto; background:none; color:white;">[x]</button>' +
                            '</div>' +
                            '<div class="hud-progress-track">' +
                                '<div class="hud-progress-fill" style="width: ' + percent + '%"></div>' +
                            '</div>' +
                        '</div>' +
                        '<ul class="hud-list" style="list-style:none; padding:0; margin:0;">' + listHtml + '</ul>' +
                        '<div class="hud-injector-row">' +
                            '<input type="text" class="hud-injector-input" placeholder="+ Add task (#tag supported)...">' +
                        '</div>';

                    // Event Handlers
                    var hudHeader = content.querySelector('.hud-header-compact');
                    hudHeader.onclick = function(e) { 
                        if (e.target.classList.contains('hud-delete-btn')) {
                            e.stopPropagation();
                            PageManager.deleteBlock(self.activePageId, block.id);
                            self.render(self.activePageId);
                        } else {
                            if (typeof KanbanManager !== 'undefined') KanbanManager.open(block.boardId); 
                        }
                    };

                    // Deep Link & Advance
                    content.querySelectorAll('.hud-item').forEach(function(item) {
                        item.addEventListener('dblclick', function(e) {
                            e.stopPropagation();
                            var textEl = this.querySelector('.hud-item-text');
                            if (textEl && typeof Notes !== 'undefined') {
                                Notes.openByTitle(textEl.innerText) || Notes.create(textEl.innerText);
                            }
                        });
                        
                        var advBtn = item.querySelector('.hud-advance-btn');
                        if (advBtn) {
                            advBtn.onclick = function(e) {
                                e.stopPropagation();
                                if (typeof KanbanManager !== 'undefined' && KanbanManager.advanceCard) {
                                    if (KanbanManager.advanceCard(item.dataset.cardId, board.id)) {
                                        self.render(self.activePageId);
                                    }
                                }
                            };
                        }
                    });

                    // Injector (Smart Enter)
                    var hudInput = content.querySelector('.hud-injector-input');
                    if (hudInput) {
                        hudInput.addEventListener('keydown', function(e) {
                            e.stopPropagation();
                            if (e.key === 'Enter' && this.value.trim()) {
                                if (board.columns.length > 0) {
                                    board.columns[0].cards.push({ id: 'card_' + Date.now(), content: this.value.trim(), created: Date.now() });
                                    board.modified = Date.now();
                                    saveData();
                                    self.render(self.activePageId);
                                }
                            }
                        });
                        hudInput.addEventListener('click', function(e) { e.stopPropagation(); });
                    }
                } else {
                    // Setup UI for no board linked
                    var setup = document.createElement('div');
                    setup.style.cssText = 'padding:10px;text-align:center;display:flex;gap:10px;justify-content:center;align-items:center;';
                    
                    var icon = document.createElement('span');
                    icon.textContent = '[=]';
                    icon.style.color = 'var(--main-color)';
                    
                    var createBtn = document.createElement('button');
                createBtn.textContent = 'NEW BOARD';
                createBtn.className = 'kanban-setup-btn block-action-btn'; // Whitelist
                createBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid #444;color:#ccc;padding:4px 8px;cursor:pointer;';
                    
                    createBtn.onclick = function(e) {
                        e.stopPropagation();
                        var newTitle = prompt("Enter Board Name:", "Project Alpha");
                        if (newTitle && typeof KanbanManager !== 'undefined') {
                            var b = KanbanManager.createBoard(newTitle);
                            PageManager.updateBlock(self.activePageId, block.id, { boardId: b.id });
                            self.render(self.activePageId);
                            // ponytail: persist the note's board link now (see slashmenu)
                            window.saveData();
                        }
                    };
                    
                    var linkBtn = document.createElement('button');
                    linkBtn.textContent = 'LINK EXISTING';
                    linkBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid #444;color:#ccc;padding:4px 8px;cursor:pointer;';
                    
                    var delBtn = document.createElement('button');
                delBtn.textContent = '[x]';
                delBtn.title = 'Delete Block';
                delBtn.className = 'block-action-btn'; // Whitelist
                delBtn.style.cssText = 'background:transparent;border:none;color:#666;cursor:pointer;';
                    
                    linkBtn.onclick = function(e) {
                        e.stopPropagation();
                        this.style.display = 'none';
                        var select = document.createElement('select');
                        select.className = 'config-input';
                        
                        var def = document.createElement('option');
                        def.text = 'Select Board...';
                        select.add(def);
                        
                        BOARDS.forEach(function(b) {
                            var opt = document.createElement('option');
                            opt.value = b.id;
                            opt.text = b.title;
                            select.add(opt);
                        });
                        
                        select.onchange = function() {
                            if (select.value) {
                                PageManager.updateBlock(self.activePageId, block.id, { boardId: select.value });
                                self.render(self.activePageId);
                                // ponytail: persist the note's board link now (see slashmenu)
                                window.saveData();
                            }
                        };
                        setup.insertBefore(select, delBtn);
                    };
                    
                    delBtn.onclick = function(e) {
                        e.stopPropagation();
                        PageManager.deleteBlock(self.activePageId, block.id);
                        self.render(self.activePageId);
                    };
                    
                    setup.appendChild(icon);
                    setup.appendChild(createBtn);
                    setup.appendChild(linkBtn);
                    setup.appendChild(delBtn);
                    content.appendChild(setup);
                }
        return content;
    },


    _renderTableBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.classList.add('block-table');
                content.classList.add('block-table');
                content.contentEditable = false;
                content.tabIndex = 0; // Allow focus for keyboard delete
                
                // Initialize tableData if missing
                if (!block.tableData) {
                    block.tableData = {
                        headers: ['Header 1', 'Header 2', 'Header 3'],
                        rows: [['', '', ''], ['', '', '']],
                        columnAligns: ['left', 'left', 'left'],
                        columnWidths: [],
                        hasHeaderRow: true
                    };
                }
                var tableData = block.tableData;
                // Guard: ensure columnWidths exists (old data may lack this field)
                if (!tableData.columnWidths) tableData.columnWidths = [];
                if (!tableData.headers) tableData.headers = [];
                // Ensure columnWidths array matches column count
                while (tableData.columnWidths.length < tableData.headers.length) {
                    tableData.columnWidths.push('');
                }

                var tableWrapper = document.createElement('div');
                tableWrapper.className = 'table-wrapper';
                
                // Create toolbar
                var toolbar = document.createElement('div');
                toolbar.className = 'table-toolbar';
                toolbar.innerHTML = 
                    '<button class="table-toolbar-btn block-action-btn" data-action="align-left" title="Align Left">[=</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="align-center" title="Align Center">=</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="align-right" title="Align Right">=]</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="insert-row-above" title="Insert Row Above">+ Row Up</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="insert-row-below" title="Insert Row Below">+ Row Dn</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="insert-col-left" title="Insert Column Left">+ Col L</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="insert-col-right" title="Insert Column Right">+ Col R</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="delete-row" title="Delete Row">- Row</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="delete-col" title="Delete Column">- Col</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="sort-asc" title="Sort A-Z">A-Z</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="sort-desc" title="Sort Z-A">Z-A</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="reset-widths" title="Reset column widths to auto">⇔</button>' +
                    '<button class="table-toolbar-btn block-action-btn" data-action="delete-table" title="Delete Table" style="color:#f44;">X</button>';
                
                // Create table element
                var table = document.createElement('table');
                table.className = 'table-grid';
                
                // Track focused cell for toolbar actions
                var focusedCell = { row: -1, col: -1 };
                
                // Render header row
                if (tableData.hasHeaderRow) {
                    var thead = document.createElement('thead');
                    var headerRow = document.createElement('tr');
                    
                    tableData.headers.forEach(function(headerText, colIdx) {
                        var th = document.createElement('th');
                        th.style.textAlign = tableData.columnAligns[colIdx] || 'left';
                        if (tableData.columnWidths && tableData.columnWidths[colIdx]) {
                            th.style.width = tableData.columnWidths[colIdx] + 'px';
                            th.style.minWidth = tableData.columnWidths[colIdx] + 'px';
                        }
                        
                        var cell = document.createElement('div');
                        cell.className = 'table-cell table-header-cell';
                        cell.contentEditable = 'true';
                        cell.innerHTML = BlockEditor.markdownToHtml(headerText);
                        cell.setAttribute('data-row', '-1');
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = -1;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            setTimeout(function() {
                                if (!content.contains(document.activeElement)) {
                                    toolbar.classList.remove('visible');
                                }
                            }, 100);
                        });
                        
                        cell.addEventListener('keydown', function(e) {
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                var nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
                                if (nextCol >= 0 && nextCol < tableData.headers.length) {
                                    var nextCell = table.querySelector('[data-row="-1"][data-col="' + nextCol + '"]');
                                    if (nextCell) nextCell.focus();
                                } else if (!e.shiftKey && tableData.rows.length > 0) {
                                    var firstDataCell = table.querySelector('[data-row="0"][data-col="0"]');
                                    if (firstDataCell) firstDataCell.focus();
                                }
                            }
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                var belowCell = table.querySelector('[data-row="0"][data-col="' + colIdx + '"]');
                                if (belowCell) belowCell.focus();
                            }
                        });

                        // Right-click context menu on header
                        th.addEventListener('contextmenu', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            // Close any existing menu
                            var existing = document.querySelector('.table-ctx-menu');
                            if (existing) existing.remove();

                            var menu = document.createElement('div');
                            menu.className = 'table-ctx-menu';
                            menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:50000;';
                            menu.innerHTML = `
                                <div class="ctx-section-title">Align</div>
                                <div class="ctx-item" data-action="align-left">[= Left</div>
                                <div class="ctx-item" data-action="align-center">= Center</div>
                                <div class="ctx-item" data-action="align-right">=] Right</div>
                                <div class="ctx-divider"></div>
                                <div class="ctx-section-title">Sort</div>
                                <div class="ctx-item" data-action="sort-asc">A-Z Ascending</div>
                                <div class="ctx-item" data-action="sort-desc">Z-A Descending</div>
                                <div class="ctx-divider"></div>
                                <div class="ctx-section-title">Insert</div>
                                <div class="ctx-item" data-action="insert-col-left">+ Column Left</div>
                                <div class="ctx-item" data-action="insert-col-right">+ Column Right</div>
                                <div class="ctx-item" data-action="insert-row-above">+ Row Above</div>
                                <div class="ctx-item" data-action="insert-row-below">+ Row Below</div>
                                <div class="ctx-divider"></div>
                                <div class="ctx-item ctx-danger" data-action="delete-col">- Delete Column</div>
                                <div class="ctx-item ctx-danger" data-action="delete-row">- Delete Row</div>
                            `;
                            document.body.appendChild(menu);

                            // Set focusedCell so the actions target the right column/row
                            focusedCell.col = colIdx;
                            focusedCell.row = -1;

                            // Click handler: find toolbar button with matching action and click it
                            menu.addEventListener('click', function(ce) {
                                var item = ce.target.closest('.ctx-item');
                                if (!item) return;
                                var action = item.getAttribute('data-action');
                                var tbBtn = toolbar.querySelector('[data-action="' + action + '"]');
                                if (tbBtn) tbBtn.click();
                                menu.remove();
                            });

                            // Close on outside click
                            setTimeout(function() {
                                var closeHandler = function(ce2) {
                                    if (!menu.contains(ce2.target)) {
                                        menu.remove();
                                        document.removeEventListener('mousedown', closeHandler);
                                    }
                                };
                                document.addEventListener('mousedown', closeHandler);
                            }, 10);
                        });

                        // Column resize handle
                        var resizeHandle = document.createElement('div');
                        resizeHandle.className = 'col-resize-handle';
                        resizeHandle.setAttribute('data-col', colIdx);
                        resizeHandle.addEventListener('mousedown', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            var startX = e.clientX;
                            var startWidth = th.offsetWidth;

                            var onMouseMove = function(me) {
                                var dx = me.clientX - startX;
                                var newWidth = Math.max(80, startWidth + dx);
                                th.style.width = newWidth + 'px';
                                th.style.minWidth = newWidth + 'px';
                                // Sync cells in same column
                                table.querySelectorAll('.table-cell[data-col="' + colIdx + '"]').forEach(function(c) {
                                    c.parentElement.style.width = newWidth + 'px';
                                });
                            };

                            var onMouseUp = function() {
                                window.removeEventListener('mousemove', onMouseMove);
                                window.removeEventListener('mouseup', onMouseUp);
                                // Save to columnWidths
                                var newWidth = th.offsetWidth;
                                if (!tableData.columnWidths) tableData.columnWidths = [];
                                while (tableData.columnWidths.length < tableData.headers.length) {
                                    tableData.columnWidths.push('');
                                }
                                tableData.columnWidths[colIdx] = newWidth;
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                if (window.saveData) saveData();
                            };

                            window.addEventListener('mousemove', onMouseMove);
                            window.addEventListener('mouseup', onMouseUp);
                        });

                        th.appendChild(cell);
                        th.appendChild(resizeHandle);
                        headerRow.appendChild(th);
                    });
                    
                    thead.appendChild(headerRow);
                    table.appendChild(thead);
                }
                
                // Render data rows
                var tbody = document.createElement('tbody');
                tableData.rows.forEach(function(rowData, rowIdx) {
                    var tr = document.createElement('tr');
                    tr.style.position = 'relative';
                    
                    rowData.forEach(function(cellText, colIdx) {
                        var td = document.createElement('td');
                        td.style.textAlign = tableData.columnAligns[colIdx] || 'left';
                        if (tableData.columnWidths && tableData.columnWidths[colIdx]) {
                            td.style.width = tableData.columnWidths[colIdx] + 'px';
                            td.style.minWidth = tableData.columnWidths[colIdx] + 'px';
                        }
                        
                        var cell = document.createElement('div');
                        cell.className = 'table-cell';
                        cell.contentEditable = 'true';
                        cell.innerHTML = BlockEditor.markdownToHtml(cellText);
                        cell.setAttribute('data-row', rowIdx);
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = rowIdx;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            setTimeout(function() {
                                if (!content.contains(document.activeElement)) {
                                    toolbar.classList.remove('visible');
                                }
                            }, 100);
                        });
                        
                        cell.addEventListener('keydown', function(e) {
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                var nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
                                var nextRow = rowIdx;
                                if (nextCol >= rowData.length) {
                                    nextCol = 0;
                                    nextRow = rowIdx + 1;
                                } else if (nextCol < 0) {
                                    nextCol = rowData.length - 1;
                                    nextRow = rowIdx - 1;
                                }
                                if (nextRow >= 0 && nextRow < tableData.rows.length) {
                                    var nextCell = table.querySelector('[data-row="' + nextRow + '"][data-col="' + nextCol + '"]');
                                    if (nextCell) nextCell.focus();
                                } else if (nextRow < 0 && tableData.hasHeaderRow) {
                                    var headerCell = table.querySelector('[data-row="-1"][data-col="' + nextCol + '"]');
                                    if (headerCell) headerCell.focus();
                                }
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                var belowRow = rowIdx + 1;
                                if (belowRow < tableData.rows.length) {
                                    var belowCell = table.querySelector('[data-row="' + belowRow + '"][data-col="' + colIdx + '"]');
                                    if (belowCell) belowCell.focus();
                                }
                            }
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                var belowCell = table.querySelector('[data-row="' + (rowIdx + 1) + '"][data-col="' + colIdx + '"]');
                                if (belowCell) belowCell.focus();
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                var aboveRow = rowIdx - 1;
                                var aboveCell = aboveRow >= 0 
                                    ? table.querySelector('[data-row="' + aboveRow + '"][data-col="' + colIdx + '"]')
                                    : table.querySelector('[data-row="-1"][data-col="' + colIdx + '"]');
                                if (aboveCell) aboveCell.focus();
                            }
                        });
                        
                        td.appendChild(cell);
                        tr.appendChild(td);
                    });
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                // Add Row button
                var addRowBtn = document.createElement('button');
                addRowBtn.className = 'table-add-row-btn';
                addRowBtn.textContent = '+ Add Row';
                addRowBtn.onclick = function(e) {
                    e.stopPropagation();
                    var newRow = tableData.headers.map(function() { return ''; });
                    tableData.rows.push(newRow);
                    PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                    self.render(self.activePageId);
                };
                
                // Add Column button
                var addColBtn = document.createElement('button');
                addColBtn.className = 'table-add-col-btn';
                addColBtn.textContent = '+';
                addColBtn.onclick = function(e) {
                    e.stopPropagation();
                    tableData.headers.push('New Column');
                    tableData.columnAligns.push('left');
                    tableData.rows.forEach(function(row) { row.push(''); });
                    PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                    self.render(self.activePageId);
                };
                
                // Toolbar actions
                toolbar.addEventListener('click', function(e) {
                    var action = e.target.getAttribute('data-action');
                    if (!action) return;
                    
                    var col = focusedCell.col;
                    var row = focusedCell.row;
                    
                    switch(action) {
                        case 'align-left':
                        case 'align-center':
                        case 'align-right':
                            if (col >= 0) {
                                tableData.columnAligns[col] = action.replace('align-', '');
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-row-above':
                            if (row >= 0) {
                                var newRow = tableData.headers.map(function() { return ''; });
                                tableData.rows.splice(row, 0, newRow);
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-row-below':
                            var insertAt = row >= 0 ? row + 1 : 0;
                            var newRow = tableData.headers.map(function() { return ''; });
                            tableData.rows.splice(insertAt, 0, newRow);
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                            self.render(self.activePageId);
                            break;
                        case 'insert-col-left':
                            if (col >= 0) {
                                tableData.headers.splice(col, 0, 'New');
                                tableData.columnAligns.splice(col, 0, 'left');
                                tableData.rows.forEach(function(r) { r.splice(col, 0, ''); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'insert-col-right':
                            if (col >= 0) {
                                tableData.headers.splice(col + 1, 0, 'New');
                                tableData.columnAligns.splice(col + 1, 0, 'left');
                                tableData.rows.forEach(function(r) { r.splice(col + 1, 0, ''); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'delete-row':
                            if (row >= 0 && tableData.rows.length > 1) {
                                tableData.rows.splice(row, 1);
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'delete-col':
                            if (col >= 0 && tableData.headers.length > 1) {
                                tableData.headers.splice(col, 1);
                                tableData.columnAligns.splice(col, 1);
                                tableData.rows.forEach(function(r) { r.splice(col, 1); });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'sort-asc':
                            if (col >= 0) {
                                tableData.rows.sort(function(a, b) {
                                    return (a[col] || '').localeCompare(b[col] || '');
                                });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'sort-desc':
                            if (col >= 0) {
                                tableData.rows.sort(function(a, b) {
                                    return (b[col] || '').localeCompare(a[col] || '');
                                });
                                PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                                self.render(self.activePageId);
                            }
                            break;
                        case 'reset-widths':
                            tableData.columnWidths = [];
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                            self.render(self.activePageId);
                            break;
                        case 'delete-table':
                            PageManager.deleteBlock(self.activePageId, block.id);
                            self.render(self.activePageId);
                            break;
                    }
                });
                
                tableWrapper.appendChild(table);
                content.appendChild(toolbar);
                content.appendChild(tableWrapper);
                content.appendChild(addRowBtn);
                content.appendChild(addColBtn);
        return content;
    },


    _renderQueryBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.className = 'block-query-container';
                content.contentEditable = false;
                
                // Header & Input
                var queryHeader = document.createElement('div');
                queryHeader.className = 'query-header';
                var queryInput = document.createElement('input');
                queryInput.type = 'text';
                queryInput.className = 'query-input config-input';
                queryInput.value = block.content || '';
                queryInput.placeholder = 'e.g., LIST FROM #tasks WHERE status="TODO"';
                
                // Added delete button hook
                var qDeleteBtn = document.createElement('button');
                qDeleteBtn.innerHTML = '×';
                qDeleteBtn.className = 'query-delete-btn block-action-btn';
                qDeleteBtn.style.cssText = 'background:transparent; border:none; color:var(--danger-color); cursor:pointer; font-size:1.2rem; margin-left:10px;';
                qDeleteBtn.onclick = function(e) {
                    e.stopPropagation();
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                
                queryHeader.appendChild(document.createTextNode('🔍 Query: '));
                queryHeader.appendChild(queryInput);
                queryHeader.appendChild(qDeleteBtn);
                content.appendChild(queryHeader);

                // Results Container
                var resultsContainer = document.createElement('div');
                resultsContainer.className = 'query-results';
                content.appendChild(resultsContainer);

                // Execution Logic
                var executeQuery = () => {
                    if (!window.QueryEngine) return;
                    var qString = queryInput.value.trim();
                    if (!qString) {
                        resultsContainer.innerHTML = '<span style="color:var(--secondary-color)">Enter a query to see results.</span>';
                        return;
                    }
                    try {
                        var results = window.QueryEngine.execute(qString);
                        if (qString.toUpperCase().startsWith('LIST')) {
                            if (results.results.length === 0) {
                                resultsContainer.innerHTML = '<em>No results found.</em>';
                                return;
                            }
                            var ul = document.createElement('ul');
                            results.results.forEach(res => {
                                var li = document.createElement('li');
                                li.innerHTML = res.title ? `<strong>📄 ${res.title}</strong>` : (res.text || res.content || 'Item');
                                li.style.cursor = 'pointer';
                                li.onclick = () => {
                                    if (res.noteId) window.Notes.open(res.noteId);
                                    else if (res.id && res.path) window.Notes.open(res.id);
                                };
                                ul.appendChild(li);
                            });
                            resultsContainer.innerHTML = '';
                            resultsContainer.appendChild(ul);
                        } else {
                            resultsContainer.innerHTML = window.QueryEngine.renderResults(results.results, results.parsed.type);
                        }
                    } catch (e) {
                        resultsContainer.innerHTML = `<span style="color:var(--danger-color)">Syntax Error: ${e.message}</span>`;
                    }
                };

                executeQuery();
                queryInput.addEventListener('change', (e) => {
                    block.content = e.target.value;
                    window.saveData();
                    if (window.PageManager) window.PageManager.syncContent(self.activePageId);
                    executeQuery();
                });
        return content;
    },

    _renderEmbedBlock: function(block, wrapper) {
        var self = this;
        var content;
                content = document.createElement('div');
                content.className = 'block-embed';
                content.contentEditable = false;
                content.tabIndex = 0;

                // Find the target note by title
                var embedTitle = (block.content || '').trim();
                var targetNote = null;
                if (embedTitle && State && State.NOTES) {
                    targetNote = State.NOTES.find(function(n) {
                        return (n.title || '').toLowerCase() === embedTitle.toLowerCase();
                    });
                }

                if (targetNote) {
                    // Render embed header with title and open button
                    var embedHeader = document.createElement('div');
                    embedHeader.className = 'embed-header';

                    var embedLabel = document.createElement('span');
                    embedLabel.className = 'embed-label';
                    embedLabel.textContent = 'EMBED: ' + (targetNote.title || 'Untitled');

                    var openBtn = document.createElement('button');
                    openBtn.className = 'embed-open-btn block-action-btn';
                    openBtn.textContent = 'OPEN';
                    openBtn.onclick = function(e) {
                        e.stopPropagation();
                        if (window.Notes) window.Notes.open(targetNote.id);
                    };

                    embedHeader.appendChild(embedLabel);
                    embedHeader.appendChild(openBtn);
                    content.appendChild(embedHeader);

                    // Render the target note's content as read-only preview
                    var embedBody = document.createElement('div');
                    embedBody.className = 'embed-body';

                    var targetContent = targetNote.content || '';
                    if (targetContent) {
                        // Use renderMarkdown for preview if available, else plain text
                        if (window.Notes && window.Notes.renderMarkdown) {
                            embedBody.innerHTML = window.Notes.renderMarkdown(targetContent, true);
                        } else {
                            var safe = targetContent.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            embedBody.innerHTML = safe.replace(/\n/g, '<br>');
                        }
                    } else {
                        // Check blocks
                        var blocks = targetNote.blocks || [];
                        if (blocks.length > 0) {
                            var text = blocks.map(function(b) { return b.content || ''; }).join(' ');
                            if (window.Notes && window.Notes.renderMarkdown) {
                                embedBody.innerHTML = window.Notes.renderMarkdown(text, true);
                            } else {
                                var safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                embedBody.innerHTML = safe.replace(/\n/g, '<br>');
                            }
                        } else {
                            embedBody.innerHTML = '<span class="embed-empty">(empty note)</span>';
                        }
                    }

                    // Refresh-on-reopen marker
                    var embedMeta = document.createElement('div');
                    embedMeta.className = 'embed-meta';
                    embedMeta.textContent = '\u21BB Refreshes on reopen';

                    content.appendChild(embedBody);
                    content.appendChild(embedMeta);
                } else {
                    // Note not found - show placeholder
                    var embedPlaceholder = document.createElement('div');
                    embedPlaceholder.className = 'embed-placeholder';

                    if (embedTitle) {
                        var createBtn = document.createElement('button');
                        createBtn.className = 'embed-create-btn block-action-btn';
                        createBtn.textContent = 'CREATE: "' + embedTitle + '"';
                        createBtn.onclick = function(e) {
                            e.stopPropagation();
                            if (window.Notes) window.Notes.create(embedTitle, '/');
                        };
                        embedPlaceholder.innerHTML = '<span class="embed-missing">Note not found: <strong>!' + embedTitle + ']</strong></span>';
                        embedPlaceholder.appendChild(createBtn);
                    } else {
                        embedPlaceholder.innerHTML = '<span class="embed-missing">Empty embed (no note title)</span>';
                    }

                    content.appendChild(embedPlaceholder);
                }
        return content;
    },

    // ─── FIND / REPLACE ───

    _findState: { open: false, query: '', matches: [], currentIdx: -1, replaceOpen: false },

    _escapeRegExp: function(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    _findOpen: function() {
        const bar = document.getElementById('editor-find-bar');
        const input = document.getElementById('find-input');
        if (!bar || !input) return;
        // Save currently focused element for restoration on close
        this._findState._lastFocusBlock = document.activeElement && this.container && this.container.contains(document.activeElement)
            ? document.activeElement
            : null;
        this._findState.open = true;
        bar.style.display = 'flex';
        input.value = '';
        input.focus();
        this._findState.query = '';
        this._findState.matches = [];
        this._findState.currentIdx = -1;
        this._findUpdateCount();
    },

    _findClose: function() {
        const bar = document.getElementById('editor-find-bar');
        if (!bar) return;
        bar.style.display = 'none';
        this._findState.open = false;
        this._findState.query = '';
        this._findState.matches = [];
        this._findState.currentIdx = -1;
        this._findState.replaceOpen = false;
        document.getElementById('find-replace-row').style.display = 'none';
        // Re-render to remove marks
        if (this.activePageId) this.render(this.activePageId);
        // Restore previously focused block element
        var focusEl = this._findState._lastFocusBlock;
        if (focusEl && typeof focusEl.focus === 'function') {
            focusEl.focus();
        } else {
            // Fallback: focus the first block
            const firstBlock = this.container ? this.container.querySelector('.block-content') : null;
            if (firstBlock) firstBlock.focus();
        }
        this._findState._lastFocusBlock = null;
    },

    _findSearch: function(query) {
        this._findState.query = query;
        this._findState.matches = [];
        this._findState.currentIdx = -1;

        if (!query || !this.activePageId) {
            this._findUpdateCount();
            if (this.activePageId) this.render(this.activePageId);
            return;
        }

        const page = this._getActivePage();
        if (!page || !page.blocks) {
            this._findUpdateCount();
            return;
        }

        const lowerQuery = query.toLowerCase();
        page.blocks.forEach(function(block) {
            if (!block.content) return;
            const content = block.content;
            const lower = content.toLowerCase();
            let idx = 0;
            while ((idx = lower.indexOf(lowerQuery, idx)) !== -1) {
                BlockEditor._findState.matches.push({
                    blockId: block.id,
                    start: idx,
                    end: idx + query.length,
                    text: content.substring(idx, idx + query.length)
                });
                idx += query.length;
            }
        });

        if (this._findState.matches.length > 0) {
            this._findState.currentIdx = 0;
        }

        this._findUpdateCount();
        this.render(this.activePageId);
        this._findScrollToCurrent();
    },

    _findNext: function() {
        if (this._findState.matches.length === 0) return;
        this._findState.currentIdx = (this._findState.currentIdx + 1) % this._findState.matches.length;
        this._findUpdateCount();
        this._findUpdateCurrentHighlight();
        this._findScrollToCurrent();
    },

    _findPrev: function() {
        if (this._findState.matches.length === 0) return;
        this._findState.currentIdx = (this._findState.currentIdx - 1 + this._findState.matches.length) % this._findState.matches.length;
        this._findUpdateCount();
        this._findUpdateCurrentHighlight();
        this._findScrollToCurrent();
    },

    _findUpdateCount: function() {
        const el = document.getElementById('find-match-count');
        if (!el) return;
        const total = this._findState.matches.length;
        const current = this._findState.currentIdx >= 0 ? this._findState.currentIdx + 1 : 0;
        el.textContent = total > 0 ? current + '/' + total : '0/0';
    },

    _findGetBlockEl: function(blockId) {
        return this.container ? this.container.querySelector('[data-block-id="' + blockId + '"]') : null;
    },

    _findUpdateCurrentHighlight: function() {
        if (!this.container) return;
        // Remove current class from all marks
        this.container.querySelectorAll('mark.find-match.current').forEach(function(m) {
            m.classList.remove('current');
        });
        // Add current to the current match
        var idx = this._findState.currentIdx;
        if (idx < 0 || idx >= this._findState.matches.length) return;
        var match = this._findState.matches[idx];
        var blockEl = this._findGetBlockEl(match.blockId);
        if (!blockEl) return;
        var marks = blockEl.querySelectorAll('mark.find-match');
        var matchInBlock = 0;
        for (var i = 0; i < this._findState.matches.length; i++) {
            if (this._findState.matches[i].blockId === match.blockId) {
                if (i === idx) break;
                matchInBlock++;
            }
        }
        if (matchInBlock < marks.length) {
            marks[matchInBlock].classList.add('current');
        }
    },

    _findScrollToCurrent: function() {
        var idx = this._findState.currentIdx;
        if (idx < 0 || idx >= this._findState.matches.length) return;
        var match = this._findState.matches[idx];
        var blockEl = this._findGetBlockEl(match.blockId);
        if (!blockEl) return;
        blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Also flash the block
        blockEl.style.transition = 'box-shadow 0.2s';
        blockEl.style.boxShadow = 'inset 0 0 0 2px #ffcc00';
        setTimeout(function() {
            blockEl.style.boxShadow = '';
        }, 800);
    },

    _findToggleReplace: function() {
        const row = document.getElementById('find-replace-row');
        if (!row) return;
        this._findState.replaceOpen = !this._findState.replaceOpen;
        row.style.display = this._findState.replaceOpen ? 'flex' : 'none';
        if (this._findState.replaceOpen) {
            document.getElementById('find-replace-input').focus();
        }
    },

    _findReplace: function() {
        if (this._findState.matches.length === 0 || this._findState.currentIdx < 0) return;
        // Push undo state before modifying
        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        var match = this._findState.matches[this._findState.currentIdx];
        var replaceText = document.getElementById('find-replace-input').value;
        var page = this._getActivePage();
        if (!page || !page.blocks) return;
        var block = page.blocks.find(function(b) { return b.id === match.blockId; });
        if (!block) return;
        // Replace in the data model
        block.content = block.content.substring(0, match.start) + replaceText + block.content.substring(match.end);
        // Shift subsequent matches in the same block
        var diff = replaceText.length - (match.end - match.start);
        for (var i = this._findState.currentIdx + 1; i < this._findState.matches.length; i++) {
            if (this._findState.matches[i].blockId === match.blockId) {
                this._findState.matches[i].start += diff;
                this._findState.matches[i].end += diff;
            }
        }
        // Remove this match and re-search from current position
        this._findState.matches.splice(this._findState.currentIdx, 1);
        if (this._findState.matches.length === 0) {
            this._findState.currentIdx = -1;
        } else if (this._findState.currentIdx >= this._findState.matches.length) {
            this._findState.currentIdx = 0;
        }
        PageManager.syncContent(this.activePageId);
        this.render(this.activePageId);
        this._findUpdateCount();
        // Focus next match
        if (this._findState.matches.length > 0) {
            this._findScrollToCurrent();
        }
    },

    _findReplaceAll: function() {
        if (this._findState.matches.length === 0) return;
        // Push undo state before modifying
        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        var query = this._findState.query;
        var replaceText = document.getElementById('find-replace-input').value;
        var escapedQuery = this._escapeRegExp(query);
        var regex = new RegExp(escapedQuery, 'gi');
        var page = this._getActivePage();
        if (!page || !page.blocks) return;
        var count = 0;
        page.blocks.forEach(function(block) {
            if (block.content && regex.test(block.content)) {
                regex.lastIndex = 0;
                block.content = block.content.replace(regex, replaceText);
                count++;
            }
        });
        // Reset find state
        this._findState.matches = [];
        this._findState.currentIdx = -1;
        PageManager.syncContent(this.activePageId);
        this.render(this.activePageId);
        this._findUpdateCount();
        if (window.showNotification) {
            window.showNotification('REPLACED ' + count + ' OCCURRENCE' + (count !== 1 ? 'S' : ''));
        }
    },

    _findApplyHighlights: function() {
        if (!this._findState.query || !this.container) return;
        var query = this._findState.query.toLowerCase();
        var self = this;

        // Walk each match's block element and wrap matching text in <mark>
        this._findState.matches.forEach(function(match, idx) {
            var blockEl = self._findGetBlockEl(match.blockId);
            if (!blockEl) return;
            var contentEl = blockEl.querySelector('.block-content, .task-text, .code-inner');
            if (!contentEl) return;

            // Walk text nodes and highlight matches
            self._findHighlightTextNodes(contentEl, query, idx === self._findState.currentIdx);
        });
    },

    _findHighlightTextNodes: function(root, query, isCurrent) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        var nodesToProcess = [];
        var node;
        while (node = walker.nextNode()) {
            // Skip nodes inside already-highlighted marks
            if (node.parentNode && node.parentNode.tagName === 'MARK') continue;
            if (node.textContent.toLowerCase().includes(query)) {
                nodesToProcess.push(node);
            }
        }

        nodesToProcess.forEach(function(textNode) {
            var text = textNode.textContent;
            var fragment = document.createDocumentFragment();
            var remaining = text;
            var firstMatch = true;

            while (remaining.length > 0) {
                var lower = remaining.toLowerCase();
                var idx = lower.indexOf(query);
                if (idx === -1) {
                    // No more matches — emit the rest
                    fragment.appendChild(document.createTextNode(remaining));
                    break;
                }

                // Text before this match
                if (idx > 0) {
                    fragment.appendChild(document.createTextNode(remaining.substring(0, idx)));
                }

                // The match wrapped in <mark>
                var mark = document.createElement('mark');
                mark.className = 'find-match';
                if (isCurrent && firstMatch) mark.classList.add('current');
                mark.textContent = remaining.substring(idx, idx + query.length);
                fragment.appendChild(mark);

                remaining = remaining.substring(idx + query.length);
                firstMatch = false;
            }

            textNode.parentNode.replaceChild(fragment, textNode);
        });
    },

    _initFindBar: function() {
        var self = this;

        // Find input
        var findInput = document.getElementById('find-input');
        if (findInput) {
            findInput.addEventListener('input', function() {
                self._findSearch(this.value);
            });
            findInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        self._findPrev();
                    } else {
                        self._findNext();
                    }
                } else if (e.key === 'Escape') {
                    self._findClose();
                }
            });
        }

        // Navigation buttons
        var nextBtn = document.getElementById('find-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function() { self._findNext(); });

        var prevBtn = document.getElementById('find-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function() { self._findPrev(); });

        // Close button
        var closeBtn = document.getElementById('find-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', function() { self._findClose(); });

        // Replace toggle
        var toggleBtn = document.getElementById('find-replace-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', function() { self._findToggleReplace(); });

        // Replace input
        var replaceInput = document.getElementById('find-replace-input');
        if (replaceInput) {
            replaceInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    self._findReplace();
                } else if (e.key === 'Escape') {
                    self._findClose();
                }
            });
        }

        // Replace / Replace All buttons
        var replaceBtn = document.getElementById('find-replace-btn');
        if (replaceBtn) replaceBtn.addEventListener('click', function() { self._findReplace(); });

        var replaceAllBtn = document.getElementById('find-replace-all-btn');
        if (replaceAllBtn) replaceAllBtn.addEventListener('click', function() { self._findReplaceAll(); });
    },

    handleKeydown: function (e) {
        // Guard - Only run if editor is open
        if (!this.container || this.container.offsetParent === null) return;

        // Phase 3: Skip if SlashMenu is handling keyboard input
        if (window.SlashMenu && window.SlashMenu.visible) return;

        // WikiLink autocomplete handling (ArrowUp/Down/Enter/Escape)
        if (window.WikiLinkAutocomplete && window.WikiLinkAutocomplete.visible) {
            if (window.WikiLinkAutocomplete.handleKey(e)) return;
        }
        
        // 🛡️ FIX 1: The "External Input" Guard
        // Prevents the editor from deleting blocks when you Backspace in the Note Title
        var isExternalInput = (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) 
                              && !this.container.contains(e.target);
                              
        if (isExternalInput) {
            // Automatically clear block selection if you start typing elsewhere
            if (this.selectedBlockIds.length > 0) this.clearSelection();
            return; 
        }
        
        // Scope Guard - If no selection, only handle if target is inside editor
        // If there IS a selection, we handle it globally (because drag-select blurs focus to body)
        if (this.selectedBlockIds.length === 0 && !this.container.contains(e.target)) return;

        if (this._kHandleEscapeClear(e)) return;

        // Tab/Shift+Tab indent/unindent in code blocks
        if (this._kHandleCodeTab(e)) return;

        // Ported Tab Shortcuts (Fix for missing functionality)
        // CMD+Shift+X: Close Tab
        if (this._kHandleCloseTab(e)) return;

        // CMD+F: Open Find/Replace
        if (this._kHandleFindOpen(e)) return;

        // CMD+H: Toggle replace row (when find bar is open)
        if (this._kHandleFindToggle(e)) return;

        // F3 / Shift+F3: Navigate Find matches
        if (this._kHandleFindNavigate(e)) return;

        // Escape: Close find bar if open
        if (this._kHandleFindClose(e)) return;

        // CMD+1-9: Switch Tabs
        if (this._kHandleTabSwitch(e)) return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper && blockWrapper.getAttribute('data-block-type') === 'code') {
                var blockId = blockWrapper.getAttribute('data-block-id');
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                var block = page.blocks.find(function(b) { return b.id === blockId; });
                if (block && block.language === 'calc') {
                    e.preventDefault();
                    e.stopPropagation();
                    var currentText = e.target.textContent || block.content;
                    var expression = currentText.split('//')[0].trim();
                    try {
                        var result = BlockEditor.safeMathEval(expression);
                        var newContent = expression + ' // = ' + result;
                        block.content = newContent;
                        PageManager.updateBlock(this.activePageId, blockId, { content: block.content });
                        var inner = blockWrapper.querySelector('.code-inner');
                        if (inner) {
                            inner.innerHTML = BlockEditor.getCalcPreviewHtml(newContent);
                            inner.setAttribute('data-highlighted', 'true');
                            inner.blur(); 
                        }
                    } catch (err) {}
                    return;
                }
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) HistoryManager.redo();
            else HistoryManager.undo();
            return;
        }
        // Multi-Block Operations
        // Delete/Backspace with selection - delete all selected blocks
        var isEditingContent = e.target.closest('.block-content, .task-text, .code-inner, .image-caption');
        var hasTextSelection = window.getSelection().toString().length > 0;
        
        if ((e.key === 'Backspace' || e.key === 'Delete') && this.selectedBlockIds.length >= 1) {
            // Only intercept if we have multi-select OR if focus is outside editable content
            if (!isEditingContent || this.selectedBlockIds.length > 1) {
                e.preventDefault();
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                if (!page) return;
                
                // Handle delete for single focused non-editable block
                if (this.selectedBlockIds.length === 0) {
                     var blockEl = e.target.closest('.block-wrapper');
                     if (blockEl) {
                         var bType = blockEl.getAttribute('data-block-type');
                         // If it's a non-text block (divider, image, etc) that has focus
                         if (['divider', 'image', 'table', 'kanban_ref'].includes(bType)) {
                             var bId = blockEl.getAttribute('data-block-id');
                             if (bId) {
                                  PageManager.deleteBlock(BlockEditor.activePageId, bId);
                                  this.render(this.activePageId);
                                  saveData();
                                  return;
                             }
                         }
                     }
                }

                // Delete all selected blocks
                e.preventDefault();
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                if (!page) return;
                
                // Delete all selected blocks
                var idsToDelete = this.selectedBlockIds.slice();
                idsToDelete.forEach(function(id) {
                    PageManager.deleteBlock(BlockEditor.activePageId, id);
                });
                
                this.clearSelection();
                this.render(this.activePageId);
                saveData();
                return;
            }
        }
        
        // CMD+C with selection - copy all selected blocks
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && this.selectedBlockIds.length >= 1) {
            // If user has text selected inside a block, let browser handle normal copy
            if (hasTextSelection) return;
            
            // Copy all selected blocks
            e.preventDefault();
            var blocks = this.getSelectedBlocks();
            var allText = blocks.map(function(block) {
                if (block.type === 'task') return (block.checked ? '- [x] ' : '- [ ] ') + (block.content || '');
                else if (block.type === 'code') return '```' + (block.language || '') + '\n' + (block.content || '') + '\n```';
                else if (block.type === 'h1') return '# ' + (block.content || '');
                else if (block.type === 'h2') return '## ' + (block.content || '');
                else if (block.type === 'h3') return '### ' + (block.content || '');
                else if (block.type === 'quote') return '> ' + (block.content || '');
                else if (block.type === 'bullet') return '- ' + (block.content || '');
                else if (block.type === 'numbered') return '1. ' + (block.content || '');
                else if (block.type === 'divider') return '---';
                else return block.content || '';
            }).join('\n');
            
            navigator.clipboard.writeText(allText).then(function() {
                if (typeof showNotification === 'function') {
                    showNotification('Copied ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
                }
            });
            return;
        }
        
        // CMD+X with selection - cut all selected blocks
        if ((e.metaKey || e.ctrlKey) && e.key === 'x' && this.selectedBlockIds.length >= 1) {
            // If user has text selected inside a block, let browser handle normal cut
            if (hasTextSelection) return;
            
            // Cut all selected blocks
            e.preventDefault();
            var blocks = this.getSelectedBlocks();
            var allText = blocks.map(function(block) {
                 if (block.type === 'task') return (block.checked ? '- [x] ' : '- [ ] ') + (block.content || '');
                 else if (block.type === 'code') return '```' + (block.language || '') + '\n' + (block.content || '') + '\n```';
                 else if (block.type === 'h1') return '# ' + (block.content || '');
                 else if (block.type === 'h2') return '## ' + (block.content || '');
                 else if (block.type === 'h3') return '### ' + (block.content || '');
                 else if (block.type === 'quote') return '> ' + (block.content || '');
                 else if (block.type === 'bullet') return '- ' + (block.content || '');
                 else if (block.type === 'numbered') return '1. ' + (block.content || '');
                 else if (block.type === 'divider') return '---';
                 else return block.content || '';
            }).join('\n');
            
            var self = this;
            navigator.clipboard.writeText(allText).then(function() {
                // Delete after copy
                var idsToDelete = self.selectedBlockIds.slice();
                idsToDelete.forEach(function(id) {
                    PageManager.deleteBlock(self.activePageId, id);
                });
                self.clearSelection();
                self.render(self.activePageId);
                saveData();
                if (typeof showNotification === 'function') {
                    showNotification('Cut ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
                }
            });
            return;
        }

        // DUPLICATE BLOCK (CMD+D)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
            e.preventDefault();
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                var blockId = blockWrapper.getAttribute('data-block-id');
                this.duplicateBlock(blockId);
            }
            return;
        }
        
        // Tab / Shift+Tab for Indentation
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                e.preventDefault();
                var blockId = blockWrapper.getAttribute('data-block-id');
                var page = State.NOTES.find(n => n.id === this.activePageId);
                var block = page ? page.blocks.find(b => b.id === blockId) : null;
                if (block) {
                    var newLevel = (block.level || 0) + (e.shiftKey ? -1 : 1);
                    PageManager.updateBlock(this.activePageId, block.id, { level: newLevel });
                    this.render(this.activePageId);
                    saveData();
                }
                return;
            }
        }

        // Alt + Arrow for Move Block
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            
            // 🛡️ FIX 2: Allow moving selected blocks even if text focus is lost
            var targetBlockId = null;
            var blockWrapper = e.target.closest('.block-wrapper');
            
            if (blockWrapper) {
                targetBlockId = blockWrapper.getAttribute('data-block-id');
            } else if (this.selectedBlockIds.length === 1) {
                targetBlockId = this.selectedBlockIds[0];
            }

            if (targetBlockId) {
                HistoryManager.push(this.activePageId);
                var page = State.NOTES.find(n => n.id === BlockEditor.activePageId);
                var idx = page.blocks.findIndex(b => b.id === targetBlockId);
                if (idx === -1) return;
                
                var swapped = false;
                if (e.key === 'ArrowUp' && idx > 0) {
                    var temp = page.blocks[idx - 1];
                    page.blocks[idx - 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    swapped = true;
                } else if (e.key === 'ArrowDown' && idx < page.blocks.length - 1) {
                    var temp = page.blocks[idx + 1];
                    page.blocks[idx + 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    swapped = true;
                }

                if (swapped) {
                    PageManager.reorderBlocks(page);
                    PageManager.syncContent(this.activePageId);
                    saveData();
                    this.render(this.activePageId);
                    
                    // Keep the block selected instead of forcing a text cursor inside
                    this.selectBlock(targetBlockId, false);
                    this.flashBlock(targetBlockId);
                }
            }
            return;
        }
        
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;
        var blockId = blockEl.getAttribute('data-block-id');
        var blockType = blockEl.getAttribute('data-block-type');

        // Enter = split block at cursor
        if (e.key === 'Enter' && !e.shiftKey) {
            if (blockType === 'code' || blockType === 'image' || blockType === 'table') return;
            e.preventDefault();
            var page = State.NOTES.find(n => n.id === this.activePageId);
            if (!page) return;
            
            var sel = window.getSelection();
            var range = sel.getRangeAt(0);
            var contentEl = e.target;
            
            var beforeRange = document.createRange();
            beforeRange.selectNodeContents(contentEl);
            beforeRange.setEnd(range.startContainer, range.startOffset);
            var textBefore = beforeRange.toString();
            
            var afterRange = document.createRange();
            afterRange.selectNodeContents(contentEl);
            afterRange.setStart(range.endContainer, range.endOffset);
            var textAfter = afterRange.toString();
            
            PageManager.updateBlock(this.activePageId, blockId, { content: textBefore });
            
            // Enter on empty list item -> revert to paragraph
            if (['bullet', 'numbered', 'task'].includes(blockType) && !textBefore.trim() && !textAfter.trim()) {
                PageManager.updateBlock(this.activePageId, blockId, { type: 'p', level: 0 });
                this.render(this.activePageId);
                return;
            }
            
            var newType = ['bullet', 'numbered', 'task'].includes(blockType) ? blockType : 'p';
            var currentBlock = page.blocks.find(b => b.id === blockId);
            var newBlock = PageManager.addBlock(page, newType, textAfter, blockId);
            if (currentBlock && currentBlock.level) {
                PageManager.updateBlock(this.activePageId, newBlock.id, { level: currentBlock.level });
            }
            
            this.focusedBlockId = newBlock.id;
            this.render(this.activePageId);
            
            var self = this;
            setTimeout(function() {
                var newEl = self.container.querySelector('[data-block-id="' + newBlock.id + '"] .block-content');
                if (newEl) {
                    newEl.focus();
                    var r = document.createRange();
                    r.selectNodeContents(newEl);
                    r.collapse(true);
                    var s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(r);
                }
            }, 0);
            return;
        }

        // Backspace at start = merge with previous block
        if (e.key === 'Backspace') {
            if (blockType === 'image' || blockType === 'table') return;
            var sel = window.getSelection();
            var atStart = false;
            if (sel.rangeCount > 0) {
                var range = sel.getRangeAt(0);
                var startRange = range.cloneRange();
                startRange.selectNodeContents(e.target);
                startRange.setEnd(range.startContainer, range.startOffset);
                atStart = startRange.toString().length === 0 && range.collapsed;
            }
            if (atStart) {
                var page = State.NOTES.find(n => n.id === this.activePageId);
                if (!page) return;
                var idx = page.blocks.findIndex(b => b.id === blockId);
                if (idx > 0) {
                    e.preventDefault();
                    var prevBlock = page.blocks[idx - 1];
                    var currentText = e.target.textContent || '';
                    var prevText = prevBlock.content || '';
                    var cursorPosition = prevText.length;
                    PageManager.updateBlock(this.activePageId, prevBlock.id, { content: prevText + currentText });
                    PageManager.deleteBlock(this.activePageId, blockId);
                    this.focusedBlockId = prevBlock.id;
                    this.render(this.activePageId);
                    var self = this;
                    setTimeout(function() {
                        var prevEl = self.container.querySelector('[data-block-id="' + prevBlock.id + '"] .block-content');
                        if (!prevEl) prevEl = self.container.querySelector('[data-block-id="' + prevBlock.id + '"] .task-text');
                        if (prevEl) {
                            prevEl.focus();
                            var textNode = prevEl.firstChild;
                            if (textNode && textNode.nodeType === 3) {
                                var r = document.createRange();
                                var pos = Math.min(cursorPosition, textNode.length);
                                r.setStart(textNode, pos);
                                r.collapse(true);
                                var s = window.getSelection();
                                s.removeAllRanges();
                                s.addRange(r);
                            }
                        }
                    }, 0);
                }
            }
            return;
        }

        // Arrow keys navigation between blocks
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            var page = State.NOTES.find(n => n.id === this.activePageId);
            if (!page) return;

            // CMD+Arrow = Quick Navigation (Jump to Start/End)
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                if (e.key === 'ArrowUp') {
                     if (page.blocks.length > 0) this.focusBlock(page.blocks[0].id);
                } else {
                     if (page.blocks.length > 0) this.focusBlock(page.blocks[page.blocks.length - 1].id);
                }
                return;
            }
            
            var sel = window.getSelection();
            var atStart = false, atEnd = false;
            if (sel.rangeCount > 0) {
                var range = sel.getRangeAt(0);
                var startRange = range.cloneRange();
                startRange.selectNodeContents(e.target);
                startRange.setEnd(range.startContainer, range.startOffset);
                atStart = startRange.toString().length === 0;
                var endRange = range.cloneRange();
                endRange.selectNodeContents(e.target);
                endRange.setStart(range.endContainer, range.endOffset);
                atEnd = endRange.toString().length === 0;
            } else {
                atStart = atEnd = true;
            }
            
            var idx = page.blocks.findIndex(b => b.id === blockId);
            
            if (e.key === 'ArrowUp' && atStart) {
                e.preventDefault();
                var targetIdx = idx - 1;
                while (targetIdx >= 0 && ['divider', 'image', 'kanban_ref', 'table'].includes(page.blocks[targetIdx].type)) {
                    targetIdx--;
                }
                if (targetIdx >= 0) this.focusBlock(page.blocks[targetIdx].id);
            } else if (e.key === 'ArrowDown' && atEnd) {
                e.preventDefault();
                var targetIdx = idx + 1;
                while (targetIdx < page.blocks.length && ['divider', 'image', 'kanban_ref', 'table'].includes(page.blocks[targetIdx].type)) {
                    targetIdx++;
                }
                if (targetIdx < page.blocks.length) {
                    this.focusBlock(page.blocks[targetIdx].id);
                } else {
                    // Start V78: Fix for "Pushing Down" issue
                    // Use the ID of the LAST block in the list to append AFTER it, 
                    // instead of inserting after the current block.
                    var lastBlockId = page.blocks[page.blocks.length - 1].id;
                    var newBlock = PageManager.addBlock(page, 'p', '', lastBlockId);
                    this.render(this.activePageId);
                    if (newBlock) this.focusBlock(newBlock.id);
                }
            }
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u', 'k', 'l'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            this.applyFormatting(e.key.toLowerCase());
        }
        if (e.key === '/') {
            var blockEl = e.target.closest('.block-wrapper');
            setTimeout(function () {
                if (typeof SlashMenu !== 'undefined') SlashMenu.show(blockEl);
            }, 10);
        }
    },

    // Flash a block briefly (visual feedback for reorder / type change)
    _kHandleEscapeClear: function(e) {
        if (e.key === 'Escape' && this.selectedBlockIds.length > 0) {

            e.preventDefault();
            e.stopImmediatePropagation();
            this.clearSelection();
            return true;
        }
        return false;
    },

    _kHandleCodeTab: function(e) {
        if (window.CodeBlockTools && e.target.classList.contains('code-inner')) {

            if (e.key === 'Tab') {
                if (window.CodeBlockTools.handleKeydown(e)) return true;
            }
        }
        return false;
    },

    _kHandleCloseTab: function(e) {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'x') {

            // Check if we have a selection -> Cut behavior?
            // User convention: typically CMD+X is cut. CMD+Shift+X is Close Tab.
            // But verify we don't conflict with Cut logic (which is CMD+X typically).
            // BlockEditor handles CMD+X (Cut) separately.
            e.preventDefault();
            e.stopPropagation();
            if (typeof TabManager !== 'undefined' && TabManager.tabs.length > 0) {
                TabManager.closeTab(TabManager.activeIndex);
            }
            return true;
        }
        return false;
    },

    _kHandleTabSwitch: function(e) {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {

            var tabIndex = parseInt(e.key, 10) - 1;
            if (typeof TabManager !== 'undefined' && tabIndex < TabManager.tabs.length) {
                e.preventDefault();
                e.stopPropagation();
                TabManager.switchTo(tabIndex);
                return true;
            }
        }
        return false;
    },

    _kHandleFindOpen: function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {

            e.preventDefault();
            e.stopPropagation();
            this._findOpen();
            return true;
        }
        return false;
    },

    _kHandleFindToggle: function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'h' && this._findState.open) {

            e.preventDefault();
            this._findToggleReplace();
            return true;
        }
        return false;
    },

    _kHandleFindNavigate: function(e) {
        if (e.key === 'F3' && this._findState.open) {

            e.preventDefault();
            if (e.shiftKey) {
                this._findPrev();
            } else {
                this._findNext();
            }
            return true;
        }
        return false;
    },

    _kHandleFindClose: function(e) {
        if (e.key === 'Escape' && this._findState.open) {

            e.preventDefault();
            this._findClose();
            return true;
        }
        return false;
    },

    flashBlock: function(blockId) {
        var el = this.container.querySelector('[data-block-id="' + blockId + '"]');
        if (!el) return;
        el.classList.remove('block-flash');
        // Force reflow so re-adding the class restarts the animation
        void el.offsetWidth;
        el.classList.add('block-flash');
        el.addEventListener('animationend', function handler() {
            el.classList.remove('block-flash');
            el.removeEventListener('animationend', handler);
        });
    },

    // Markdown Input Rules - auto-convert paragraph blocks on trigger patterns
    checkInputRules: function(blockId, content) {
        var rules = [
            { pattern: /^### $/, type: 'h3',       strip: '### ' },
            { pattern: /^## $/,  type: 'h2',       strip: '## ' },
            { pattern: /^# $/,   type: 'h1',       strip: '# ' },
            { pattern: /^- $/,   type: 'bullet',   strip: '- ' },
            { pattern: /^\* $/,  type: 'bullet',   strip: '* ' },
            { pattern: /^1\. $/,  type: 'numbered', strip: '1. ' },
            { pattern: /^> $/,   type: 'quote',    strip: '> ' },
            { pattern: /^\[\] $/, type: 'task',     strip: '[] ' },
            { pattern: /^\[ \] $/,type: 'task',     strip: '[ ] ' },
            { pattern: /^---$/,  type: 'divider',   strip: '---' }
        ];

        for (var i = 0; i < rules.length; i++) {
            if (rules[i].pattern.test(content)) {
                var remaining = content.replace(rules[i].strip, '');
                var updates = { type: rules[i].type, content: remaining };
                if (rules[i].type === 'task') updates.checked = false;
                PageManager.updateBlock(this.activePageId, blockId, updates);
                this.render(this.activePageId);
                if (rules[i].type === 'divider') {
                    // Add a new empty paragraph after divider and focus it
                    var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                    if (page) {
                        var newBlock = PageManager.addBlock(page, 'p', '', blockId);
                        this.render(this.activePageId);
                        if (newBlock) this.focusBlock(newBlock.id);
                    }
                } else {
                    this.focusBlock(blockId);
                }
                this.flashBlock(blockId);
                return true; // Rule matched
            }
        }
        return false;
    },

    handleInput: function (e) {
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;
        var blockId = blockEl.getAttribute('data-block-id');
        var blockType = blockEl.getAttribute('data-block-type');
        
        // Exclude strictly pure-UI inputs that shouldn't trigger WYSIWYG translation
        if (blockType === 'kanban_ref' || blockType === 'query' || blockType === 'callout') return;
        
        // Bi-directional WYSIWYG Support
        var rawHtml = e.target.innerHTML || '';
        var strContent = e.target.innerText || ''; 
        var newContent = this.htmlToMarkdown(rawHtml);
        
        if (blockType === 'image') {
            if (e.target.classList.contains('image-caption')) {
                // Keep the single-line rule for captions, but convert to MD
                newContent = newContent.replace(/[\r\n]+/g, ' ').trim();
                PageManager.updateBlock(this.activePageId, blockId, { caption: newContent }, true);
            }
        } else if (blockType === 'table') {
            if (e.target.classList.contains('table-cell')) {
                var rowIdx = parseInt(e.target.getAttribute('data-row'), 10);
                var colIdx = parseInt(e.target.getAttribute('data-col'), 10);
                var page = State.NOTES.find(n => n.id === this.activePageId);
                var block = page.blocks.find(b => b.id === blockId);
                if (block && block.tableData) {
                    if (rowIdx === -1) {
                        block.tableData.headers[colIdx] = newContent;
                    } else {
                        block.tableData.rows[rowIdx][colIdx] = newContent;
                    }
                    // Silent update maintains cursor focus for continuous typing
                    PageManager.updateBlock(this.activePageId, blockId, { tableData: block.tableData }, true);
                }
            }
        } else {
            // Standard Text Blocks
            if (blockType === 'p' && this.checkInputRules(blockId, strContent)) return;
            PageManager.updateBlock(this.activePageId, blockId, { content: newContent });
        }
        
        if (typeof SlashMenu !== 'undefined' && SlashMenu.visible) {
            var slashMatch = newContent.match(/\/(\w*)$/);
            if (slashMatch) {
                SlashMenu.filterQuery = slashMatch[1] || '';
                SlashMenu.selectedIndex = 0;
                SlashMenu.render();
            } else {
                SlashMenu.hide();
            }
        }
        
        clearTimeout(this.saveTimeout);
        var self = this;
        this.saveTimeout = setTimeout(function () {
            PageManager.syncContent(self.activePageId);
            if (typeof Notes !== 'undefined') {
                if(Notes.updateWordCount) Notes.updateWordCount();
                if(Notes.updateTags) Notes.updateTags();
            }
            if (typeof saveData === 'function') saveData();
            // Update MetadataCache so backlinks/wiki links are indexed
            if (window.MetadataCache && window.MetadataCache.updateNote) {
                window.MetadataCache.updateNote(self.activePageId);
            }
        }, 500);

        // WikiLink autocomplete: check for [[ pattern on input
        if (window.WikiLinkAutocomplete) {
            window.WikiLinkAutocomplete.checkInput(e);
        }
    },
    
    handleClick: function (e) {
        if (this.selectedBlockIds && this.selectedBlockIds.length > 0) return;
        var blockEl = e.target.closest('.block-wrapper');
        if (blockEl) {
            var id = blockEl.getAttribute('data-block-id');
            this.focusedBlockId = id;
            var type = blockEl.getAttribute('data-block-type');
            // /V105: Explicitly focus non-editable blocks to enable keyboard delete, 
            // BUT avoid stealing focus if they explicitly clicked an editable child!
            if (['divider', 'kanban_ref'].includes(type) || 
                (type === 'image' && !e.target.closest('.image-caption')) || 
                (type === 'table' && !e.target.closest('.table-cell'))) {
                this.focusBlock(id);
            }
        } else {
             // Clicked outside blocks (empty space at bottom)
             // Check if last block is non-text or the list is empty
             if (this.activePageId) {
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                if (page) {
                    var lastBlock = page.blocks.length > 0 ? page.blocks[page.blocks.length - 1] : null;
                    
                    // If last block is non-text (image, table, divider, kanban), append new paragraph
                    if (!lastBlock || ['image', 'table', 'divider', 'kanban_ref'].includes(lastBlock.type)) {
                        var newBlock = PageManager.addBlock(page, 'p', '');
                        this.render(this.activePageId);
                        if(newBlock) this.focusBlock(newBlock.id);
                    } else {
                        // Just focus the last block
                        if (lastBlock) this.focusBlock(lastBlock.id);
                    }
                }
             }
        }
    },
    
    handlePaste: function(e) {
        var clipboardData = e.clipboardData;
        if (!clipboardData) return;
        
        // 1. Check for Files (Images)
        if (clipboardData.files && clipboardData.files.length > 0) {
            e.preventDefault();
            for (var i = 0; i < clipboardData.files.length; i++) {
                var file = clipboardData.files[i];
                if (file.type.startsWith('image/')) {
                    this.processImageFile(file);
                }
            }
            return;
        }

        // 2. Check for Text
        var text = clipboardData.getData('text/plain');
        if (text) {
             // If we are INSIDE a code block, force plain text paste
              var blockEl = e.target.closest('.block-wrapper');
              
              // If target is not a wrapper (e.g. container) but we have a single selected code block, use that
              if (!blockEl && this.selectedBlockIds.length === 1) {
                   var selectedId = this.selectedBlockIds[0];
                   var selectedEl = this.container.querySelector('.block-wrapper[data-block-id="' + selectedId + '"]');
                   if (selectedEl && selectedEl.getAttribute('data-block-type') === 'code') {
                       blockEl = selectedEl;
                   }
              }
              
              // Also check if target is explicitly within code-inner or block-code (handles helper elements)
              if (!blockEl) {
                  var innerCode = e.target.closest('.code-inner, .block-code');
                  if (innerCode) blockEl = innerCode.closest('.block-wrapper');
              }

              // Double check if we are in a code block
              if (blockEl && blockEl.getAttribute('data-block-type') === 'code') {
                  e.preventDefault();
                  // Force Plain Text via Range API (most robust)
                  var sel = window.getSelection();
                  var textToUse = text; 
                  
                  // Sanitization: If text looks like corrupted HTML-as-Text (e.g. "color:..." artifact), strip it? 
                  // But usually with Range API this won't happen unless "text" variable is already corrupted.
                  // Just insert it.
                  
                  // If we are "selected" but not "focused" (rangeCount could be 0 or outside block)
                  var codeInner = blockEl.querySelector('.code-inner');
                  
                  if (sel.rangeCount > 0 && codeInner.contains(sel.anchorNode)) {
                      var range = sel.getRangeAt(0);
                      range.deleteContents();
                      var textNode = document.createTextNode(textToUse);
                      range.insertNode(textNode);
                      
                      range.setStartAfter(textNode);
                      range.setEndAfter(textNode);
                      sel.removeAllRanges();
                      sel.addRange(range);
                  } else {
                       // Fallback: If no valid selection inside code block, append to end
                       // This handles the "Selected but not focused" case
                       if (codeInner) {
                           // If code block was just highlighted syntax, we need to revert to raw text first?
                           // Actually, focus() usually handles that via the 'focus' event listener we saw in renderBlock.
                           // But if we bypass focus()...
                           
                           // If data-highlighted is present, we should probably clear it and set textContent?
                           if (codeInner.getAttribute('data-highlighted') === 'true') {
                               // Get raw content from model or textContent (which shouldn't have HTML tags if highlighted correctly)
                               // But InnerHTML has spans. TextContent has code.
                               // We just append to textContent.
                               var currentCode = codeInner.textContent;
                               codeInner.textContent = currentCode + textToUse;
                               codeInner.removeAttribute('data-highlighted'); // Enter "edit mode"
                           } else {
                               var textNode = document.createTextNode(textToUse);
                               codeInner.appendChild(textNode);
                           }
                           
                           // Manually trigger input
                       }
                  }
                  
                  var event = new Event('input', { bubbles: true });
                  blockEl.dispatchEvent(event); // Dispatch on wrapper or specific target?
                  if (codeInner) codeInner.dispatchEvent(event);
                  
                  return; 
              }
             
             // If short text (single line), let default paste happen to insert at cursor
             if (!text.includes('\n') && text.length < 200) {
                 return;
             }

             // Multi-line paste or large text -> Parse into blocks
             e.preventDefault();
             var page = State.NOTES.find(n => n.id === this.activePageId);
             
             // Where to insert?
             var afterBlockId = null;
             if (blockEl) afterBlockId = blockEl.getAttribute('data-block-id');
             
             var lines = text.split('\n');
             var buffer = [];
             
             // Helper to flush buffer
             var self = this;
             var flushBuffer = function() {
                 if (buffer.length === 0) return;
                 var content = buffer.join('\n');
                 var newBlock = PageManager.addBlock(page, 'p', content, afterBlockId);
                 afterBlockId = newBlock.id;
                 buffer = [];
             };
             
             lines.forEach(function(line) {
                 var trimmed = line.trim();
                 
                 // Headers
                 if (trimmed.startsWith('# ')) {
                     flushBuffer();
                     var newBlock = PageManager.addBlock(page, 'h1', trimmed.substring(2), afterBlockId);
                     afterBlockId = newBlock.id;
                 } else if (trimmed.startsWith('## ')) {
                     flushBuffer();
                     var newBlock = PageManager.addBlock(page, 'h2', trimmed.substring(3), afterBlockId);
                     afterBlockId = newBlock.id;
                 } else if (trimmed.startsWith('### ')) {
                     flushBuffer();
                     var newBlock = PageManager.addBlock(page, 'h3', trimmed.substring(4), afterBlockId);
                     afterBlockId = newBlock.id;
                 }
                 // Task
                 else if (trimmed.match(/^- \[[ xX]\] /)) {
                     flushBuffer();
                     var isChecked = trimmed.toLowerCase().startsWith('- [x] ');
                     var content = trimmed.substring(6);
                     var newBlock = PageManager.addBlock(page, 'task', content, afterBlockId);
                     newBlock.checked = isChecked;
                     afterBlockId = newBlock.id;
                 }
                 // Bullet
                 else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                     flushBuffer();
                     var newBlock = PageManager.addBlock(page, 'bullet', trimmed.substring(2), afterBlockId);
                     afterBlockId = newBlock.id;
                 }
                 // Numbered
                 else if (trimmed.match(/^\d+\. /)) {
                     flushBuffer();
                     var content = trimmed.replace(/^\d+\. /, '');
                     var newBlock = PageManager.addBlock(page, 'numbered', content, afterBlockId);
                     afterBlockId = newBlock.id;
                 }
                 // Divider
                 else if (trimmed === '---') {
                     flushBuffer();
                     var newBlock = PageManager.addBlock(page, 'divider', '', afterBlockId);
                     afterBlockId = newBlock.id;
                 }
                 // Code Block Fence
                 else if (trimmed.startsWith('```')) {
                     flushBuffer(); // TODO: Better multi-line code handling
                     var lang = trimmed.substring(3);
                     var newBlock = PageManager.addBlock(page, 'code', '', afterBlockId);
                     newBlock.language = lang || 'javascript';
                     afterBlockId = newBlock.id;
                 }
                 else {
                     // buffer normal text
                     buffer.push(line);
                 }
             });
             flushBuffer();
             
             this.render(this.activePageId);
             this.focusBlock(afterBlockId); // Focus last inserted
        }
    },
    
    // Image File Processing (Extracted)
    processImageFile: function(file) {
        var reader = new FileReader();
        var self = this;
        reader.onload = function(e) {
            var dataUrl = e.target.result;
            // Create image block
            var page = State.NOTES.find(n => n.id === self.activePageId);
            
            // Where?
            var afterBlockId = null;
            if (self.focusedBlockId) afterBlockId = self.focusedBlockId;
            else if (page.blocks.length > 0) afterBlockId = page.blocks[page.blocks.length - 1].id;
            
            // If focused block is empty paragraph, replace it
            if (self.focusedBlockId) {
                var currentBlock = page.blocks.find(b => b.id === self.focusedBlockId);
                if (currentBlock && currentBlock.type === 'p' && !currentBlock.content) {
                   // Reuse
                   currentBlock.type = 'image';
                   currentBlock.content = dataUrl;
                   currentBlock.caption = 'Image ' + new Date().toLocaleTimeString();
                   self.render(self.activePageId);
                   return;
                }
            }
            
            var newBlock = PageManager.addBlock(page, 'image', dataUrl, afterBlockId);
            newBlock.caption = 'Image ' + new Date().toLocaleTimeString();
            self.render(self.activePageId);
        };
        reader.readAsDataURL(file);
    },
};
