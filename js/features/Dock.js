import { State } from '../core/Store.js';
import { SettingsUI } from '../ui/SettingsUI.js';
import { saveConfig } from '../core/Config.js';

/* =========================================
   DOCK MODULE
   ========================================= */

export const Dock = {
    init: function() {
        this.render(State.ROOT_ID);
    },

    render: function() {
        var dock = document.getElementById('dock-links');
        if (!dock) return;
        dock.innerHTML = '';
        
        if (!Array.isArray(State.CONFIG.dock_links)) {
            State.CONFIG.dock_links = [
                { name: "GMAIL", url: "https://mail.google.com" },
                { name: "CAL", url: "https://calendar.google.com" },
                { name: "GPT", url: "https://chat.openai.com" }
            ];
        }

        var self = this;
        State.CONFIG.dock_links.forEach(function (link, index) {
            var a = document.createElement('a');
            a.href = link.url;
            a.textContent = link.name;
            a.className = 'dock-item';
            
            // Context Menu for Deletion
            a.oncontextmenu = function (e) {
                e.preventDefault();
                // Use custom confirm if available, else native
                if (window.showConfirmModal) {
                    window.showConfirmModal(
                        "DELETE LINK",
                        'Delete dock link "' + link.name + '"?',
                        function() {
                            State.CONFIG.dock_links.splice(index, 1);
                            saveConfig();
                            self.render();
                        }
                    );
                } else if (confirm('Delete dock link "' + link.name + '"?')) {
                    State.CONFIG.dock_links.splice(index, 1);
                    saveConfig();
                    self.render();
                }
            };
            dock.appendChild(a);
        });

        // Add Button
        var addBtn = document.createElement('span');
        addBtn.textContent = '+';
        addBtn.className = 'dock-add';
        addBtn.title = 'Add Link';
        addBtn.onclick = function () { SettingsUI.open('dock'); };
        dock.appendChild(addBtn);
    }
};

// Global Expose
window.renderDock = Dock.render.bind(Dock);
