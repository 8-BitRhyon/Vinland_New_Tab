

export const CodeBlockTools = {
    
    enhanceBlock: function(blockEl, block) {
        if (!blockEl) return;
        var wrapper = blockEl.querySelector('.block-code');
        if (!wrapper) return;

        // Only enhance once
        if (wrapper.querySelector('.code-line-numbers')) return;

        var inner = wrapper.querySelector('.code-inner');
        if (!inner) return;

        // Don't enhance empty blocks with no content
        var rawText = inner.textContent || '';
        if (!rawText.trim()) return;

        // 1. Line numbers gutter
        var gutter = document.createElement('div');
        gutter.className = 'code-line-numbers';
        wrapper.insertBefore(gutter, inner);
        this._updateLineNumbers(inner, gutter);

        // 2. Copy button
        var copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.textContent = 'COPY';
        copyBtn.title = 'Copy code to clipboard';
        wrapper.appendChild(copyBtn);

        var self = this;
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            self._copyCode(inner, copyBtn);
        });

        // 3. Update line numbers on input
        var inputHandler = function() {
            self._updateLineNumbers(inner, gutter);
        };
        inner.addEventListener('input', inputHandler);
        inner.addEventListener('focus', function() {
            // Make sure gutter is visible (highlighted state)
            gutter.classList.add('focused');
        });
        inner.addEventListener('blur', function() {
            gutter.classList.remove('focused');
        });

        // 4. Update language label if one exists
        var langLabel = wrapper.querySelector('.code-lang-label');
        if (langLabel) {
            langLabel.addEventListener('click', function() {
                self._cycleLanguage(blockEl, block);
            });
            langLabel.title = 'Click to change language';
            langLabel.style.cursor = 'pointer';
        }
    },

    
    _updateLineNumbers: function(inner, gutter) {
        var text = inner.textContent || '';
        var lines = text.split('\n');
        var count = lines.length;

        // Ensure at least 1 line number
        if (count < 1) count = 1;

        var numbers = [];
        for (var i = 1; i <= count; i++) {
            numbers.push('<span>' + i + '</span>');
        }
        gutter.innerHTML = numbers.join('');

        // Sync gutter height with inner content
        gutter.style.minHeight = inner.scrollHeight + 'px';
    },

    
    _copyCode: function(inner, btn) {
        var text = inner.textContent || '';
        if (!text.trim()) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                btn.textContent = 'COPIED!';
                btn.style.color = 'var(--main-color, #00ff41)';
                setTimeout(function() {
                    btn.textContent = 'COPY';
                    btn.style.color = '';
                }, 1500);
            }).catch(function() {
                // Fallback
                fallbackCopy(text, btn);
            });
        } else {
            fallbackCopy(text, btn);
        }

        function fallbackCopy(text, btn) {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                btn.textContent = 'COPIED!';
                btn.style.color = 'var(--main-color, #00ff41)';
                setTimeout(function() {
                    btn.textContent = 'COPY';
                    btn.style.color = '';
                }, 1500);
            } catch (err) {
                btn.textContent = 'FAILED';
                setTimeout(function() {
                    btn.textContent = 'COPY';
                }, 1500);
            }
            document.body.removeChild(textarea);
        }
    },

    
    _cycleLanguage: function(blockEl, block) {
        var languages = ['javascript', 'python', 'html', 'css', 'json', 'bash', 'plain'];
        var current = block.language || 'javascript';
        var idx = languages.indexOf(current);
        var next = languages[(idx + 1) % languages.length];

        // Update the block data
        block.language = next;
        if (window.PageManager) {
            window.PageManager.updateBlock(blockEl.closest('[data-page-id]')
                ? window.BlockEditor.activePageId : window.BlockEditor.activePageId,
                block.id, { language: next });
        }

        // Update the DOM
        var wrapper = blockEl.querySelector('.block-code');
        if (wrapper) {
            var label = wrapper.querySelector('.code-lang-label');
            if (label) label.textContent = next;

            // Re-highlight the content
            var inner = wrapper.querySelector('.code-inner');
            if (inner) {
                var rawCode = block.content || inner.textContent || '';
                inner.textContent = rawCode;
                inner.innerHTML = this._extendedHighlight(rawCode, next);
                inner.setAttribute('data-highlighted', 'true');
            }
        }
    },

    
    handleKeydown: function(e) {
        if (e.key !== 'Tab') return false;
        var target = e.target;
        if (!target || !target.classList.contains('code-inner')) return false;

        e.preventDefault();
        e.stopPropagation();

        var sel = window.getSelection();
        if (!sel.rangeCount) {
            this._insertAtCursor(target, '    ');
            return true;
        }

        var range = sel.getRangeAt(0);
        var isReverse = false;
        var startNode, startOffset, endNode, endOffset;

        if (e.shiftKey) {
            // Shift+Tab: unindent
            this._unindentSelection(target, range);
        } else {
            // Tab: indent (insert 4 spaces or indent selected lines)
            var hasSelection = !range.collapsed;
            if (hasSelection) {
                this._indentSelection(target, range);
            } else {
                this._insertAtCursor(target, '    ');
            }
        }

        return true;
    },

    
    _insertAtCursor: function(el, text) {
        var sel = window.getSelection();
        if (!sel.rangeCount) return;

        var range = sel.getRangeAt(0);
        range.deleteContents();

        var textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor after the inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    
    _indentSelection: function(el, range) {
        var text = el.textContent || '';
        var startOffset = this._getTextOffset(el, range.startContainer, range.startOffset);
        var endOffset = this._getTextOffset(el, range.endContainer, range.endOffset);

        // Find line boundaries
        var startLine = text.lastIndexOf('\n', startOffset - 1) + 1;
        if (startOffset === 0) startLine = 0;
        else if (text[startOffset - 1] === '\n') startLine = startOffset;
        else startLine = text.lastIndexOf('\n', startOffset) + 1;

        var endLine = text.indexOf('\n', endOffset);
        if (endLine === -1) endLine = text.length;

        // Insert 4 spaces at the start of each line in the selection
        var lines = text.substring(startLine, endLine).split('\n');
        var indented = lines.map(function(l) { return '    ' + l; }).join('\n');

        var newText = text.substring(0, startLine) + indented + text.substring(endLine);
        el.textContent = newText;

        // Re-apply highlighting after modifying text
        if (el.getAttribute('data-highlighted') !== 'true') {
            var lang = el.closest('.block-code') ? (el.closest('.block-code').querySelector('.code-lang-label') || {}).textContent || 'javascript' : 'javascript';
            el.innerHTML = this._extendedHighlight(newText, lang);
            el.setAttribute('data-highlighted', 'true');
        }

        // Restore cursor to end of selection
        var newOffset = startLine + indented.length;
        this._setCursorOffset(el, newOffset);

        // Trigger input event for save
        var event = new Event('input', { bubbles: true });
        el.dispatchEvent(event);
    },

    
    _unindentSelection: function(el, range) {
        var text = el.textContent || '';
        var startOffset = this._getTextOffset(el, range.startContainer, range.startOffset);
        var endOffset = this._getTextOffset(el, range.endContainer, range.endOffset);

        // Find line boundaries
        var startLine = text.lastIndexOf('\n', startOffset - 1) + 1;
        if (startOffset === 0) startLine = 0;
        else if (text[startOffset - 1] === '\n') startLine = startOffset;
        else startLine = text.lastIndexOf('\n', startOffset) + 1;

        var endLine = text.indexOf('\n', endOffset);
        if (endLine === -1) endLine = text.length;

        // Remove up to 4 leading spaces from each line
        var lines = text.substring(startLine, endLine).split('\n');
        var unindented = lines.map(function(l) {
            var spaces = 0;
            while (spaces < 4 && spaces < l.length && l[spaces] === ' ') spaces++;
            return l.substring(spaces);
        }).join('\n');

        var newText = text.substring(0, startLine) + unindented + text.substring(endLine);
        el.textContent = newText;

        // Re-apply highlighting after modifying text
        if (el.getAttribute('data-highlighted') !== 'true') {
            var lang = el.closest('.block-code') ? (el.closest('.block-code').querySelector('.code-lang-label') || {}).textContent || 'javascript' : 'javascript';
            el.innerHTML = this._extendedHighlight(newText, lang);
            el.setAttribute('data-highlighted', 'true');
        }

        // Restore cursor to end of selection
        var newOffset = startLine + unindented.length;
        this._setCursorOffset(el, newOffset);

        // Trigger input event for save
        var event = new Event('input', { bubbles: true });
        el.dispatchEvent(event);
    },

    
    _getTextOffset: function(root, node, offset) {
        var total = 0;
        var found = false;

        function walk(n) {
            if (found) return;
            if (n === node) {
                total += offset;
                found = true;
                return;
            }
            if (n.nodeType === 3) {
                total += n.textContent.length;
            } else if (n.nodeType === 1 && n.childNodes) {
                for (var i = 0; i < n.childNodes.length; i++) {
                    walk(n.childNodes[i]);
                    if (found) return;
                }
            }
        }

        walk(root);
        return total;
    },

    
    _setCursorOffset: function(el, offset) {
        el.focus();
        var sel = window.getSelection();
        var range = document.createRange();
        var charCount = 0;
        var targetNode = null;
        var targetOffset = 0;

        function walk(n) {
            if (targetNode) return;
            if (n.nodeType === 3) {
                var nextCount = charCount + n.textContent.length;
                if (offset >= charCount && offset <= nextCount) {
                    targetNode = n;
                    targetOffset = offset - charCount;
                    return;
                }
                charCount = nextCount;
            } else if (n.nodeType === 1 && n.childNodes) {
                for (var i = 0; i < n.childNodes.length; i++) {
                    walk(n.childNodes[i]);
                    if (targetNode) return;
                }
            }
        }

        walk(el);

        if (targetNode) {
            range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent.length));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    },

    
    _extendedHighlight: function(code, lang) {
        if (!code) return '';
        var safeCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        if (lang === 'python') {
            return this._highlightPython(safeCode);
        } else if (lang === 'html') {
            return this._highlightHTML(safeCode);
        } else if (lang === 'css') {
            return this._highlightCSS(safeCode);
        } else if (lang === 'bash') {
            return this._highlightBash(safeCode);
        } else if (['javascript', 'js', 'json', 'calc'].includes(lang)) {
            return this._highlightJS(safeCode);
        }

        return safeCode;
    },

    
    _highlightJS: function(code) {
        var tokens = [];
        var storeToken = function(match, color) {
            var key = '___CT_' + tokens.length + '___';
            tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match + '</span>' });
            return key;
        };

        // Strings
        code = code.replace(/(["'`])(?:\\.|[^\\])*?\1/g, function(m) {
            return storeToken(m, 'var(--syntax-string, #ce9178)');
        });

        // Comments
        code = code.replace(/(\/\/.*)/g, function(m) {
            return storeToken(m, 'var(--syntax-comment, #6a9955)');
        });

        // Numbers
        code = code.replace(/\b(\d+\.?\d*)\b/g, function(m) {
            return storeToken(m, 'var(--syntax-number, #b5cea8)');
        });

        // Keywords
        var keywords = 'var|let|const|function|return|if|else|for|while|class|this|async|await|export|import|from|default|switch|case|break|continue|new|try|catch|throw|typeof|instanceof|in|of|yield|static|get|set';
        code = code.replace(new RegExp('\\b(' + keywords + ')\\b', 'g'), function(m) {
            return storeToken(m, 'var(--syntax-keyword, #569cd6)');
        });

        // Booleans/null/undefined
        code = code.replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, function(m) {
            return storeToken(m, 'var(--syntax-boolean, #569cd6)');
        });

        // Restore tokens
        tokens.forEach(function(token) {
            code = code.replace(token.key, token.value);
        });

        return code;
    },

    
    _highlightPython: function(code) {
        var tokens = [];
        var storeToken = function(match, color) {
            var key = '___CT_' + tokens.length + '___';
            tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match + '</span>' });
            return key;
        };

        // Strings
        code = code.replace(/(["'])(?:\\.|[^\\])*?\1/g, function(m) {
            return storeToken(m, 'var(--syntax-string, #ce9178)');
        });

        // Comments
        code = code.replace(/(#.*)/g, function(m) {
            return storeToken(m, 'var(--syntax-comment, #6a9955)');
        });

        // Decorators
        code = code.replace(/^(\s*@\w+)/gm, function(m) {
            return storeToken(m, 'var(--syntax-boolean, #dcdcaa)');
        });

        // Numbers
        code = code.replace(/\b(\d+\.?\d*)\b/g, function(m) {
            return storeToken(m, 'var(--syntax-number, #b5cea8)');
        });

        // Keywords
        var keywords = 'def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|yield|lambda|pass|break|continue|raise|self|True|False|None|and|or|not|in|is|async|await|print|range|len|int|str|float|list|dict|set|tuple|type|super|global|nonlocal|assert|del';
        code = code.replace(new RegExp('\\b(' + keywords + ')\\b', 'g'), function(m) {
            return storeToken(m, 'var(--syntax-keyword, #569cd6)');
        });

        // Function calls
        code = code.replace(/\b([a-zA-Z_]\w*)\s*\(/g, function(m, fn) {
            if (['if', 'while', 'for', 'with', 'def', 'class'].includes(fn)) return m;
            return storeToken(fn, 'var(--syntax-function, #dcdcaa)') + '(';
        });

        tokens.forEach(function(token) {
            code = code.replace(token.key, token.value);
        });

        return code;
    },

    
    _highlightHTML: function(code) {
        var tokens = [];
        var storeToken = function(match, color) {
            var key = '___CT_' + tokens.length + '___';
            tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' });
            return key;
        };

        // Tags
        code = code.replace(/(&lt;\/?)([\w-]+)/g, function(m, bracket, tag) {
            return bracket + storeToken(tag, 'var(--syntax-keyword, #569cd6)');
        });

        // Attributes
        code = code.replace(/\b([\w-]+)(=)/g, function(m, attr, eq) {
            return storeToken(attr, 'var(--syntax-function, #9cdcfe)') + eq;
        });

        // Attribute values (strings)
        code = code.replace(/(["'])(?:\\.|[^\\])*?\1/g, function(m) {
            return storeToken(m, 'var(--syntax-string, #ce9178)');
        });

        // Comments
        code = code.replace(/(&lt;!--[\s\S]*?--&gt;)/g, function(m) {
            return storeToken(m, 'var(--syntax-comment, #6a9955)');
        });

        tokens.forEach(function(token) {
            code = code.replace(token.key, token.value);
        });

        return code;
    },

    
    _highlightCSS: function(code) {
        var tokens = [];
        var storeToken = function(match, color) {
            var key = '___CT_' + tokens.length + '___';
            tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match + '</span>' });
            return key;
        };

        // Comments
        code = code.replace(/(\/\*[\s\S]*?\*\/)/g, function(m) {
            return storeToken(m, 'var(--syntax-comment, #6a9955)');
        });

        // Properties
        code = code.replace(/([\w-]+)\s*:/g, function(m, prop) {
            return storeToken(prop, 'var(--syntax-function, #9cdcfe)') + ':';
        });

        // Values (colors, numbers)
        code = code.replace(/(#[0-9a-fA-F]{3,8})\b/g, function(m) {
            return storeToken(m, 'var(--syntax-number, #b5cea8)');
        });
        code = code.replace(/\b(\d+\.?\d*)(px|em|rem|%|vh|vw|s|ms)?\b/g, function(m) {
            return storeToken(m, 'var(--syntax-number, #b5cea8)');
        });

        // Strings
        code = code.replace(/(["'])(?:\\.|[^\\])*?\1/g, function(m) {
            return storeToken(m, 'var(--syntax-string, #ce9178)');
        });

        // Selectors
        code = code.replace(/(\.|#)[\w-]+/g, function(m) {
            return storeToken(m, 'var(--syntax-function, #d7ba7d)');
        });

        // At-rules
        code = code.replace(/@[\w-]+/g, function(m) {
            return storeToken(m, 'var(--syntax-keyword, #569cd6)');
        });

        // Units & keywords
        var cssKeywords = 'auto|inherit|initial|none|solid|dashed|dotted|bold|italic|underline|center|left|right|top|bottom|middle|repeat|no-repeat|cover|contain|hidden|visible|scroll|absolute|relative|fixed|flex|block|inline|inline-block|grid';
        code = code.replace(new RegExp('\\b(' + cssKeywords + ')\\b', 'g'), function(m) {
            return storeToken(m, 'var(--syntax-boolean, #569cd6)');
        });

        tokens.forEach(function(token) {
            code = code.replace(token.key, token.value);
        });

        return code;
    },

    
    _highlightBash: function(code) {
        var tokens = [];
        var storeToken = function(match, color) {
            var key = '___CT_' + tokens.length + '___';
            tokens.push({ key: key, value: '<span style="color:' + color + ';">' + match + '</span>' });
            return key;
        };

        // Comments
        code = code.replace(/(#.*)/g, function(m) {
            return storeToken(m, 'var(--syntax-comment, #6a9955)');
        });

        // Strings
        code = code.replace(/(["'`])(?:\\.|[^\\])*?\1/g, function(m) {
            return storeToken(m, 'var(--syntax-string, #ce9178)');
        });

        // Commands
        code = code.replace(/^\s*([\w\/.-]+)/gm, function(m, cmd) {
            return m.replace(cmd, storeToken(cmd, 'var(--syntax-function, #dcdcaa)'));
        });

        // Flags
        code = code.replace(/(--?[\w-]+)/g, function(m) {
            return storeToken(m, 'var(--syntax-number, #b5cea8)');
        });

        // Variables
        code = code.replace(/\$[\w{}]+/g, function(m) {
            return storeToken(m, 'var(--syntax-keyword, #569cd6)');
        });

        tokens.forEach(function(token) {
            code = code.replace(token.key, token.value);
        });

        return code;
    }
};
