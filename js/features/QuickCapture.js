import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { safeText } from '../core/Utils.js';



export const QuickCapture = {
    isOpen: false,

    init: function() {
        // Listen for context menu captures from service worker
        this._listenForMessages();
        // Check for any pending captures stored while no tab was open
        this._checkPendingCapture();
    },

    

    _listenForMessages: function() {
        var self = this;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
                if (message && message.type === 'QUICK_CAPTURE' && message.text) {
                    self.captureFromContextMenu(message.text);
                    self._showConfirmation();
                    sendResponse({ success: true });
                }
            });
            console.log('[QuickCapture] Message listener registered');
        }
    },

    _checkPendingCapture: function() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        var self = this;
        chrome.storage.local.get(['vinland_pending_capture'], function(result) {
            if (result.vinland_pending_capture) {
                self.captureFromContextMenu(result.vinland_pending_capture);
                // Clear it so it's not captured again
                chrome.storage.local.remove('vinland_pending_capture');
                self._showConfirmation();
                console.log('[QuickCapture] Pending capture processed');
            }
        });
    },

    open: function() {
        if (this.isOpen) {
            this.close();
            return;
        }

        this._injectDOM();

        // Render inbox preview of recent captures
        this.renderInboxPreview();

        var overlay = document.getElementById('quick-capture-overlay');
        var input = document.getElementById('quick-capture-input');

        if (overlay) overlay.classList.add('active');
        this.isOpen = true;

        if (input) {
            setTimeout(function() { input.focus(); }, 30);
        }
    },

    close: function() {
        var overlay = document.getElementById('quick-capture-overlay');
        if (overlay) overlay.classList.remove('active');
        this.isOpen = false;
    },

    toggle: function() {
        if (this.isOpen) this.close();
        else this.open();
    },

    

    _injectDOM: function() {
        if (document.getElementById('quick-capture-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'quick-capture-overlay';
        overlay.className = 'quick-capture-overlay';

        overlay.innerHTML =
            '<div class="quick-capture-panel">' +
                '<div class="quick-capture-header">' +
                    '<span class="quick-capture-icon">&#x2709;</span>' +
                    '<input id="quick-capture-input" type="text" placeholder="Capture a thought... (Enter to save, Esc to cancel)" autocomplete="off" spellcheck="false">' +
                    '<span class="quick-capture-hint">/Inbox</span>' +
                '</div>' +
                '<div id="quick-capture-inbox-preview" class="quick-capture-inbox-preview"></div>' +
            '</div>';

        // Close on overlay click
        var self = this;
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) self.close();
        });

        document.body.appendChild(overlay);

        // Bind input events
        var input = document.getElementById('quick-capture-input');
        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    self._capture();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    self.close();
                }
            });
        }
    },

    

    _capture: function() {
        var input = document.getElementById('quick-capture-input');
        if (!input) return;

        var text = input.value.trim();
        if (!text) {
            this.close();
            return;
        }

        // Create a note in /Inbox with timestamp
        var timestamp = new Date().toLocaleString();
        var title = text.length > 40 ? text.substring(0, 40) + '...' : text;

        var newNote = {
            id: 'inbox_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            title: title,
            content: text + '\n\n_Captured ' + timestamp + '_',
            path: '/Inbox',
            links: [],
            created: new Date().getTime(),
            modified: new Date().getTime()
        };

        State.NOTES.unshift(newNote);
        saveData();

        // Re-render sidebar and notes panel to show new inbox note
        if (window.Notes) {
            window.Notes.renderNotes();
            window.Notes.renderSidebar();
        }

        // Show confirmation
        this._showConfirmation();

        // Clear and close
        input.value = '';
        this.close();
    },

    _showConfirmation: function() {
        var existing = document.getElementById('quick-capture-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'quick-capture-toast';
        toast.textContent = 'CAPTURED TO INBOX';
        toast.style.cssText = 'position:fixed; top:80px; left:50%; transform:translateX(-50%); ' +
            'background:var(--main-color); color:#000; padding:8px 20px; ' +
            'font-family:var(--font-main); font-size:0.8rem; font-weight:bold; ' +
            'z-index:30000; opacity:0; transition:opacity 0.2s ease; ' +
            'pointer-events:none;';

        document.body.appendChild(toast);

        requestAnimationFrame(function() {
            toast.style.opacity = '1';
        });

        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() {
                if (toast.parentElement) toast.parentElement.removeChild(toast);
            }, 200);
        }, 1500);
    },

    

    renderInboxPreview: function() {
        var container = document.getElementById('quick-capture-inbox-preview');
        if (!container) return;

        var inboxNotes = (State.NOTES || []).filter(function(n) {
            return n.path === '/Inbox' && !(n.path && n.path.indexOf('/.trash') === 0);
        });

        // Sort by created date (newest first)
        inboxNotes.sort(function(a, b) {
            return (b.created || 0) - (a.created || 0);
        });

        // Show latest 5
        var latest = inboxNotes.slice(0, 5);

        if (latest.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';

        var html = '<div class="qc-inbox-header">RECENT INBOX (' + inboxNotes.length + ' total)</div>';
        var self = this;

        latest.forEach(function(note) {
            var snippet = (note.content || '').substring(0, 60);
            if ((note.content || '').length > 60) snippet += '...';

            html += '<div class="qc-inbox-item" data-note-id="' + note.id + '">' +
                '<div class="qc-inbox-item-title">' + safeText(note.title || 'Untitled') + '</div>' +
                '<div class="qc-inbox-item-snippet">' + safeText(snippet) + '</div>' +
                '</div>';
        });

        if (inboxNotes.length > 5) {
            html += '<div class="qc-inbox-more">+' + (inboxNotes.length - 5) + ' more in /Inbox</div>';
        }

        container.innerHTML = html;

        // Bind click to open note
        Array.from(container.querySelectorAll('.qc-inbox-item')).forEach(function(el) {
            el.addEventListener('click', function() {
                var id = el.getAttribute('data-note-id');
                if (id && window.Notes) {
                    window.Notes.open(id);
                    self.close();
                }
            });
        });
    },

    

    captureFromContextMenu: function(text) {
        if (!text || !text.trim()) return;
        this._createInboxNote(text, 'context menu');
        console.log('[QuickCapture] Captured from context menu');
    }
};
