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

            // 2. Protect Strings (Single, Double, Backtick) - Handle escapes
            safeCode = safeCode.replace(/(["'`])(?:\\.|[^\\])*?\1/g, function(m) { 
                return storeToken(m, '#f1fa8c'); 
            });

            // 3. Protect Comments (Double slash)
            safeCode = safeCode.replace(/(\/\/.*)/g, function(m) { 
                return storeToken(m, '#6272a4'); 
            });

            // 4. Highlight Keywords (Safe now that strings/comments are hidden)
            // Added export, import, from, default, etc.
            var keywords = 'var|let|const|function|return|if|else|for|while|class|this|async|await|export|import|from|default|switch|case|break|continue';
            var kwRegex = new RegExp('\\b(' + keywords + ')\\b', 'g');
            safeCode = safeCode.replace(kwRegex, '<span style="color:#ff79c6;">$1</span>');

            // 5. Highlight Booleans/Null
            safeCode = safeCode.replace(/\b(true|false|null|undefined)\b/g, '<span style="color:#bd93f9;">$1</span>');

            // 6. Highlight Numbers
            safeCode = safeCode.replace(/\b(\d+)\b/g, '<span style="color:#8be9fd;">$1</span>');

            // 7. Restore Tokens
            tokens.forEach(function(token) {
                safeCode = safeCode.replace(token.key, token.value);
            });
        }
        return safeCode;
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

    // V13.0: High-Fidelity Styling Engine (Ported from vinland.js)
    applyFormatting: function(key) {
        var targetEl = document.activeElement;
        // Ensure we are inside an intricate block content
        var blockWrapper = targetEl ? targetEl.closest('.block-wrapper') : null;
        if (!blockWrapper) return;
        
        var contentEl = blockWrapper.querySelector('.block-content, .task-text, .image-caption, .quote-content');
        if (!contentEl || contentEl.getAttribute('contenteditable') !== 'true') return;
        
        // Use browser selection
        var sel = window.getSelection();
        if (!sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        
        // Define Markers
        var wrapper = '', endWrapper = '';
        var isPattern = false;
        var patternSuffix = null;

        switch (key) {
            case 'b': wrapper = '**'; endWrapper = '**'; break;
            case 'i': wrapper = '*'; endWrapper = '*'; break;
            case 'u': wrapper = '<u>'; endWrapper = '</u>'; break;
            case 'k':
                wrapper = '[';
                isPattern = true;
                patternSuffix = /\]\((.*?)\)/;
                break;
            case 'l':
                wrapper = '[[';
                isPattern = true;
                patternSuffix = /\]\]/;
                break;
            default: return;
        }

        // --- Helper: Find Robust Match (Verbatim Port from vinland.js) ---
        function findGreedyMatchDeep(fullText, s, e, w, ew, isPat, patSuffix) {
            var lineStart = fullText.lastIndexOf('\n', s - 1) + 1;
            var lineEnd = fullText.indexOf('\n', e);
            if (lineEnd === -1) lineEnd = fullText.length;
            var beforeText = fullText.substring(lineStart, s);
            var afterText = fullText.substring(e, lineEnd);
            var currentSelection = fullText.substring(s, e);

            function isValid(marker, text, idx) {
                if (!marker.includes('*')) return true;
                var count = 0, i = idx;
                var maxIter = 10;
                while (i < text.length && text[i] === '*' && maxIter-- > 0) { count++; i++; }
                var j = idx - 1;
                maxIter = 10;
                while (j >= 0 && text[j] === '*' && maxIter-- > 0) { count++; j--; }
                if (marker === '*') return count === 1 || count === 3;
                if (marker === '**') return count === 2 || count === 3;
                return true;
            }

            // 1. Outside Check with safety limits (V13.2)
            if (!w || !ew) return null;
            var wIdx = beforeText.lastIndexOf(w);
            var searchAttempts = 0;
            var MAX_SEARCH_ATTEMPTS = 50;

            while (wIdx !== -1 && searchAttempts++ < MAX_SEARCH_ATTEMPTS) {
                if (isValid(w, beforeText, wIdx)) break;
                if (w.includes('*')) {
                    var skipStart = wIdx;
                    while (wIdx > 0 && beforeText[wIdx - 1] === '*') wIdx--;
                    if (wIdx === skipStart) wIdx--; 
                } else {
                    wIdx--; 
                }
                wIdx = beforeText.lastIndexOf(w, wIdx);
            }

            if (searchAttempts >= MAX_SEARCH_ATTEMPTS) return null;

            if (wIdx !== -1) {
                if (isPat) {
                    var suffixMatch = afterText.match(patSuffix);
                    if (suffixMatch && suffixMatch.index !== -1) {
                        return { type: 'outside', start: lineStart + wIdx, end: e + suffixMatch.index, ewLen: suffixMatch[0].length };
                    }
                } else {
                    var ewIdx = afterText.indexOf(ew);
                    searchAttempts = 0;
                    while (ewIdx !== -1 && searchAttempts++ < MAX_SEARCH_ATTEMPTS) {
                        if (isValid(ew, afterText, ewIdx)) break;
                        if (ew.includes('*')) {
                            var skipStart = ewIdx;
                            while (ewIdx < afterText.length - 1 && afterText[ewIdx + 1] === '*') ewIdx++;
                            if (ewIdx === skipStart) ewIdx++;
                        } else {
                            ewIdx++;
                        }
                        ewIdx = afterText.indexOf(ew, ewIdx);
                    }
                    if (ewIdx !== -1) {
                        var mid = beforeText.substring(wIdx + w.length) + currentSelection + afterText.substring(0, ewIdx);
                        if (mid.indexOf(w) === -1 && mid.indexOf(ew) === -1) {
                            return { type: 'outside', start: lineStart + wIdx, end: e + ewIdx, ewLen: ew.length };
                        }
                    }
                }
            }

            // 2. Starts/Ends Check (Explicit selection)
            if (currentSelection.length >= w.length + (isPat ? 2 : ew.length) && currentSelection.startsWith(w)) {
                if (isPat) {
                    var inSuffixMatch = currentSelection.substring(w.length).match(patSuffix);
                    if (inSuffixMatch && currentSelection.endsWith(inSuffixMatch[0])) {
                        return { type: 'starts_ends', start: s, end: e - inSuffixMatch[0].length, ewLen: inSuffixMatch[0].length };
                    }
                } else if (currentSelection.endsWith(ew)) {
                    if (isValid(w, currentSelection, 0) && isValid(ew, currentSelection, currentSelection.length - ew.length)) {
                        return { type: 'starts_ends', start: s, end: e - ew.length, ewLen: ew.length };
                    }
                }
            }

            // 3. Deep Inside Check (Sloppy selection)
            var trimmedS = currentSelection.trim();
            var trimOffset = currentSelection.indexOf(trimmedS);
            if (trimmedS.startsWith(w)) {
                var innerWIdx = currentSelection.indexOf(w, trimOffset);
                if (innerWIdx !== -1 && isValid(w, currentSelection, innerWIdx)) {
                    if (isPat) {
                        var inSelectionSuffix = currentSelection.substring(innerWIdx + w.length).match(patSuffix);
                        if (inSelectionSuffix) {
                            return { type: 'deep_inside', start: s + innerWIdx, end: s + innerWIdx + w.length + inSelectionSuffix.index, ewLen: inSelectionSuffix[0].length };
                        }
                    } else {
                        var innerEWIdx = currentSelection.lastIndexOf(ew);
                        if (innerEWIdx !== -1 && innerEWIdx > innerWIdx && isValid(ew, currentSelection, innerEWIdx)) {
                            return { type: 'deep_inside', start: s + innerWIdx, end: s + innerEWIdx, ewLen: ew.length };
                        }
                    }
                }
            }
            return null;
        }

        // Get Text State - Use textContent for consistency logic
        var fullText = contentEl.textContent || ''; // Force fallback
        
        // Calculate offsets based on textContent DOM logic
        var beforeRange = document.createRange();
        beforeRange.selectNodeContents(contentEl);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        var start = beforeRange.toString().length;
        var end = start + range.toString().length;
        var selectedText = range.toString();

        // 1. Check for Link Logic (Special Case)
        if (key === 'k') {
             var match = findGreedyMatchDeep(fullText, start, end, '[', ')', true, /\]\((.*?)\)/);
             if (match) {
                 // Remove Link (Just Unwrap) -> Handled by greedy match below if generic enough, else simplistic fallback
             } else {
                 // Create Link
                 var url = prompt('Enter URL:', 'https://');
                 if (url) {
                    endWrapper = '](' + url + ')';
                    var newFullText = fullText.substring(0, start) + wrapper + selectedText + endWrapper + fullText.substring(end);
                    contentEl.textContent = newFullText;
                    
                    var blockId = blockWrapper.getAttribute('data-block-id');
                    PageManager.updateBlock(this.activePageId, blockId, { content: newFullText });
                    
                    // Restore Selection: select label part
                    this.setSelectionOffsets(contentEl, start + 1, start + 1 + selectedText.length);
                 }
                 return;
             }
        }

        // 2. Greedy Search for Formatting Removal
        var match = findGreedyMatchDeep(fullText, start, end, wrapper, endWrapper, isPattern, patternSuffix);
        
        if (match) {
            // REMOVE FORMATTING (Toggle Off)
            var toggleTargetText = fullText.substring(match.start, match.end + match.ewLen);
            var inner = toggleTargetText.substring(wrapper.length, toggleTargetText.length - match.ewLen);
            
            // Clean up using slicing if verified
            if (toggleTargetText.startsWith(wrapper) && toggleTargetText.endsWith(endWrapper)) {
                 inner = toggleTargetText.slice(wrapper.length, toggleTargetText.length - match.ewLen); // Use match length
            }

            var newFullText = fullText.substring(0, match.start) + inner + fullText.substring(match.end + match.ewLen);
            contentEl.textContent = newFullText;
            
            var blockId = blockWrapper.getAttribute('data-block-id');
            PageManager.updateBlock(this.activePageId, blockId, { content: newFullText });
            
            // Restore Selection
            var newStart = match.start;
            var newEnd = match.start + inner.length;
            this.setSelectionOffsets(contentEl, newStart, newEnd);

        } else {
            // APPLY FORMATTING
            var newFullText, newStart, newEnd;

            if (!selectedText) {
                 // No selection -> Insert markers and cursor inside
                 newFullText = fullText.substring(0, start) + wrapper + endWrapper + fullText.substring(end);
                 newStart = start + wrapper.length;
                 newEnd = start + wrapper.length; // Cursor between markers
            } else {
                 // Selection -> Wrap text
                 newFullText = fullText.substring(0, start) + wrapper + selectedText + endWrapper + fullText.substring(end);
                 newStart = start + wrapper.length;
                 newEnd = start + wrapper.length + selectedText.length; // Keep text selected
            }
            
            contentEl.textContent = newFullText;
            this.setSelectionOffsets(contentEl, newStart, newEnd);
            
            // Sync
            var blockId = blockWrapper.getAttribute('data-block-id');
            PageManager.updateBlock(this.activePageId, blockId, { content: newFullText });
        }
    },

    init: function (containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.container.addEventListener('keydown', this.handleKeydown.bind(this));
        this.container.addEventListener('input', this.handleInput.bind(this));
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.container.addEventListener('paste', this.handlePaste.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
        
        this.container.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        var self = this;
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
            if (blockEl && !e.target.closest('.block-content, .task-text, .code-inner, .image-caption, input')) {
                var blockId = blockEl.getAttribute('data-block-id');
                if (self.selectedBlockIds.length > 1 && self.selectedBlockIds.includes(blockId)) return;
                self.selectBlock(blockId, false);
                self.lastSelectedId = blockId;
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
        var draggedBlock = note.blocks.splice(draggedIdx, 1)[0];
        var newTargetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        note.blocks.splice(newTargetIdx, 0, draggedBlock);
        saveData();
        this.render(this.activePageId, true);
    },

    reorderSelectedBlocks: function(targetId) {
        var note = State.NOTES.find(function(n) { return n.id === BlockEditor.activePageId; });
        if (!note || !note.blocks) return;
        var targetIdx = note.blocks.findIndex(function(b) { return b.id === targetId; });
        if (targetIdx === -1) return;
        var selectedBlocks = [];
        var remainingBlocks = [];
        note.blocks.forEach(function(block) {
            if (BlockEditor.selectedBlockIds.includes(block.id)) selectedBlocks.push(block);
            else remainingBlocks.push(block);
        });
        var newTargetIdx = remainingBlocks.findIndex(function(b) { return b.id === targetId; });
        if (newTargetIdx === -1) newTargetIdx = remainingBlocks.length;
        remainingBlocks.splice.apply(remainingBlocks, [newTargetIdx, 0].concat(selectedBlocks));
        note.blocks = remainingBlocks;
        saveData();
        this.render(this.activePageId, true);
        this.updateSelectionVisuals();
    },

    renderBlock: function (block) {
        var wrapper = document.createElement('div');
        wrapper.className = 'block-wrapper';
        wrapper.setAttribute('data-block-id', block.id);
        wrapper.setAttribute('data-block-type', block.type);
        if (block._tempIndex) wrapper.setAttribute('data-number', block._tempIndex);
        wrapper.setAttribute('draggable', 'true');

        var dragHandle = document.createElement('span');
        dragHandle.className = 'block-drag-handle';
        dragHandle.setAttribute('title', 'Drag to reorder');
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
                content.textContent = block.content || '';
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
                taskText.textContent = block.content || '';
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
                content.textContent = block.content || '';
                break;
            case 'quote':
                content = document.createElement('div');
                content.classList.add('block-content', 'block-quote');
                content.contentEditable = 'true';
                content.textContent = block.content || '';
                break;
            case 'image':
                content = document.createElement('div');
                content.classList.add('block-image');
                content.contentEditable = false;
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
                imgDeleteBtn.className = 'image-delete-btn';
                imgDeleteBtn.textContent = 'X';
                imgDeleteBtn.onclick = function() {
                    PageManager.deleteBlock(self.activePageId, block.id);
                    self.render(self.activePageId);
                };
                var caption = document.createElement('div');
                caption.className = 'image-caption';
                caption.contentEditable = 'true';
                caption.textContent = block.caption || '';
                content.appendChild(innerWrapper);
                content.appendChild(caption);
                content.appendChild(imgDeleteBtn);
                caption.addEventListener('input', function() {
                   var cleanText = this.textContent.replace(/[\r\n]+/g, ' ').trim();
                   PageManager.updateBlock(BlockEditor.activePageId, block.id, { caption: cleanText });
                });
                break;
            case 'kanban_ref':
                content = document.createElement('div');
                content.classList.add('kanban-hud-wrapper'); 
                content.contentEditable = false;
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
                    createBtn.className = 'kanban-setup-btn';
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
                content.contentEditable = false;
                
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
                    '<button class="table-toolbar-btn" data-action="align-left" title="Align Left">[=</button>' +
                    '<button class="table-toolbar-btn" data-action="align-center" title="Align Center">=</button>' +
                    '<button class="table-toolbar-btn" data-action="align-right" title="Align Right">=]</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="insert-row-above" title="Insert Row Above">+ Row Up</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-row-below" title="Insert Row Below">+ Row Dn</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-col-left" title="Insert Column Left">+ Col L</button>' +
                    '<button class="table-toolbar-btn" data-action="insert-col-right" title="Insert Column Right">+ Col R</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="delete-row" title="Delete Row">- Row</button>' +
                    '<button class="table-toolbar-btn" data-action="delete-col" title="Delete Column">- Col</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="sort-asc" title="Sort A-Z">A-Z</button>' +
                    '<button class="table-toolbar-btn" data-action="sort-desc" title="Sort Z-A">Z-A</button>' +
                    '<div class="table-toolbar-divider"></div>' +
                    '<button class="table-toolbar-btn" data-action="delete-table" title="Delete Table" style="color:#f44;">X</button>';
                
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
                        cell.textContent = headerText;
                        cell.setAttribute('data-row', '-1');
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = -1;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            tableData.headers[colIdx] = this.textContent;
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
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
                        cell.textContent = cellText;
                        cell.setAttribute('data-row', rowIdx);
                        cell.setAttribute('data-col', colIdx);
                        
                        cell.addEventListener('focus', function() {
                            focusedCell.row = rowIdx;
                            focusedCell.col = colIdx;
                            toolbar.classList.add('visible');
                        });
                        
                        cell.addEventListener('blur', function() {
                            tableData.rows[rowIdx][colIdx] = this.textContent;
                            PageManager.updateBlock(self.activePageId, block.id, { tableData: tableData });
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
            case 'divider':
                content = document.createElement('div');
                content.classList.add('block-divider-wrapper');
                content.contentEditable = false;
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
                content.textContent = block.content || '';
                content.classList.add('block-content', 'block-p');
        }
        wrapper.appendChild(dragHandle);
        wrapper.appendChild(content);
        return wrapper;
    },

    handleKeydown: function (e) {
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
            var blockWrapper = e.target.closest('.block-wrapper');
            if (blockWrapper) {
                var blockId = blockWrapper.getAttribute('data-block-id');
                HistoryManager.push(this.activePageId);
                var page = State.NOTES.find(n => n.id === BlockEditor.activePageId);
                var idx = page.blocks.findIndex(b => b.id === blockId);
                if (idx === -1) return;
                if (e.key === 'ArrowUp' && idx > 0) {
                    var temp = page.blocks[idx - 1];
                    page.blocks[idx - 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    this.render(this.activePageId);
                    this.focusBlock(blockId);
                    saveData(); // V80: Persist logic
                } else if (e.key === 'ArrowDown' && idx < page.blocks.length - 1) {
                    var temp = page.blocks[idx + 1];
                    page.blocks[idx + 1] = page.blocks[idx];
                    page.blocks[idx] = temp;
                    this.render(this.activePageId);
                    this.focusBlock(blockId);
                    saveData(); // V80: Persist logic
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

    handleInput: function (e) {
        var blockEl = e.target.closest('.block-wrapper');
        if (!blockEl) return;
        var blockId = blockEl.getAttribute('data-block-id');
        var blockType = blockEl.getAttribute('data-block-type');
        if (blockType === 'image' || blockType === 'table') return;
        
        // V77: Use innerText to preserve newlines for Code Blocks etc.
        var newContent = e.target.innerText || '';
        PageManager.updateBlock(this.activePageId, blockId, { content: newContent });
        
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
        }, 500);
    },
    
    handleClick: function (e) {
        if (this.selectedBlockIds && this.selectedBlockIds.length > 0) return;
        var blockEl = e.target.closest('.block-wrapper');
        if (blockEl) {
            this.focusedBlockId = blockEl.getAttribute('data-block-id');
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
