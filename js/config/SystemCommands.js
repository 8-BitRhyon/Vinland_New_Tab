import { CommandRegistry } from "../core/CommandRegistry.js";
import { State } from "../core/Store.js";

export const SystemCommands = {
  register: function () {
    console.log("[SystemCommands] Registering System Commands...");

    // --- NOTES ---
    CommandRegistry.register({
      id: "notes:create",
      trigger: "note",
      title: "Create New Note",
      hint: "[content]",
      action: (args) => {
        if (window.Notes) {
          // Parse --template flag from args
          var title = args || '';
          var templateName = null;
          var templateMatch = title.match(/--template "([^"]+)"/);
          if (templateMatch) {
            templateName = templateMatch[1];
            title = title.replace(/--template "[^"]+"/, '').trim();
          } else {
            var simpleMatch = title.match(/--template ([\w\s]+)/i);
            if (simpleMatch && !simpleMatch[1].startsWith('--')) {
              templateName = simpleMatch[1].trim();
              title = title.replace(/--template [\w\s]+/i, '').trim();
            }
          }
          window.Notes.create(title || '', '/', templateName);
        }
      },
    });

    CommandRegistry.register({
      id: "notes:toggle",
      trigger: "notes",
      title: "Open Notes Editor",
      action: () => {
        if (window.Notes) window.Notes.toggleSidebar();
      },
    });

    // --- CANVAS ---
    CommandRegistry.register({
      id: "canvas:open",
      trigger: "canvas",
      title: "Create/Open Canvas",
      action: (args) => { 
            const title = args || 'Untitled Canvas';
            const newCanvas = {
                id: 'canvas_' + Date.now(),
                title: title,
                type: 'canvas',
                path: '/',
                canvasData: { nodes: [], edges: [] },
                created: Date.now(),
                modified: Date.now()
            };
            window.State.NOTES.unshift(newCanvas);
            if (window.saveData) window.saveData();
            
            if (window.Notes) window.Notes.open(newCanvas.id);
            
            // 🚨 FIX: Force the Note Editor modal to open
            if (window.ModalManager) {
                window.ModalManager.open('note-editor-modal');
            }
            
            if (window.Notes) window.Notes.renderSidebar();
        }
    });

    CommandRegistry.register({
      id: "nav:daily",
      trigger: "daily",
      title: "Open Daily Note",
      action: () => {
        if (!window.Notes) return;
        const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
        const title = `Daily Log ${today}`;
        const exists = window.Notes.openByTitle(title);
        if (!exists) {
          // Auto-apply daily note template if configured
          var templateName = null;
          if (window.State && window.State.CONFIG && window.State.CONFIG.daily_note_template) {
            templateName = window.State.CONFIG.daily_note_template;
          }
          window.Notes.create(title, '/Journal', templateName);
        }
      },
    });

    CommandRegistry.register({
      id: "nav:random",
      trigger: "random",
      title: "Open Random Note",
      action: () => {
        if (window.State && State.NOTES && State.NOTES.length > 0) {
          const rnd = Math.floor(Math.random() * State.NOTES.length);
          window.Notes.open(State.NOTES[rnd].id);
        }
      },
    });

    // --- TASKS ---
    CommandRegistry.register({
      id: "task:add",
      trigger: "task",
      title: "Add Task",
      hint: "[text]",
      action: (args) => {
        if (window.addTask) window.addTask(args);
      },
    });

    CommandRegistry.register({
      id: "task:clear-done",
      trigger: "clear done",
      title: "Clear Completed Tasks",
      action: () => {
        if (window.clearCompletedTasks) window.clearCompletedTasks();
      },
    });

    // --- SYSTEM ---
    CommandRegistry.register({
      id: "sys:reload",
      trigger: "reload",
      title: "Reload System",
      action: () => {
        window.location.reload();
      },
    });

    CommandRegistry.register({
      id: "sys:theme",
      trigger: "theme",
      title: "Switch Theme",
      hint: "[name]",
      action: (args) => {
        console.log("Switching theme to", args);
        if (args === 'default') {
          // Reset to defaults: clear theme_preset and re-apply
          if (window.State && window.State.CONFIG) {
            window.State.CONFIG.theme_preset = '';
            window.State.CONFIG.theme_color = '#00FF41';
            window.State.CONFIG.secondary_color = '#888888';
            if (window.Config && window.Config.applyTheme) {
              window.Config.applyTheme();
            }
          }
          return;
        }
        if (window.SettingsUI && window.SettingsUI.loadThemePreset) {
          window.SettingsUI.loadThemePreset(args);
        }
      },
    });

    CommandRegistry.register({
      id: "ui:zen",
      trigger: "zen",
      title: "Toggle Zen Mode",
      action: () => {
        document.body.classList.toggle("zen-mode");
        const isZen = document.body.classList.contains("zen-mode");
        if (window.showNotification)
          window.showNotification(`ZEN MODE: ${isZen ? "ON" : "OFF"}`);
      },
    });

    CommandRegistry.register({
      id: "ui:kill",
      trigger: "kill",
      title: "Close All Modals",
      action: () => {
        if (window.ModalManager) window.ModalManager.closeAll();
      },
    });

    // --- KANBAN ---
    CommandRegistry.register({
      id: "kanban:open",
      trigger: "board",
      title: "Open Kanban Board",
      action: () => {
        if (window.KanbanManager) window.KanbanManager.open();
      },
    });

    CommandRegistry.register({
      id: "kanban:quick",
      trigger: "kanban",
      title: "Open Kanban Board",
      action: () => {
        if (window.KanbanManager) window.KanbanManager.open();
      },
    });

    // --- BOOKMARKS ---
    CommandRegistry.register({
      id: "bm:search",
      trigger: "b",
      title: "Search Bookmarks",
      hint: "[query]",
      action: (args) => {
        if (!args) return;
        const q = args.toLowerCase().trim();
        if (q.endsWith('/')) return; // Don't execute on folder paths, wait for more input

        const matches = (State.FLAT_BOOKMARKS || []).filter(b => 
            b.url && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
        );
        if (matches.length > 0) {
            window.location.href = matches[0].url;
        } else {
             if (window.showNotification) showNotification(`No bookmark found for "${args}"`, 'error');
        }
      },
    });

    // --- FOCUS ---
    CommandRegistry.register({
      id: "pomo:start",
      trigger: "pomo",
      title: "Start Pomodoro",
      hint: "[time] e.g. 25m, 90s, 50:00",
      action: (args) => {
        if (window.Pomodoro) window.Pomodoro.start(args);
      },
    });

    // --- INFO ---
    CommandRegistry.register({
      id: "info:weather",
      trigger: "weather",
      title: "Refresh Weather",
      hint: "[location]",
      action: (args) => {
        if (args) {
          State.CONFIG.location = args.trim();
          if (window.Config) window.Config.save();
        }
        if (window.fetchWeather) window.fetchWeather();
      },
    });

    // --- HELP ---
    CommandRegistry.register({
      id: "info:help",
      trigger: "help",
      title: "Open Operator Manual",
      action: () => {
        if (window.SettingsUI && window.SettingsUI.toggleHelp) window.SettingsUI.toggleHelp();
        else if (window.ModalManager) window.ModalManager.open('help-modal');
      },
    });

    CommandRegistry.register({
      id: "info:find",
      trigger: "find",
      title: "Search Notes",
      hint: "[query]",
      action: (args) => {
        if (window.QuickOpen) window.QuickOpen.searchFromCLI(args || '');
      },
    });

    CommandRegistry.register({
      id: "info:search",
      trigger: "search",
      title: "Search Notes (alias)",
      hint: "[query]",
      action: (args) => {
        if (window.QuickOpen) window.QuickOpen.searchFromCLI(args || '');
      },
    });

    CommandRegistry.register({
      id: "nav:calendar",
      trigger: "calendar",
      title: "Open Calendar View",
      action: () => {
        if (window.Calendar) window.Calendar.open();
      },
    });

    CommandRegistry.register({
      id: "nav:agenda",
      trigger: "agenda",
      title: "Open Daily Agenda (Week/Month View)",
      action: () => {
        if (window.DailyAgenda) window.DailyAgenda.open();
      },
    });

    // --- TEMPLATES ---
    CommandRegistry.register({
      id: "nav:templates",
      trigger: "template",
      title: "Browse Templates & Create Note",
      hint: "[name]",
      action: (args) => {
        if (window.TemplateBrowser) {
          if (args && args.trim()) {
            // Direct creation from a named template
            if (window.Notes) {
              window.Notes.create('', '/', args.trim());
            }
          } else {
            window.TemplateBrowser.open();
          }
        }
      },
    });

    CommandRegistry.register({
      id: "nav:tags",
      trigger: "tags",
      title: "Browse & Filter by Tag",
      hint: "[query]",
      action: (args) => {
        if (window.TagBrowser) {
          if (args && args.trim()) {
            window.TagBrowser.openFromCLI(args);
          } else {
            window.TagBrowser.open();
          }
        }
      },
    });

    // --- DATAVIEW QUERY ---
    CommandRegistry.register({
      id: "dataview:open",
      trigger: "dv",
      title: "Open Dataview Query Panel",
      hint: "[query]",
      action: (args) => {
        if (window.DataviewQuery) {
          if (args && args.trim()) {
            window.DataviewQuery.openWithQuery(args);
          } else {
            window.DataviewQuery.open();
          }
        }
      },
    });

    CommandRegistry.register({
      id: "dataview:open-full",
      trigger: "dataview",
      title: "Open Dataview Query Panel",
      hint: "[query]",
      action: (args) => {
        if (window.DataviewQuery) {
          if (args && args.trim()) {
            window.DataviewQuery.openWithQuery(args);
          } else {
            window.DataviewQuery.open();
          }
        }
      },
    });

    CommandRegistry.register({
      id: "info:man",
      trigger: "man",
      title: "Open Operator Manual",
      action: () => {
        if (window.SettingsUI && window.SettingsUI.toggleHelp) window.SettingsUI.toggleHelp();
        else if (window.ModalManager) window.ModalManager.open('help-modal');
      },
    });

    // --- EXPORT ---
    CommandRegistry.register({
      id: "data:export",
      trigger: "export",
      title: "Export All Data as JSON",
      hint: "",
      action: () => {
        if (window.Notes && window.Notes.downloadNotes) {
          window.Notes.downloadNotes();
        }
      },
    });

    // --- IMPORT ---
    CommandRegistry.register({
      id: "data:import",
      trigger: "import",
      title: "Import Data from JSON Backup",
      hint: "",
      action: () => {
        if (window.SettingsUI && window.SettingsUI.triggerImport) {
          window.SettingsUI.triggerImport();
        }
      },
    });

    // --- FLASHCARD REVIEW ---
    CommandRegistry.register({
      id: "flashcard:review",
      trigger: "review",
      title: "Start Flashcard Review Session",
      hint: "",
      action: () => {
        if (window.FlashcardManager) {
          window.FlashcardManager.startReviewSession();
        }
      },
    });

    CommandRegistry.register({
      id: "flashcard:stats",
      trigger: "flashcards",
      title: "Show Flashcard Stats & Start Review",
      hint: "",
      action: () => {
        if (window.FlashcardManager) {
          window.FlashcardManager.showStats().then(function() {
            // After showing stats, open the review session
            window.FlashcardManager.startReviewSession();
          });
        }
      },
    });

    // --- VERSION HISTORY ---
    CommandRegistry.register({
      id: "version:history",
      trigger: "versions",
      title: "View Note Version History",
      hint: "",
      action: () => {
        if (window.VersionHistoryManager) {
          window.VersionHistoryManager.openModal();
        }
      },
    });

    // --- OBSIDIAN IMPORT ---
    CommandRegistry.register({
      id: "obsidian:import",
      trigger: "obsidian-import",
      title: "Import .md Files from Obsidian Vault",
      hint: "",
      action: () => {
        if (window.ObsidianImporter) {
          window.ObsidianImporter.openFilePicker();
        }
      },
    });

    // --- WORKSPACES ---
    CommandRegistry.register({
      id: "workspace:manage",
      trigger: "workspace",
      title: "Save/Load Workspace Snapshots",
      hint: "save|load|delete|list",
      action: (args) => {
        if (window.WorkspaceManager) {
          window.WorkspaceManager.handleCLI(args || '');
        }
      },
    });
  },
};
