// js/features/OnboardingTour.js - First-run guided tour + sample content seed.
//
// Shown once when State.CONFIG.first_run is true. Seeds a "Welcome to Vinland"
// note and a sample kanban board so the workspace feels alive immediately,
// then guides the user through running their first CLI command and previews
// the real keyboard shortcuts. Dismissing the tour (or finishing it) flips
// first_run to false so it never runs again.

import { State } from "../core/Store.js";
import { Config } from "../core/Config.js";
import { saveData, markNoteDirty } from "../core/Storage.js";
import { ModalManager } from "../ui/ModalManager.js";
import { CommandRegistry } from "../core/CommandRegistry.js";
import { CommandLine } from "./CommandLine.js";

const SEED_NOTE_TITLE = "Welcome to Vinland";
const SEED_BOARD_TITLE = "Welcome Board";
const DEMO_COMMAND = "task Buy groceries";

// Shared keyboard-shortcut registry: rendered in the tour's final step and
// echoed into the help modal at boot (see boot.js renderHelpShortcuts), so
// the two surfaces can never drift.
export const SHORTCUTS = [
  ["/", "Focus the command line"],
  ["Ctrl/⌘+K", "Focus the command line"],
  ["Ctrl/⌘+P", "Quick open a note"],
  ["Ctrl/⌘+,", "Open settings"],
  ["Ctrl/⌘+Shift+C", "Open calendar"],
  ["Ctrl/⌘+Shift+A", "Open daily agenda"],
  ["Ctrl/⌘+Shift+N", "Open template browser"],
  ["Ctrl/⌘+Shift+Q", "Dataview query"],
];

export const OnboardingTour = {
  _started: false,
  _step: 0,
  _typing: null,
  _onKeydown: null,

  start: function () {
    if (this._started) return;
    // Skip onboarding under automation: Playwright/WebDriver set
    // navigator.webdriver, and a modal on every fresh boot would make tests
    // non-deterministic. Real users (and the onboarding spec, which strips
    // the flag) still get the tour.
    if (typeof navigator !== "undefined" && navigator.webdriver) {
      State.CONFIG.first_run = false;
      if (Config && Config.save) Config.save();
      return;
    }
    this._started = true;
    this._step = 0;

    this._seedSampleContent();
    this._build();
    if (ModalManager) ModalManager.open("welcome-modal");
    this._bind();
    this._go(0);
  },

  // ── Sample content ──────────────────────────────────────────────
  _seedSampleContent: function () {
    const now = Date.now();

    if (!(State.NOTES || []).some((n) => n.title === SEED_NOTE_TITLE)) {
      const note = {
        id: "note_" + now,
        title: SEED_NOTE_TITLE,
        content:
          "# Welcome to Vinland\n\n" +
          "This is your new-tab command center — a terminal, a HUD, and a " +
          "personal knowledge workspace.\n\n" +
          "## Try the command line\n\n" +
          "Press `/` or `Ctrl+K`, then type:\n\n" +
          "- `task Buy groceries` — add a task\n" +
          "- `pomo 25` — start a focus timer\n" +
          "- `note Remember this` — quick note\n" +
          "- `daily` — today's journal\n" +
          "- `help` — the full command manual\n\n" +
          "## Everything is local\n\n" +
          "No account, no server, no tracking. Your notes, tasks, and boards " +
          "live only in this browser.\n",
        path: "/",
        links: [],
        created: now,
        modified: now,
      };
      State.NOTES.unshift(note);
      markNoteDirty(note.id);
    }

    if (!(State.BOARDS || []).some((b) => b.title === SEED_BOARD_TITLE)) {
      State.BOARDS.push({
        id: "board_" + now,
        title: SEED_BOARD_TITLE,
        created: now,
        modified: now,
        columns: [
          {
            id: "col_" + now + "_1",
            title: "PENDING",
            cards: [
              {
                id: "card_" + now + "_1",
                title: "Try the task command",
                text: "Type `task <text>` in the command line",
              },
            ],
          },
          { id: "col_" + now + "_2", title: "ACTIVE", cards: [] },
          { id: "col_" + now + "_3", title: "RESOLVED", cards: [] },
        ],
      });
    }

    saveData();
  },

  // ── DOM ─────────────────────────────────────────────────────────
  _build: function () {
    const modal = document.getElementById("welcome-modal");
    if (!modal) return;
    modal.classList.add("tour-active");
    modal.innerHTML =
      '<div class="config-header">WELCOME, OPERATOR //</div>' +
      '<div class="welcome-content">' +
      '<div class="tour-step" data-step="0">' +
        '<div class="tour-title">// SYSTEM INITIALIZED //</div>' +
        '<p class="tour-text">Welcome, Operator. This is <strong>Vinland</strong> — ' +
        'a terminal for your browser. Command line, focus HUD, notes, canvas, ' +
        'kanban, and more, all on your new tab. Everything runs locally.</p>' +
        '<div class="tour-actions">' +
          '<button id="tour-start" class="tour-btn">START TOUR</button>' +
          '<button id="tour-skip" class="tour-btn ghost">SKIP</button>' +
        '</div>' +
      '</div>' +
      '<div class="tour-step" data-step="1">' +
        '<div class="tour-title">YOUR FIRST COMMAND</div>' +
        '<p class="tour-text">Press <kbd>/</kbd> or <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> ' +
        'anytime to focus the command line. Watch what happens when you run a ' +
        'command:</p>' +
        '<div class="tour-demo"><span class="prompt">&gt;_</span><span id="tour-typed" class="tour-typed"></span><span class="tour-caret"></span></div>' +
        '<p class="tour-hint">Press <kbd>Enter</kbd> or click <b>RUN IT</b></p>' +
        '<div class="tour-actions"><button id="tour-run" class="tour-btn">RUN IT</button></div>' +
      '</div>' +
      '<div class="tour-step" data-step="2">' +
        '<div class="tour-title">TASK CREATED ✓</div>' +
        '<p class="tour-text">That command added a task, fired a notification, and ' +
        'logged the command to history. Every command works the same way — ' +
        'type it, hit <kbd>Enter</kbd>, done.</p>' +
        '<div class="tour-actions"><button id="tour-next" class="tour-btn">CONTINUE</button></div>' +
      '</div>' +
      '<div class="tour-step" data-step="3">' +
        '<div class="tour-title">KEYBOARD SHORTCUTS</div>' +
        '<ul class="tour-keys">' +
          SHORTCUTS.map(function (s) {
            return '<li><span class="k">' + s[0] + '</span><span>' + s[1] + '</span></li>';
          }).join("") +
        '</ul>' +
        '<div class="tour-actions"><button id="tour-finish" class="tour-btn">ENTER VINLAND</button></div>' +
      '</div>' +
      '<div class="tour-progress" id="tour-progress"></div>' +
      '</div>';
  },

  _bind: function () {
    const startBtn = document.getElementById("tour-start");
    if (startBtn) startBtn.onclick = () => this._go(1);
    const skipBtn = document.getElementById("tour-skip");
    if (skipBtn) skipBtn.onclick = () => this.finish();
    const runBtn = document.getElementById("tour-run");
    if (runBtn) runBtn.onclick = () => this._runDemo();
    const nextBtn = document.getElementById("tour-next");
    if (nextBtn) nextBtn.onclick = () => this._go(3);
    const finishBtn = document.getElementById("tour-finish");
    if (finishBtn) finishBtn.onclick = () => this.finish();

    // Enter on step 1 runs the demo command; Escape anywhere ends the tour.
    // (The rebuilt modal has no close-modal X button, so these are the only
    // close paths — buttons, Enter, Escape.)
    this._onKeydown = (e) => {
      if (e.key === "Enter" && this._step === 1) this._runDemo();
      if (e.key === "Escape") this.finish();
    };
    document.addEventListener("keydown", this._onKeydown, true);
  },

  _unbind: function () {
    if (this._onKeydown) document.removeEventListener("keydown", this._onKeydown, true);
    this._onKeydown = null;
  },

  _go: function (step) {
    this._step = step;
    const modal = document.getElementById("welcome-modal");
    if (!modal) return;
    modal.querySelectorAll(".tour-step").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.step) === step);
    });
    this._renderProgress(step);
    if (step === 1) this._typeDemo();
  },

  _renderProgress: function (step) {
    const bar = document.getElementById("tour-progress");
    if (!bar) return;
    bar.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement("span");
      dot.className = "tour-dot" + (i <= step ? " on" : "");
      bar.appendChild(dot);
    }
  },

  _typeDemo: function () {
    const el = document.getElementById("tour-typed");
    if (!el) return;
    if (this._typing) clearInterval(this._typing);
    el.textContent = "";
    let i = 0;
    this._typing = setInterval(() => {
      i++;
      el.textContent = DEMO_COMMAND.slice(0, i);
      if (i >= DEMO_COMMAND.length) clearInterval(this._typing);
    }, 45);
  },

  _runDemo: function () {
    if (this._step !== 1) return;
    const taskCmd = CommandRegistry.commands.find((c) => c.trigger === "task");
    if (taskCmd) CommandLine.execute(taskCmd, "Buy groceries");
    this._go(2);
  },

  // ── Finish ──────────────────────────────────────────────────────
  finish: function () {
    if (!this._started) return;
    this._started = false;
    if (this._typing) clearInterval(this._typing);
    this._unbind();
    State.CONFIG.first_run = false;
    if (Config && Config.save) Config.save();
    if (ModalManager) ModalManager.close("welcome-modal");
  },
};
