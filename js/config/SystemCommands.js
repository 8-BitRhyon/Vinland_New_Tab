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
        if (window.Notes) window.Notes.create(args);
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
          window.Notes.create(title, "/Journal");
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
        if (window.SettingsUI && window.SettingsUI.applyThemePreset) {
          window.SettingsUI.applyThemePreset(args);
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

    // --- POMODORO ---
    CommandRegistry.register({
      id: "pomo:start",
      trigger: "pomo",
      title: "Start Pomodoro",
      hint: "[duration] (e.g. 25m, 90s)",
      action: (args) => {
        if (window.startPomodoro) window.startPomodoro(args);
      },
    });
  },
};
