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

    // Helper for Callout Icons
    getCalloutIcon: function(type) {
        var icons = {
            info: 'ℹ️', warning: '⚠️', danger: '🛑', success: '✅',
            note: '📝', tip: '💡', quote: '💬'
        };
        return icons[type.toLowerCase()] || 'ℹ️';
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
        }
        
        // V90: Wiki Link Highlighting (Global)
        // This runs AFTER code highlighting to ensure links work even in mixed content
        // Pattern: [[Note Title]] or [[Note Title|Display]]
        safeCode = safeCode.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function(match, noteTitle, displayText) {
            displayText = displayText || noteTitle;
            return '<span class="wiki-link" data-note-title="' + noteTitle.trim() + '">' + displayText.trim() + '</span>';
        });

        return safeCode;
    },

    // V109: Bi-directional WYSIWYG Translator
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

    // V109: Bi-directional WYSIWYG Translator
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

    /**
     * applyFormatting - Applies inline formatting (bold, italic, underline, link)
     * Extracted from Notes.processEditorShortcut in vinland.js
     * @param {string} key - 'b' for bold, 'i' for italic, 'u' for underline, 'k' for link
     */
    // V13.4: Precise Selection/Cursor Management
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

    // V109: Restored WYSIWYG Formatting via execCommand
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

        // Trigger input event to immediately translate the HTML to Markdown via V109 logic
        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
        contentEl.dispatchEvent(inputEvent);
    },

    init: function (containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        // V88: Listen on document to catch keys even when focus is lost (e.g. after drag-select blur)
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
                
                // V89: Drag Handle Logic (Notion-Style)
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

    render: function (pageId, skipFocus) {
        this.activePageId = pageId;
        var page = State.NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return;

        this.container.innerHTML = '';
        if (!page.blocks || page.blocks.length === 0) PageManager.addBlock(page, 'p', '');

        var self = this;
        var listCounter = 0;

        page.blocks.forEach(function (block) {
            // V79: Smart Numbering Logic (Match PageManager generator)
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

        if (this.focusedBlockId && !skipFocus) this.focusBlock(this.focusedBlockId);
    },
    
    // Extracted renderBlock and others from vinland.js...
    // Note: Due to size, I am compacting slightly but keeping logic.
    // ... [Insert full renderBlock and other methods] ...
    // Since write_to_file has a limit? No, but I should be careful.
    // I will insert the rest of the file content in the next step to avoid overly large argument if broken. 
    // Actually, I'll try to put it all.
    
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
        var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
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
        var page = State.NOTES.find(n => n.id === this.activePageId);
        if (!page || !page.blocks) return;
        this.selectedBlockIds = page.blocks.map(b => b.id);
        this.updateSelectionVisuals();
    },

    clearSelection: function() {
        this.selectedBlockIds = [];
        this.lastSelectedId = null; 
        this.updateSelectionVisuals();
    },

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
        var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!page || !page.blocks) return [];
        var selected = [];
        this.selectedBlockIds.forEach(function(id) {
            var block = page.blocks.find(function(b) { return b.id === id; });
            if (block) selected.push(block);
        });
        return selected;
    },

    reorderBlock: function(draggedId, targetId) {
        var note = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!note || !note.blocks) return;
        
        if (this.selectedBlockIds.length > 1 && this.selectedBlockIds.includes(draggedId)) {
            this.reorderSelectedBlocks(targetId);
            return;
        }

        var draggedIdx = note.blocks.findIndex(function(b) { return b.id === draggedId; });
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return;

        // FIX 2: Push to Undo Stack
        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        // FIX 1: Directional Drop Logic
        var isDraggingDown = draggedIdx < targetIdx;
        var draggedBlock = note.blocks.splice(draggedIdx, 1)[0];
        
        // Recalculate target index because array length changed
        var newTargetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (isDraggingDown) {
            newTargetIdx++; // Insert AFTER the target if we dragged downwards
        }

        note.blocks.splice(newTargetIdx, 0, draggedBlock);
        
        // FIX 3: Update order properties
        PageManager.reorderBlocks(note); 
        
        saveData();
        PageManager.syncContent(this.activePageId);
        
        // FIX 4: Restore Focus (remove 'true')
        this.focusedBlockId = draggedId;
        this.render(this.activePageId); 
        this.flashBlock(draggedId); // Visual feedback
    },

    reorderSelectedBlocks: function(targetId) {
        var note = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!note || !note.blocks) return;
        
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (targetIdx === -1) return;

        // FIX 2: Push to Undo Stack
        if (typeof HistoryManager !== 'undefined') HistoryManager.push(this.activePageId);

        var selectedBlocks = [];
        var remainingBlocks = [];
        var firstSelectedIdx = -1;

        note.blocks.forEach(function(block, idx) {
            if (BlockEditor.selectedBlockIds.includes(block.id)) {
                selectedBlocks.push(block);
                if (firstSelectedIdx === -1) firstSelectedIdx = idx;
            } else {
                remainingBlocks.push(block);
            }
        });

        // FIX 1: Directional drop for multi-select
        var newTargetIdx = remainingBlocks.findIndex(function(b) { return b.id === targetId; });
        if (newTargetIdx === -1) newTargetIdx = remainingBlocks.length;
        
        var isDraggingDown = firstSelectedIdx < targetIdx;
        if (isDraggingDown) {
            newTargetIdx++; 
        }

        remainingBlocks.splice.apply(remainingBlocks, [newTargetIdx, 0].concat(selectedBlocks));
        note.blocks = remainingBlocks;
        
        // FIX 3: Update order properties
        PageManager.reorderBlocks(note);

        saveData();
        PageManager.syncContent(this.activePageId);
        
        // FIX 4: Restore Focus
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

        var dragHandle = document.createElement('div');
        dragHandle.className = 'block-drag-handle';
        dragHandle.setAttribute('title', 'Drag to reorder');
        // SVG removed for legacy CSS support
        dragHandle.textContent = '';
        
        if (block.level) wrapper.style.paddingLeft = (block.level * 24) + 'px';
        
        // V78: Alignment Logic
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
        wrapper.appendChild(dragHandle);

        var content;
        var self = this;

        wrapper.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', block.id);
            e.dataTransfer.effectAllowed = 'move';
            wrapper.classList.add('dragging');
            BlockEditor.draggedBlockId = block.id;
        });
        wrapper.addEventListener('dragend', function(e) {
            wrapper.classList.remove('dragging');
            BlockEditor.draggedBlockId = null;
            document.querySelectorAll('.block-wrapper.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        wrapper.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (BlockEditor.draggedBlockId && BlockEditor.draggedBlockId !== block.id) wrapper.classList.add('drag-over');
        });
        wrapper.addEventListener('dragleave', function(e) { wrapper.classList.remove('drag-over'); });
        wrapper.addEventListener('drop', function(e) {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
            var draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== block.id) BlockEditor.reorderBlock(draggedId, block.id);
        });

        switch (block.type) {
            case 'h1': case 'h2': case 'h3':
                content = document.createElement(block.type);
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.className = 'block-content block-' + block.type;
                break;
            case 'task':
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
                if (block.checked) wrapper.classList.add('completed');
                content.appendChild(checkbox);
                content.appendChild(taskText);
                break;
            case 'code':
                content = document.createElement('div');
                content.classList.add('block-code');
                content.contentEditable = false;
                var inner = document.createElement('div');
                inner.className = 'code-inner';
                inner.contentEditable = true;
                
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
                var langLabel = document.createElement('span');
                langLabel.className = 'code-lang-label';
                langLabel.textContent = lang;
                content.appendChild(langLabel);
                content.appendChild(inner);
                break;
            case 'bullet': case 'numbered':
                content = document.createElement('div');
                content.classList.add('block-content', 'block-' + block.type);
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                break;
            case 'quote':
                content = document.createElement('div');
                content.classList.add('block-content', 'block-quote');
                content.contentEditable = 'true';
                content.innerHTML = this.markdownToHtml(block.content || '');
                break;
            case 'callout':
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
                
                // EDIT button — pure DOM with direct onclick
                var editBtn = document.createElement('span');
                editBtn.className = 'block-action-btn'; // V103: Added class for mousedown whitelist
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
                
                // DELETE button — pure DOM with direct onclick  
                var delBtn = document.createElement('span');
                delBtn.className = 'block-action-btn'; // V103: Added class for mousedown whitelist
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
                break;
            case 'image':
                content = document.createElement('div');
                content.classList.add('block-image');
                content.contentEditable = false;
                content.tabIndex = 0; // V88: Allow focus for keyboard delete
                
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
                imgDeleteBtn.className = 'image-delete-btn block-action-btn'; // V103: Whitelist for click
                imgDeleteBtn.textContent = 'X';
                imgDeleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                var caption = document.createElement('div');
                caption.className = 'image-caption';
                caption.contentEditable = 'true';
                caption.innerHTML = this.markdownToHtml(block.caption || '');
                content.appendChild(innerWrapper);
                content.appendChild(caption);
                content.appendChild(imgDeleteBtn);
                break;
            case 'kanban_ref':
                content = document.createElement('div');
                content.classList.add('kanban-hud-wrapper'); 
                content.classList.add('kanban-hud-wrapper'); 
                content.contentEditable = false;
                content.tabIndex = 0; // V88: Allow focus for keyboard delete
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
                createBtn.className = 'kanban-setup-btn block-action-btn'; // V103: Whitelist
                createBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid #444;color:#ccc;padding:4px 8px;cursor:pointer;';
                    
                    createBtn.onclick = function(e) {
                        e.stopPropagation();
                        var newTitle = prompt("Enter Board Name:", "Project Alpha");
                        if (newTitle && typeof KanbanManager !== 'undefined') {
                            var b = KanbanManager.createBoard(newTitle);
                            PageManager.updateBlock(self.activePageId, block.id, { boardId: b.id });
                            self.render(self.activePageId);
                        }
                    };
                    
                    var linkBtn = document.createElement('button');
                    linkBtn.textContent = 'LINK EXISTING';
                    linkBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid #444;color:#ccc;padding:4px 8px;cursor:pointer;';
                    
                    var delBtn = document.createElement('button');
                delBtn.textContent = '[x]';
                delBtn.title = 'Delete Block';
                delBtn.className = 'block-action-btn'; // V103: Whitelist
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
                break;
            case 'table':
                content = document.createElement('div');
                content.classList.add('block-table');
                content.classList.add('block-table');
                content.contentEditable = false;
                content.tabIndex = 0; // V88: Allow focus for keyboard delete
                
                // Initialize tableData if missing
                if (!block.tableData) {
                    block.tableData = {
                        headers: ['Header 1', 'Header 2', 'Header 3'],
                        rows: [['', '', ''], ['', '', '']],
                        columnAligns: ['left', 'left', 'left'],
                        hasHeaderRow: true
                    };
                }
                
                var tableData = block.tableData;
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
                        
                        th.appendChild(cell);
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
                addRowBtn.onclick = function() {
                    var newRow = tableData.headers.map(function() { return ''; });
                    tableData.rows.push(newRow);
                    PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
                    self.render(self.activePageId);
                };
                
                // Add Column button
                var addColBtn = document.createElement('button');
                addColBtn.className = 'table-add-col-btn';
                addColBtn.textContent = '+';
                addColBtn.onclick = function() {
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
                break;
            case 'query':
                content = document.createElement('div');
                content.classList.add('block-query');
                content.contentEditable = false;
                content.tabIndex = 0;
                
                var queryHeader = document.createElement('div');
                queryHeader.className = 'query-header';
                queryHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color, #444); margin-bottom: 15px;';
                
                var queryInput = document.createElement('input');
                queryInput.className = 'query-input';
                queryInput.type = 'text';
                queryInput.placeholder = 'LIST FROM #tag WHERE status = "Active"';
                queryInput.value = block.content || '';
                queryInput.style.cssText = 'flex: 1; background: transparent; border: none; color: var(--main-color, #ff00ff); font-family: monospace; font-size: 13px; outline: none; padding: 4px;';
                
                queryInput.addEventListener('input', function() {
                    PageManager.updateBlock(self.activePageId, block.id, { content: queryInput.value });
                });
                queryInput.addEventListener('keydown', function(e) { e.stopPropagation(); });
                
                var actsDiv = document.createElement('div');
                actsDiv.style.display = 'flex';
                actsDiv.style.gap = '8px';
                
                var queryRunBtn = document.createElement('button');
                queryRunBtn.className = 'panel-action query-run-btn';
                queryRunBtn.textContent = 'RUN';
                queryRunBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; cursor: pointer; border-radius: 4px; background: rgba(255,0,255,0.1); border: 1px solid var(--main-color, #ff00ff); color: var(--main-color, #ff00ff);';
                
                var queryDeleteBtn = document.createElement('button');
                queryDeleteBtn.className = 'panel-action query-delete-btn block-action-btn'; // Whitelist click
                queryDeleteBtn.textContent = 'X';
                queryDeleteBtn.style.cssText = 'padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #666; color: #666; background: transparent;';
                queryDeleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                
                actsDiv.appendChild(queryRunBtn);
                actsDiv.appendChild(queryDeleteBtn);
                
                queryHeader.appendChild(queryInput);
                queryHeader.appendChild(actsDiv);

                var queryResults = document.createElement('div');
                queryResults.className = 'query-results';
                queryResults.style.cssText = 'padding: 5px; font-size: 13px;';
                
                // Auto-run on load if not empty context
                if (queryInput.value && queryInput.value !== 'LIST FROM #') {
                    // Slight delay to ensure DOM and systems are fully booted
                    setTimeout(function() {
                         queryRunBtn.click();
                    }, 50);
                }
                
                queryRunBtn.onclick = function() {
                    if (!window.QueryEngine) {
                        queryResults.innerHTML = '<div class="query-empty">QueryEngine not loaded</div>';
                        return;
                    }
                    var result = window.QueryEngine.execute(queryInput.value);
                    if (result.error) {
                        queryResults.innerHTML = '<div style="color:#ff0055;padding:10px;">' + result.error + '</div>';
                    } else {
                        queryResults.innerHTML = window.QueryEngine.renderResults(result.results, result.parsed.type);
                    }
                };
                
                content.style.position = 'relative';
                content.style.cssText += ' border: 1px solid var(--border-color, #444); border-radius: 6px; padding: 15px; background: rgba(0,0,0,0.2);';
                content.appendChild(queryHeader);
                content.appendChild(queryResults);
                break;
            case 'divider':
                content = document.createElement('div');
                content.classList.add('block-divider-wrapper');
                content.classList.add('block-divider-wrapper');
                content.contentEditable = false;
                content.tabIndex = 0; // V88: Allow focus for keyboard delete
                var hr = document.createElement('hr');
                hr.className = 'block-divider';
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'divider-delete-btn';
                deleteBtn.textContent = 'X';
                deleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                content.appendChild(hr);
                content.appendChild(deleteBtn);
                break;
            default:
                content = document.createElement('div');
                content.contentEditable = 'true';
                // V109: Process markdown into visual HTML tags for WYSIWYG editor
                content.innerHTML = this.markdownToHtml(block.content || '');
                content.classList.add('block-content', 'block-p');
        }
        wrapper.appendChild(dragHandle);
        wrapper.appendChild(content);
        // V106: Clicking the drag handle opens the SlashMenu for intuitive block options
        dragHandle.addEventListener('click', function(e) {
            // Prevent event from bubbling and unfocusing
            e.stopPropagation();
            if (typeof SlashMenu !== 'undefined') {
                SlashMenu.show(wrapper, e);
            }
        });
        
        return wrapper;
    },

    handleKeydown: function (e) {
        // V88: Guard - Only run if editor is open
        if (!this.container || this.container.offsetParent === null) return;

        // Phase 3: Skip if SlashMenu is handling keyboard input
        if (window.SlashMenu && window.SlashMenu.visible) return;
        
        // 🛡️ FIX 1: The "External Input" Guard
        // Prevents the editor from deleting blocks when you Backspace in the Note Title
        var isExternalInput = (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) 
                              && !this.container.contains(e.target);
                              
        if (isExternalInput) {
            // Automatically clear block selection if you start typing elsewhere
            if (this.selectedBlockIds.length > 0) this.clearSelection();
            return; 
        }
        
        // V88: Scope Guard - If no selection, only handle if target is inside editor
        // If there IS a selection, we handle it globally (because drag-select blurs focus to body)
        if (this.selectedBlockIds.length === 0 && !this.container.contains(e.target)) return;

        if (e.key === 'Escape' && this.selectedBlockIds.length > 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clearSelection();
            return;
        }

        // V80: Ported Tab Shortcuts (Fix for missing functionality)
        // CMD+Shift+X: Close Tab
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
            return;
        }

        // CMD+1-9: Switch Tabs
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
            var tabIndex = parseInt(e.key, 10) - 1;
            if (typeof TabManager !== 'undefined' && tabIndex < TabManager.tabs.length) {
                e.preventDefault();
                e.stopPropagation();
                TabManager.switchTo(tabIndex);
                return;
            }
        }
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
        // V65: Delete/Backspace with selection - delete all selected blocks
        var isEditingContent = e.target.closest('.block-content, .task-text, .code-inner, .image-caption');
        var hasTextSelection = window.getSelection().toString().length > 0;
        
        if ((e.key === 'Backspace' || e.key === 'Delete') && this.selectedBlockIds.length >= 1) {
            // Only intercept if we have multi-select OR if focus is outside editable content
            if (!isEditingContent || this.selectedBlockIds.length > 1) {
                e.preventDefault();
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                if (!page) return;
                
                // V88: Handle delete for single focused non-editable block
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
        
        // V65: CMD+C with selection - copy all selected blocks
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
        
        // V65: CMD+X with selection - cut all selected blocks
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

        // V70: DUPLICATE BLOCK (CMD+D)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
            e.preventDefault();
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                var blockId = blockWrapper.getAttribute('data-block-id');
                HistoryManager.push(this.activePageId);
                var page = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
                var idx = page.blocks.findIndex(b => b.id === blockId);
                var newBlock = JSON.parse(JSON.stringify(page.blocks[idx]));
                // Regenerate IDs
                newBlock.id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                page.blocks.splice(idx + 1, 0, newBlock);
                this.render(this.activePageId);
                this.focusBlock(newBlock.id);
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

            // V76: CMD+Arrow = Quick Navigation (Jump to Start/End)
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

    // V88: Flash a block briefly (visual feedback for reorder / type change)
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

    // V88: Markdown Input Rules — auto-convert paragraph blocks on trigger patterns
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
        
        // V109: Bi-directional WYSIWYG Support
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
        }, 500);
    },
    
    handleClick: function (e) {
        if (this.selectedBlockIds && this.selectedBlockIds.length > 0) return;
        var blockEl = e.target.closest('.block-wrapper');
        if (blockEl) {
            var id = blockEl.getAttribute('data-block-id');
            this.focusedBlockId = id;
            var type = blockEl.getAttribute('data-block-type');
            // V88/V105: Explicitly focus non-editable blocks to enable keyboard delete, 
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
                    
                    // V77: If last block is non-text (image, table, divider, kanban), append new paragraph
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
              
              // V78: If target is not a wrapper (e.g. container) but we have a single selected code block, use that
              if (!blockEl && this.selectedBlockIds.length === 1) {
                   var selectedId = this.selectedBlockIds[0];
                   var selectedEl = this.container.querySelector('.block-wrapper[data-block-id="' + selectedId + '"]');
                   if (selectedEl && selectedEl.getAttribute('data-block-type') === 'code') {
                       blockEl = selectedEl;
                   }
              }
              
              // V78: Also check if target is explicitly within code-inner or block-code (handles helper elements)
              if (!blockEl) {
                  var innerCode = e.target.closest('.code-inner, .block-code');
                  if (innerCode) blockEl = innerCode.closest('.block-wrapper');
              }

              // Double check if we are in a code block
              if (blockEl && blockEl.getAttribute('data-block-type') === 'code') {
                  e.preventDefault();
                  // V78: Force Plain Text via Range API (most robust)
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
    
    // V71: Image File Processing (Extracted)
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
