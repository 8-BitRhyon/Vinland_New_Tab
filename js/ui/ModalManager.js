import { State } from '../core/Store.js';

/* =========================================
   CORE SYSTEM: MODAL MANAGER
   Handles stacking, clicking out, and ESC
   ========================================= */
export const ModalManager = {
    stack: [], 

    initConfirmModal: function() {
        window.showConfirmModal = function(title, msg, onConfirm, onSecondary, primaryText, secondaryText) {
            var modal = document.getElementById('confirm-modal');
            if (!modal) return;
            
            var titleEl = modal.querySelector('#confirm-title') || document.getElementById('confirm-title');
            var msgEl = modal.querySelector('#confirm-msg') || document.getElementById('confirm-msg');
            
            if(titleEl) titleEl.innerText = title;
            else console.warn('Confirm Modal Title Element Missing');
            
            if(msgEl) msgEl.innerText = msg;
            
            var actionsDiv = modal.querySelector('.modal-actions');
            if (!actionsDiv) return;
            actionsDiv.innerHTML = '';
            
            var btnCancel = document.createElement('button');
            btnCancel.className = 'btn';
            btnCancel.innerText = 'CANCEL';
            btnCancel.onclick = function() {
                if (!secondaryText && onSecondary) onSecondary();
                ModalManager.close('confirm-modal');
            };
            actionsDiv.appendChild(btnCancel);
            
            // SECONDARY BUTTON (Optional: "DISCARD")
            if (secondaryText) {
                var btnSec = document.createElement('button');
                btnSec.className = 'btn danger-btn';
                btnSec.innerText = secondaryText;
                btnSec.style.marginLeft = '10px';
                btnSec.onclick = function() {
                     if (onSecondary) onSecondary();
                     ModalManager.close('confirm-modal');
                };
                actionsDiv.appendChild(btnSec);
            }
            
            // PRIMARY BUTTON (SAVE/CONFIRM/DELETE)
            var btnOk = document.createElement('button');
            btnOk.className = 'btn primary-btn';
            
            // If intent is destructive (delete), style appropriately
            if (title.toLowerCase().includes('remove') || title.toLowerCase().includes('delete')) {
                btnOk.className = 'btn danger-btn';
            }
            
            btnOk.innerText = primaryText || 'CONFIRM';
            btnOk.style.marginLeft = '10px';
            btnOk.onclick = function() {
                if (onConfirm) onConfirm();
                ModalManager.close('confirm-modal');
            };
            actionsDiv.appendChild(btnOk);

            ModalManager.open('confirm-modal');
        };
        
        window.closeConfirmModal = function() {
            ModalManager.close('confirm-modal');
        };
    },
    openInput: function(title, placeholder, onConfirm, onCancel) {
        var modal = document.getElementById('input-modal');
        if (!modal) return;
        
        document.getElementById('input-modal-title').innerText = title;
        var input = document.getElementById('input-modal-field');
        input.value = '';
        input.placeholder = placeholder || '...';
        
        var confirmBtn = document.getElementById('input-modal-confirm');
        var cancelBtn = document.getElementById('input-modal-cancel');
        
        confirmBtn.onclick = function() {
            var val = input.value.trim();
            if (val) {
                if (onConfirm) onConfirm(val);
                ModalManager.close('input-modal');
            }
        };
        
        cancelBtn.onclick = function() {
            if (onCancel) onCancel();
            ModalManager.close('input-modal');
        };

        input.onkeydown = function(e) {
            if (e.key === 'Enter') confirmBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        };

        this.open('input-modal');
        setTimeout(function() { input.focus(); }, 50);
    },

    open: function(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        if (typeof playModalSound === 'function') playModalSound(); 
        
        modal.classList.add('active');
        modal.style.display = 'flex';

        // a11y: dialog semantics + keyboard focus management
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        this._lastFocus = document.activeElement;
        const exemptTrap = (modalId === 'note-editor-modal'); // editor owns Tab for indent
        // Defer focus to avoid trusted-click interference: if open() is called
        // while a keyboard event is still propagating (e.g. Enter from CLI),
        // focusing a button in the dialog causes the browser to dispatch a
        // click on it.  setTimeout(0) lets the current event finish first.
        setTimeout(() => this._focusDialog(modal), 0);
        if (!exemptTrap) this._installTrap(modal);
        
        // 2. Manage Z-Index stacking (V15.3+: Higher base to avoid CLI overlap)
        modal.style.zIndex = 21000 + this.stack.length; 
        
        // Other main modals close to prevent clutter.
        // Helper modals (Note Help/Confirm) are exempt and stack on top.
        const mainModals = ['config-modal', 'help-modal', 'graph-modal', 'history-modal'];
        if (mainModals.includes(modalId)) {
            mainModals.forEach(id => {
                if (id !== modalId) {
                    const other = document.getElementById(id);
                    if (other && other.classList.contains('active')) {
                        other.classList.remove('active');
                        other.style.display = 'none';
                        this.stack = this.stack.filter(item => item !== id);
                    }
                }
            });
        }

        // 3. Add to stack
        if (!this.stack.includes(modalId)) {
            this.stack.push(modalId);
        }
        
        // 4. Show Overlay if this is the first modal
        var overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('active');
    },

    toggle: function(modalId) {
        var modal = document.getElementById(modalId);
        if (this.stack.includes(modalId) || (modal && modal.classList.contains('active'))) {
            this.close(modalId);
        } else {
            this.open(modalId);
        }
    },

    closeTop: function(force) {
        if (this.stack.length === 0) {
            var input = document.getElementById('cmd-input');
            if (input && (input.value || document.activeElement === input)) {
                input.value = '';
                input.blur();
                var suggestionsBox = document.getElementById('suggestions');
                if (suggestionsBox) suggestionsBox.style.display = 'none';
            }
            return;
        }

        const modalId = this.stack[this.stack.length - 1];
        
        if (!force) {
            if (modalId === 'config-modal') {
                if (typeof window.closeSettingsModal === 'function') {
                    window.closeSettingsModal(); 
                    return;
                }
            }
            if (modalId === 'note-editor-modal') {
                if (typeof window.closeNoteEditor === 'function') {
                    window.closeNoteEditor();
                    return;
                }
            }
            if (modalId === 'confirm-modal') {
                // Close the confirm modal; if settings still has unsaved changes,
                // the next ESC will re-trigger the unsaved changes modal (recursive behavior)
                console.log('[closeTop] Closing confirm-modal, stack before:', JSON.stringify(this.stack));
                this.stack.pop();
                console.log('[closeTop] Stack after pop:', JSON.stringify(this.stack));
                var confirmModal = document.getElementById(modalId);
                if (confirmModal) {
                    confirmModal.classList.remove('active');
                    confirmModal.style.display = '';
                }
                console.log('[closeTop] Confirm-modal hidden, returning');
                return;
            }
            if (modalId === 'kanban-modal') {
                if (typeof window.KanbanManager !== 'undefined' && window.KanbanManager.close) {
                    window.KanbanManager.close();
                    return;
                }
            }
        }

        this.stack.pop();
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            this._removeTrap(modal);
        }

        if (this.stack.length === 0) {
            this._restoreFocus();
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    closeAll: function() {
        while(this.stack.length > 0) this.closeTop();
    },

    // a11y: move focus into the dialog (first focusable, else the dialog itself)
    _focusDialog: function(modal) {
        const focusable = this._focusable(modal);
        if (focusable.length) {
            try { focusable[0].focus(); } catch (e) {}
        } else {
            modal.setAttribute('tabindex', '-1');
            try { modal.focus(); } catch (e) {}
        }
    },

    _focusable: function(modal) {
        return Array.prototype.slice.call(
            modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')
        ).filter(function (el) {
            return el.offsetParent !== null || el.getClientRects().length > 0;
        });
    },

    // a11y: keep Tab focus inside the dialog (wrap first<->last)
    _installTrap: function(modal) {
        const self = this;
        const handler = function (e) {
            if (e.key !== 'Tab') return;
            const f = self._focusable(modal);
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        };
        modal._trapHandler = handler;
        modal.addEventListener('keydown', handler);
    },

    _removeTrap: function(modal) {
        if (modal && modal._trapHandler) {
            modal.removeEventListener('keydown', modal._trapHandler);
            modal._trapHandler = null;
        }
    },

    // a11y: return focus to the element that opened the dialog
    _restoreFocus: function() {
        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            try { this._lastFocus.focus(); } catch (e) {}
        }
        this._lastFocus = null;
    },

    close: function(modalId) {
        if (!modalId) {
            this.closeTop();
            return;
        }

        this.stack = this.stack.filter(id => id !== modalId);
        
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            this._removeTrap(modal);
        }

        if (this.stack.length === 0) {
            this._restoreFocus();
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    init: function() {
        if (this.initialized) return;
        this.initialized = true;

        this.initConfirmModal();

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.stack.length > 0) {
                    e.preventDefault();
                    e.stopPropagation(); 
                    this.closeTop();
                }
            }
        });

        // Handle click outside (the overlay)
        var overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (this.stack.length > 0) {
                    this.closeTop();
                }
            });
        }
    }
};
