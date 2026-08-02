

export const FormatToolbar = {
    element: null,
    visible: false,
    _hideTimer: null,

    // ── Button definitions ─────────────────────────────────────
    _buttons: [
        { key: 'b', label: 'B', title: 'Bold (Ctrl+B)',   className: 'fmt-btn fmt-bold' },
        { key: 'i', label: 'I', title: 'Italic (Ctrl+I)', className: 'fmt-btn fmt-italic' },
        { key: 'u', label: 'U', title: 'Underline (Ctrl+U)', className: 'fmt-btn fmt-underline' },
        { key: 'k', label: '🔗', title: 'Link (Ctrl+K)',   className: 'fmt-btn fmt-link' },
    ],

    // ── Lifecycle ──────────────────────────────────────────────
    init: function () {
        if (this.element) return;

        this.element = document.createElement('div');
        this.element.id = 'format-toolbar';
        this.element.className = 'format-toolbar';

        var self = this;
        this._buttons.forEach(function (btn) {
            var el = document.createElement('button');
            el.className = btn.className;
            el.textContent = btn.label;
            el.title = btn.title;
            el.setAttribute('data-fmt-key', btn.key);

            // Prevent mousedown from blurring the contenteditable
            el.addEventListener('mousedown', function (e) { e.preventDefault(); });
            el.addEventListener('click', function (e) {
                e.preventDefault();
                self._apply(btn.key);
            });

            self.element.appendChild(el);
        });

        // Divider + more button for wiki-link
        var divider = document.createElement('span');
        divider.className = 'fmt-divider';
        this.element.appendChild(divider);

        var wikiBtn = document.createElement('button');
        wikiBtn.className = 'fmt-btn fmt-wiki';
        wikiBtn.textContent = '[[]]';
        wikiBtn.title = 'Wiki Link (Ctrl+L)';
        wikiBtn.setAttribute('data-fmt-key', 'l');
        wikiBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        wikiBtn.addEventListener('click', function (e) {
            e.preventDefault();
            self._apply('l');
        });
        this.element.appendChild(wikiBtn);

        document.body.appendChild(this.element);

        // ── Event listeners ──
        this._onSelectionChange = this._onSelectionChange.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);

        document.addEventListener('selectionchange', this._onSelectionChange);
        document.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('keydown', this._onKeyDown);

        // Hide on scroll/resize while visible
        var self = this;
        this._onScroll = function () { if (self.visible) self.hide(); };
        this._onResize = function () { if (self.visible) self.hide(); };
        window.addEventListener('scroll', this._onScroll, true);
        window.addEventListener('resize', this._onResize);
    },

    destroy: function () {
        if (!this.element) return;
        document.removeEventListener('selectionchange', this._onSelectionChange);
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('scroll', this._onScroll, true);
        window.removeEventListener('resize', this._onResize);
        if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
        this.element = null;
    },

    // ── Selection handler ───────────────────────────────────────
    _onSelectionChange: function () {
        if (this._hideTimer) clearTimeout(this._hideTimer);

        var sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed || !this._isEditorActive()) {
            // Defer hide so that click events on the toolbar still register
            this._hideTimer = setTimeout(this.hide.bind(this), 180);
            return;
        }

        var range = sel.getRangeAt(0);
        var editorEl = document.getElementById('block-editor');
        if (!editorEl || !editorEl.contains(range.commonAncestorContainer)) {
            this.hide();
            return;
        }

        // Only show for meaningful selections (not empty or whitespace)
        var text = range.toString().trim();
        if (!text) {
            this.hide();
            return;
        }

        this.show(range);
    },

    // ── Outside click ──────────────────────────────────────────
    _onMouseDown: function (e) {
        if (this.visible && this.element && !this.element.contains(e.target)) {
            this.hide();
        }
    },

    // ── Escape to hide ─────────────────────────────────────────
    _onKeyDown: function (e) {
        if (e.key === 'Escape' && this.visible) {
            this.hide();
        }
    },

    // ── Editor active check ────────────────────────────────────
    _isEditorActive: function () {
        return window.ModalManager &&
               Array.isArray(window.ModalManager.stack) &&
               window.ModalManager.stack.indexOf('note-editor-modal') !== -1;
    },

    // ── Show / Position ────────────────────────────────────────
    show: function (range) {
        var rect = range.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return;

        this.element.style.display = 'flex';
        this.visible = true;

        var toolbarW = this.element.offsetWidth || 160;
        var toolbarH = this.element.offsetHeight || 36;

        // Default: centered above the selection
        var top = rect.top - toolbarH - 10;
        var left = rect.left + (rect.width / 2) - (toolbarW / 2);
        var isBelow = false;

        // If not enough room above, show below
        if (top < 8) {
            top = rect.bottom + 10;
            isBelow = true;
        }

        // Clamp horizontally
        if (left < 12) left = 12;
        if (left + toolbarW > window.innerWidth - 12) {
            left = window.innerWidth - toolbarW - 12;
        }

        this.element.style.top = top + 'px';
        this.element.style.left = left + 'px';
        this.element.classList.toggle('arrow-down', isBelow);

        // Update active state indicators
        this._updateActiveStates();

        // Clear any pending hide
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
    },

    hide: function () {
        if (!this.visible) return;
        this.element.style.display = 'none';
        this.visible = false;
    },

    // ── Apply format ───────────────────────────────────────────
    _apply: function (key) {
        if (window.BlockEditor && window.BlockEditor.applyFormatting) {
            window.BlockEditor.applyFormatting(key);
        }

        // Don't hide after apply — user may want to chain formats
        // Check after a brief delay if the selection is gone
        var self = this;
        setTimeout(function () {
            var sel = window.getSelection();
            if (!sel.rangeCount || sel.isCollapsed) {
                self.hide();
            }
        }, 100);
    },

    // ── Active state indicators ────────────────────────────────
    _updateActiveStates: function () {
        var btns = this.element.querySelectorAll('[data-fmt-key]');
        btns.forEach(function (el) {
            var key = el.getAttribute('data-fmt-key');
            if (key === 'k' || key === 'l') return; // Link buttons — skip
            try {
                if (document.queryCommandState(key)) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            } catch (_) {
                el.classList.remove('active');
            }
        });
    },
};
