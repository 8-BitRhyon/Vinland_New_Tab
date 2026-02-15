import { State } from '../core/Store.js';
import { play8BitSound } from '../core/Audio.js';

/* =========================================
   POMODORO TIMER
   ========================================= */

// Local state replacing global State.POMODORO
export let POMODORO = {
    active: false,
    paused: false,
    endTime: null,
    remaining: 0,
    interval: null,
    originalDuration: 0
};

export function parseTime(input) {
    if (!input) return 25 * 60 * 1000;
    input = input.toString().trim();

    // Handle "90s" or "30m" format (V18.1)
    if (input.endsWith('s')) return parseInt(input) * 1000;
    if (input.endsWith('m')) return parseInt(input) * 60 * 1000;

    // Handle "M:SS" format
    if (input.includes(':')) {
        var parts = input.split(':');
        var mins = parseInt(parts[0]) || 0;
        var secsPart = parseInt(parts[1]) || 0;
        return (mins * 60 + secsPart) * 1000;
    }

    // Handle plain number (minutes)
    var numMins = parseInt(input);
    return isNaN(numMins) ? 0 : numMins * 60 * 1000;
}

export function startPomodoro(timeInput) {
    if (POMODORO.interval) clearInterval(POMODORO.interval);

    var duration = parseTime(timeInput);
    if (duration <= 0) duration = 25 * 60 * 1000;

    POMODORO.active = true;
    POMODORO.paused = false;
    POMODORO.endTime = Date.now() + duration;
    POMODORO.remaining = duration;
    POMODORO.originalDuration = duration;

    // V18.1: Persist to chrome.storage for cross-tab sync
    savePomodoroState();

    var container = document.getElementById('pomodoro-container');
    var pauseBtn = document.getElementById('pomodoro-pause');
    if (container) container.classList.add('active');
    if (pauseBtn) pauseBtn.textContent = 'PAUSE';

    updatePomodoroDisplay();
    POMODORO.interval = setInterval(updatePomodoroDisplay, 100);
}

// V18.1: Save Pomodoro state to chrome.storage for cross-tab sync
export function savePomodoroState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
            pomodoro: {
                active: POMODORO.active,
                paused: POMODORO.paused,
                endTime: POMODORO.endTime,
                remaining: POMODORO.remaining,
                originalDuration: POMODORO.originalDuration
            }
        });
    }
}

// V18.2: Load Pomodoro state from chrome.storage
export function loadPomodoroState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['pomodoro', 'pomodoroCompleted', 'pomodoroAcknowledged'], function (result) {
            // V18.2: Check if there's an unacknowledged completion
            if (result.pomodoroCompleted && !result.pomodoroAcknowledged) {
                if (window.ModalManager) window.ModalManager.open('pomodoro-complete-modal');
            }

            if (result.pomodoro && result.pomodoro.active) {
                var pomo = result.pomodoro;
                POMODORO.active = pomo.active;
                POMODORO.paused = pomo.paused;
                POMODORO.endTime = pomo.endTime;
                POMODORO.remaining = pomo.remaining;
                POMODORO.originalDuration = pomo.originalDuration;

                // Check if timer is still valid
                if (!POMODORO.paused && POMODORO.endTime <= Date.now()) {
                    // Timer already expired
                    stopPomodoro();
                    return;
                }

                // Resume the timer
                var container = document.getElementById('pomodoro-container');
                var pauseBtn = document.getElementById('pomodoro-pause');
                if (container) container.classList.add('active');
                if (pauseBtn) pauseBtn.textContent = POMODORO.paused ? 'RESUME' : 'PAUSE';

                updatePomodoroDisplay();
                if (POMODORO.interval) clearInterval(POMODORO.interval);
                POMODORO.interval = setInterval(updatePomodoroDisplay, 100);
            } else {
                if (POMODORO.active) stopPomodoro();
            }
        });
    }
}

export function updatePomodoroDisplay() {
    if (!POMODORO.active) return;

    var remaining;
    if (POMODORO.paused) {
        remaining = POMODORO.remaining;
    } else {
        remaining = POMODORO.endTime - Date.now();
    }

    if (remaining <= 0) {
        showPomodoroComplete();
        stopPomodoro();
        return;
    }

    var totalSecs = Math.ceil(remaining / 1000);
    var mins = Math.floor(totalSecs / 60);
    var secs = totalSecs % 60;
    var timeEl = document.getElementById('pomodoro-time');
    if (timeEl) {
        timeEl.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }
}

export function togglePomodoroPause() {
    if (!POMODORO.active) return;
    var pauseBtn = document.getElementById('pomodoro-pause');

    if (POMODORO.paused) {
        POMODORO.paused = false;
        POMODORO.endTime = Date.now() + POMODORO.remaining;
        if (pauseBtn) pauseBtn.textContent = 'PAUSE';
    } else {
        POMODORO.paused = true;
        POMODORO.remaining = POMODORO.endTime - Date.now();
        if (pauseBtn) pauseBtn.textContent = 'RESUME';
    }
    savePomodoroState(); // V18.1: Sync across tabs
}

export function stopPomodoro() {
    POMODORO.active = false;
    POMODORO.paused = false;
    if (POMODORO.interval) {
        clearInterval(POMODORO.interval);
        POMODORO.interval = null;
    }
    var container = document.getElementById('pomodoro-container');
    if (container) container.classList.remove('active');
    savePomodoroState(); // V18.1: Sync across tabs
}

// V61: High-fidelity HUD notification for Pomodoro
export function showPomodoroHUD() {
    var hud = document.getElementById('pomo-hud');
    var hudTime = document.getElementById('hud-time');
    if (!hud) return;

    if (hudTime) {
        var now = new Date();
        // 24h format for terminal feel
        hudTime.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    }

    hud.classList.add('active');

    // Auto-dismiss after 12 seconds
    setTimeout(function() {
        hud.classList.remove('active');
    }, 12000);
}

export function showPomodoroComplete() {
    play8BitSound();

    // V18.2: Mark as needing acknowledgment in storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pomodoroCompleted: true, pomodoroAcknowledged: false });
    }

    var durationEl = document.getElementById('pomo-complete-duration');
    var timeEl = document.getElementById('pomo-complete-time');

    if (durationEl) {
        var totalSecs = Math.floor(POMODORO.originalDuration / 1000);
        var mins = Math.floor(totalSecs / 60);
        var secs = totalSecs % 60;
        durationEl.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }

    if (timeEl) {
        var now = new Date();
        timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    if (window.ModalManager) window.ModalManager.open('pomodoro-complete-modal');

    if (window.showNotification) {
        window.showNotification('FOCUS SESSION COMPLETE', 'success');
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('FOCUS COMPLETE', {
            body: 'Operator: Session finished. Time for a break!',
            icon: State.DYNAMIC_ICON_URL || 'icon.png'
        });
    }

    // V61: Trigger specialized Vinland HUD
    showPomodoroHUD();
}

// V18.2: Acknowledge Pomodoro completion (syncs across tabs)
export function acknowledgePomodoroComplete() {
    if (window.ModalManager) window.ModalManager.close('pomodoro-complete-modal');

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pomodoroCompleted: false, pomodoroAcknowledged: true });
    }
}

export const Pomodoro = {
    init: loadPomodoroState,
    start: startPomodoro,
    stop: stopPomodoro,
    togglePause: togglePomodoroPause,
    acknowledgeComplete: acknowledgePomodoroComplete,
    state: POMODORO
};

