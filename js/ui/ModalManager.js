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
            
            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-msg').innerText = msg;
            
            var okBtn = document.getElementById('confirm-btn-ok');
            var cancelBtn = document.getElementById('confirm-btn-cancel');
            
            // create distinct secondary button if needed, or use existing hook?
            // Easier: Manipulate DOM of 'modal-actions'
            var actionsDiv = modal.querySelector('.modal-actions');
            if (!actionsDiv) return;
            actionsDiv.innerHTML = ''; // Clear existing
            
            // 1. CANCEL BUTTON (Always present, acts as "Stay" or "Abort")
            var btnCancel = document.createElement('button');
            btnCancel.className = 'btn';
            btnCancel.innerText = 'CANCEL';
            btnCancel.onclick = function() {
                // If NO secondary text, this act as the legacy secondary (Cancel) handler
                if (!secondaryText && onSecondary) onSecondary();
                ModalManager.close('confirm-modal');
            };
            actionsDiv.appendChild(btnCancel);
            
            // 2. SECONDARY BUTTON (Optional: "DISCARD")
            if (secondaryText) {
                var btnSec = document.createElement('button');
                btnSec.className = 'btn confirm-btn-danger'; // Red styling for discard
                btnSec.innerText = secondaryText;
                btnSec.style.marginLeft = '10px';
                btnSec.onclick = function() {
                     if (onSecondary) onSecondary();
                     ModalManager.close('confirm-modal');
                };
                actionsDiv.appendChild(btnSec);
            }
            
            // 3. PRIMARY BUTTON (SAVE/CONFIRM)
            var btnOk = document.createElement('button');
            btnOk.className = 'btn primary-btn';
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
        
        // V62: UI Sound - Assuming playModalSound is global or imported later. 
        // For now, checks if it exists globally to avoid errors during refactor.
        if (typeof playModalSound === 'function') playModalSound(); 
        
        // 1. Show modal
        modal.classList.add('active');
        modal.style.display = 'flex'; // Consistent with Vinland flex layout
        
        // 2. Manage Z-Index stacking (V15.3+: Higher base to avoid CLI overlap)
        modal.style.zIndex = 21000 + this.stack.length; 
        
        // V27: One Modal Policy - Close conflicting "Main" modals
        // If opening a main modal (Settings/Manual/Graph), close others to prevent clutter.
        // Helper modals (Note Help/Confirm) are exempt and stack on top.
        const mainModals = ['config-modal', 'help-modal', 'graph-modal', 'history-modal'];
        if (mainModals.includes(modalId)) {
            mainModals.forEach(id => {
                if (id !== modalId) {
                    const other = document.getElementById(id);
                    if (other && other.classList.contains('active')) {
                        // Close without triggering full stack reset if possible, or just hide
                        other.classList.remove('active');
                        other.style.display = 'none';
                        // Remove from stack if present
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
        // Check both stack and class for robustness
        if (this.stack.includes(modalId) || (modal && modal.classList.contains('active'))) {
            this.close(modalId);
        } else {
            this.open(modalId);
        }
    },

    closeTop: function(force) {
        if (this.stack.length === 0) {
            // Command Input Cleanup as fallback (V15.3)
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
        
        // V15.3: Priority Safety Gates
        if (!force) {
            if (modalId === 'config-modal') {
                // Settings modal - check for unsaved changes
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
                // Close the confirm modal - if settings still has unsaved changes,
                // the next ESC will re-trigger the unsaved changes modal (recursive behavior)
                console.log('[closeTop] Closing confirm-modal, stack before:', JSON.stringify(this.stack));
                this.stack.pop();
                console.log('[closeTop] Stack after pop:', JSON.stringify(this.stack));
                var confirmModal = document.getElementById(modalId);
                if (confirmModal) {
                    confirmModal.classList.remove('active');
                    // Don't set inline display:none - CSS handles it via .active class
                    confirmModal.style.display = ''; // Clear any inline display style
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

        // Standard close logic
        this.stack.pop();
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            // V61: Force-reset maximized state and restore icons on close
            // V85: Removed force-reset of maximized state (User Request: Absolute Throughput)
            // State is now persisted via localStorage in NotesController.
        }

        if (this.stack.length === 0) {
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    closeAll: function() {
        while(this.stack.length > 0) this.closeTop();
    },

    // Global Init - Run this in init()
    close: function(modalId) {
        // If no ID provided, default to closeTop
        if (!modalId) {
            this.closeTop();
            return;
        }

        // Remove from stack
        this.stack = this.stack.filter(id => id !== modalId);
        
        // Hide element
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }

        // Cleanup
        if (this.stack.length === 0) {
            var overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    },

    init: function() {
        if (this.initialized) return;
        this.initialized = true;

        this.initConfirmModal();

        // Handle ESC Key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.stack.length > 0) {
                    e.preventDefault();
                    e.stopPropagation(); 
                    this.closeTop();
                }
            }
        });

        // Handle Click Outside (The Overlay)
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
