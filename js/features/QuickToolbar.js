// js/features/QuickToolbar.js - Mouse-parity quick-access toolbar.
//
// The CLI is the keyboard path; this is the mouse path to the same features.
// Each button executes the registered command with the identical action
// (CommandLine.execute), so tooltips, notifications, and history behave
// exactly as if the user typed the trigger. Hidden in zen mode and when the
// `show_toolbar` setting is off.

import { State } from "../core/Store.js";
import { CommandRegistry } from "../core/CommandRegistry.js";
import { CommandLine } from "./CommandLine.js";

const BUTTONS = [
  { label: "NO", title: "Notes", command: "notes" },
  { label: "KB", title: "Kanban", command: "board" },
  { label: "CA", title: "Calendar", command: "calendar" },
  { label: "DA", title: "Daily note", command: "daily" },
  { label: "PO", title: "Pomodoro", command: "pomo" },
  { label: "SE", title: "Settings", command: null, direct: "settings" },
];

export const QuickToolbar = {
  _container: null,

  init: function () {
    if (this._container || !document.body) return;
    const container = document.createElement("div");
    container.className = "quick-toolbar";
    container.id = "quick-toolbar";
    container.setAttribute("role", "toolbar");
    container.setAttribute("aria-label", "Quick access");

    BUTTONS.forEach((btn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "qt-btn";
      b.textContent = btn.label;
      b.title = btn.title;
      b.setAttribute("aria-label", btn.title);
      b.addEventListener("click", () => this._run(btn));
      container.appendChild(b);
    });

    document.body.appendChild(container);
    this._container = container;
    this._sync();
  },

  _run: function (btn) {
    if (btn.direct === "settings") {
      if (window.SettingsUI && window.SettingsUI.toggleConfig) {
        window.SettingsUI.toggleConfig();
      }
      return;
    }
    const cmd = CommandRegistry.commands.find((c) => c.trigger === btn.command);
    if (cmd) CommandLine.execute(cmd, btn.args || "");
  },

  // Reflect the show_toolbar setting + zen mode (CSS handles zen).
  _sync: function () {
    if (!this._container) return;
    this._container.style.display =
      State.CONFIG.show_toolbar === false ? "none" : "";
  },

  destroy: function () {
    if (this._container) {
      this._container.remove();
      this._container = null;
    }
  },
};
