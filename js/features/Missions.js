import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { saveConfig } from '../core/Config.js';
import { safeText } from '../core/Utils.js';

// ─── DRAG STATE (module-level, persists across renders) ─────
var _draggedIndex = null;
var _completeAnimTimer = null;

// Helper for global notification
function getShowNotification() {
    return window.showNotification || function(msg) { console.log('Notify:', msg); };
}

export function renderMissions() {
    var list = document.getElementById('mission-list');
    var container = document.getElementById('mission-log');
    if (!list || !container) return;

    if (!State.TASKS || State.TASKS.length === 0) {
        container.classList.add('active');
        list.innerHTML = '<div class="empty-state-hint">' +
            '<div class="empty-state-title">NO ACTIVE MISSIONS</div>' +
            '<div class="empty-state-body">Type <code>task Buy groceries</code> in the command line below to add your first task.</div>' +
            '</div>';
        list.style.cursor = 'default';
        list.onclick = null;
        return;
    }

    container.classList.add('active');
    list.innerHTML = '';

    // .4: Filter out completed tasks if setting enabled
    var tasksToRender = State.TASKS;
    if (State.CONFIG.hide_completed_tasks) {
        tasksToRender = State.TASKS.filter(function (t) { return !t.completed; });
    }

    // .4: If all filtered out and hide enabled, show message
    if (tasksToRender.length === 0 && State.TASKS.length > 0) {
        list.innerHTML = '<div class="note-time" style="opacity:0.5">[' + State.TASKS.length + ' completed - click or use Settings to show]</div>';
        list.style.cursor = 'pointer';
        list.onclick = function () {
            State.CONFIG.hide_completed_tasks = false;
            saveConfig();
            renderMissions();
        };
        return;
    } else {
        list.style.cursor = 'default';
        list.onclick = null;
    }

    // .0: Sort by priority (high first)
    var sortedTasks = tasksToRender.slice().sort(function (a, b) {
        var priorityOrder = { high: 0, medium: 1, normal: 2, low: 3 };
        var aPri = priorityOrder[a.priority] ?? 2;
        var bPri = priorityOrder[b.priority] ?? 2;
        return aPri - bPri;
    });

    var fragment = document.createDocumentFragment();
    sortedTasks.forEach(function (task, i) {
        var originalIndex = State.TASKS.indexOf(task);
        var div = document.createElement('div');
        div.className = 'mission-item ' + (task.completed ? 'completed' : '');
        if (task.priority && task.priority !== 'normal') {
            div.classList.add('priority-' + task.priority);
        }

        // ── Grip handle for drag affordance ──
        var gripHandle = document.createElement('span');
        gripHandle.className = 'grip-handle';
        gripHandle.textContent = '⠿';
        gripHandle.title = 'Drag to reorder';
        div.appendChild(gripHandle);

        // ── Drag-to-reorder attributes ──
        div.draggable = true;
        div.setAttribute('data-task-index', originalIndex);

        // ── Drag event handlers ──
        div.addEventListener('dragstart', function (e) {
            _draggedIndex = parseInt(this.getAttribute('data-task-index'));
            e.dataTransfer.setData('text/plain', _draggedIndex);
            e.dataTransfer.effectAllowed = 'move';
            // Set drag ghost image to a semi-transparent clone
            if (e.dataTransfer.setDragImage) {
                var ghost = this.cloneNode(true);
                ghost.style.cssText = 'position:absolute;top:-9999px;opacity:0.6;background:rgba(0,0,0,0.8);border:1px solid var(--main-color);border-radius:4px;padding:4px 8px;transform:scale(0.95);';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 20, this.offsetHeight / 2);
                setTimeout(function() { ghost.remove(); }, 0);
            }
            this.classList.add('dragging');
        });

        div.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var rect = this.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            // Only show indicator if not dragging this item
            var isSelf = parseInt(this.getAttribute('data-task-index')) === _draggedIndex;
            this.classList.toggle('drop-before', !isSelf && e.clientY < midY);
            this.classList.toggle('drop-after', !isSelf && e.clientY >= midY);
        });

        div.addEventListener('dragleave', function () {
            this.classList.remove('drop-before', 'drop-after');
        });

        div.addEventListener('dragend', function () {
            document.querySelectorAll('.mission-item').forEach(function (el) {
                el.classList.remove('dragging', 'drop-before', 'drop-after');
            });
            _draggedIndex = null;
        });

        div.addEventListener('drop', function (e) {
            e.preventDefault();
            var fromIdx = _draggedIndex;
            var toIdx = parseInt(this.getAttribute('data-task-index'));
            var dropAfter = this.classList.contains('drop-after');

            document.querySelectorAll('.mission-item').forEach(function (el) {
                el.classList.remove('dragging', 'drop-before', 'drop-after');
            });
            _draggedIndex = null;

            if (fromIdx === null || fromIdx === toIdx) return;

            // Reorder State.TASKS: remove from old position, insert at new
            var task = State.TASKS.splice(fromIdx, 1)[0];
            var adjustedToIdx = (fromIdx < toIdx) ? toIdx - 1 : toIdx;
            if (dropAfter) adjustedToIdx++;
            adjustedToIdx = Math.max(0, Math.min(adjustedToIdx, State.TASKS.length));
            State.TASKS.splice(adjustedToIdx, 0, task);

            saveData();
            renderMissions();
        });

        // .0: Priority indicator
        var priorityIndicator = document.createElement('span');
        priorityIndicator.className = 'priority-indicator';
        if (task.priority === 'high') {
            priorityIndicator.textContent = '!! ';
            priorityIndicator.style.color = 'var(--danger-color)';
        } else if (task.priority === 'medium') {
            priorityIndicator.textContent = '! ';
            priorityIndicator.style.color = 'var(--warning-color)';
        } else if (task.priority === 'low') {
            priorityIndicator.textContent = '~ ';
            priorityIndicator.style.color = 'var(--secondary-color)';
        } else {
            priorityIndicator.textContent = '| ';
            priorityIndicator.style.color = 'var(--main-color)';
        }
        div.appendChild(priorityIndicator);

        var checkbox = document.createElement('span');
        checkbox.className = 'task-checkbox';
        checkbox.textContent = '[' + (task.completed ? 'x' : '\u00A0') + '] ';
        checkbox.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleTaskComplete(originalIndex);
        });
        div.appendChild(checkbox);

        if (task.time) {
            var timeSpan = document.createElement('span');
            timeSpan.className = 'mission-time';
            timeSpan.textContent = '[' + safeText(task.time) + '] ';
            div.appendChild(timeSpan);
        }

        var textSpan = document.createElement('span');
        textSpan.className = 'mission-text';
        textSpan.textContent = task.text;
        div.appendChild(textSpan);

        // .0: Category badge
        if (task.category) {
            var catBadge = document.createElement('span');
            catBadge.className = 'category-badge';
            catBadge.textContent = '@' + task.category;
            div.appendChild(catBadge);
        }

        // Recurrence badge (clickable — opens config panel)
        if (task.recurrence && task.recurrence !== 'none') {
            var recBadge = document.createElement('span');
            recBadge.className = 'rec-badge';
            var interval = task.recurrenceInterval || 1;
            var badgeText = '↻ ' + (interval > 1 ? interval : '') + (task.recurrence === 'daily' ? 'd' : task.recurrence === 'weekly' ? 'w' : 'm');
            recBadge.textContent = badgeText;
            recBadge.title = 'Recurring ' + (interval > 1 ? 'every ' + interval + ' ' : '') + task.recurrence + ' — click to configure';
            recBadge.style.cursor = 'pointer';
            recBadge.addEventListener('click', function(e) {
                e.stopPropagation();
                var originalIdx = parseInt(div.getAttribute('data-task-index'));
                _openRecurrenceConfig(originalIdx, recBadge);
            });
            div.appendChild(recBadge);
        }

        fragment.appendChild(div);
    });
    list.appendChild(fragment);

    updateProgressBar(); 
}

export function addTask(rawText, timeOverride) {
    if (!rawText || !rawText.trim()) return;
    var text = rawText.trim();
    var timeStart = text.indexOf('[');
    var timeEnd = text.indexOf(']');
    var time = timeOverride || '';
    if (timeStart !== -1 && timeEnd !== -1 && timeStart < timeEnd) {
        time = text.substring(timeStart + 1, timeEnd);
        text = text.substring(0, timeStart) + text.substring(timeEnd + 1);
        text = text.trim();
    }

    var priority = 'normal';
    if (text.startsWith('!!')) {
        priority = 'high';
        text = text.substring(2).trim();
    } else if (text.startsWith('!')) {
        priority = 'medium';
        text = text.substring(1).trim();
    } else if (text.startsWith('~')) {
        priority = 'low';
        text = text.substring(1).trim();
    }

    // Recurrence logic: parse +daily, +weekly, +monthly prefix
    var recurrence = 'none';
    var recMatch = text.match(/^\+(daily|weekly|monthly)\b/i);
    if (recMatch) {
        recurrence = recMatch[1];
        text = text.substring(recMatch[0].length).trim();
    }

    // Category logic
    var category = null;
    var catMatch = text.match(/@(\w+)/);
    if (catMatch) {
        category = catMatch[1];
        text = text.replace(catMatch[0], '').trim();
    }

    State.TASKS.push({
        text: text,
        completed: false,
        time: time,
        priority: priority,
        category: category,
        recurrence: recurrence,
        recurrence_created: new Date().toDateString()
    });

    saveData();
    renderMissions();
    updateProgressBar();
}

export function toggleTaskComplete(index) {
    if (!State.TASKS[index]) return;

    var task = State.TASKS[index];
    task.completed = !task.completed;

    // If completing a recurring task, auto-create the next instance
    if (task.completed && task.recurrence && task.recurrence !== 'none') {
        var nextDate = _getNextRecurrenceDate(task.recurrence);
        State.TASKS.push({
            text: task.text,
            completed: false,
            time: task.time,
            priority: task.priority,
            category: task.category,
            recurrence: task.recurrence,
            recurrence_created: nextDate.toDateString()
        });
    }

    saveData();

    // Animate the DOM element in-place (no full re-render during animation)
    var item = document.querySelector('.mission-item[data-task-index="' + index + '"]');
    if (item) {
        // Cancel any pending animation re-render
        if (_completeAnimTimer) {
            clearTimeout(_completeAnimTimer);
            _completeAnimTimer = null;
        }

        item.classList.toggle('completed');
        item.classList.remove('completing');

        // Force reflow so the animation restarts if re-toggling
        void item.offsetWidth;

        item.classList.add('completing');

        // Update checkbox text immediately for responsive feel
        var chk = item.querySelector('.task-checkbox');
        if (chk) {
            var nowCompleted = State.TASKS[index].completed;
            chk.textContent = '[' + (nowCompleted ? 'x' : '\u00A0') + '] ';
        }

        // Re-render after animation completes to sync any filters/ordering
        _completeAnimTimer = setTimeout(function () {
            _completeAnimTimer = null;
            renderMissions();
        }, 500);
    } else {
        // Fallback: immediate re-render
        renderMissions();
    }

    updateProgressBar();
}

export function clearCompletedTasks() {
    State.TASKS = State.TASKS.filter(function (t) { return !t.completed; });
    saveData();
    renderMissions();
}

export function updateProgressBar() {
    var progressBar = document.getElementById('progress-bar');
    var progressText = document.getElementById('progress-text');
    if (!progressBar || !progressText) return;

    if (!State.TASKS || State.TASKS.length === 0) {
        progressBar.style.width = '0%';
        progressText.textContent = 'NO TASKS';
        return;
    }

    var completed = State.TASKS.filter(function (t) { return t.completed; }).length;
    var total = State.TASKS.length;
    var percent = Math.round((completed / total) * 100);

    progressBar.style.width = percent + '%';
    progressText.textContent = completed + '/' + total + ' (' + percent + '%)';

    // Update streak if all tasks completed
    if (completed === total && total > 0) {
        updateStreak();
    }
}

export function updateStreak() {
    var today = new Date().toDateString();
    if (State.CONFIG.last_completion_date === today) return; // Already counted today

    State.CONFIG.streak_count = (State.CONFIG.streak_count || 0) + 1;
    State.CONFIG.last_completion_date = today;
    saveConfig();

    var saveBtn = document.getElementById('config-save-btn');
    if (saveBtn) {
        saveBtn.innerText = 'SAVE';
        saveBtn.style.color = '';
    }

    var streakEl = document.getElementById('streak-count');
    if (streakEl) {
        streakEl.textContent = State.CONFIG.streak_count;
        streakEl.classList.add('streak-pulse');
        setTimeout(function () { streakEl.classList.remove('streak-pulse'); }, 1000);
    }

    getShowNotification()('STREAK: ' + State.CONFIG.streak_count + ' DAYS! KEEP GOING!');
}

export function checkStreakReset() {
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (State.CONFIG.last_completion_date && State.CONFIG.last_completion_date !== today.toDateString()) {
        var lastDate = new Date(State.CONFIG.last_completion_date);
        if (lastDate < yesterday) {
            // Streak broken - reset
            State.CONFIG.streak_count = 0;
            saveConfig();
        }
    }

    var streakEl = document.getElementById('streak-count');
    if (streakEl) streakEl.textContent = State.CONFIG.streak_count || 0;
}

// ─── RECURRENCE HELPERS ──────────────────────────────────────

/**
 * Calculate the next occurrence date for a recurring task.
 * @param {string} recurrence - 'daily', 'weekly', or 'monthly'
 * @returns {Date} The next occurrence date
 */
export function _getNextRecurrenceDate(recurrence) {
    var now = new Date();
    switch (recurrence) {
        case 'daily':
            // Next occurrence is tomorrow
            var next = new Date(now);
            next.setDate(next.getDate() + 1);
            return next;
        case 'weekly':
            // Next occurrence is next week (same day of week)
            var next = new Date(now);
            next.setDate(next.getDate() + 7);
            return next;
        case 'monthly':
            // Next occurrence is next month (same day of month)
            var next = new Date(now);
            next.setMonth(next.getMonth() + 1);
            return next;
        default:
            return now;
    }
}

/**
 * Parse recurrence prefix from a raw task text string.
 * Extracted for unit testing.
 * @param {string} text - Raw task text
 * @returns {{ text: string, recurrence: string }} Parsed text and recurrence type
 */
export function parseRecurrence(text) {
    if (!text) return { text: '', recurrence: 'none' };
    var cleaned = text.trim();
    var recurrence = 'none';
    var recMatch = cleaned.match(/^\+(daily|weekly|monthly)\b/i);
    if (recMatch) {
        recurrence = recMatch[1];
        cleaned = cleaned.substring(recMatch[0].length).trim();
    }
    return { text: cleaned, recurrence: recurrence };
}

// ─── RECURRENCE CONFIG PANEL ────────────────────────────────

/**
 * Opens an inline config panel near a recurrence badge for editing interval/day settings.
 */
var _currentConfigTaskIdx = null;
var _currentConfigPanel = null;

function _closeRecurrenceConfig() {
    if (_currentConfigPanel) {
        _currentConfigPanel.remove();
        _currentConfigPanel = null;
    }
    _currentConfigTaskIdx = null;
}

export function _openRecurrenceConfig(taskIndex, badgeEl) {
    // Close any existing panel first
    _closeRecurrenceConfig();

    var task = State.TASKS[taskIndex];
    if (!task) return;

    _currentConfigTaskIdx = taskIndex;

    var recType = task.recurrence || 'daily';
    var interval = task.recurrenceInterval || 1;
    var days = task.recurrenceDays || [];

    var rect = badgeEl.getBoundingClientRect();
    // Estimate panel height (~180px) to prevent bottom-edge overflow
    var panelTop = rect.bottom + 6;
    if (panelTop + 180 > window.innerHeight) {
        panelTop = Math.max(4, rect.top - 180);
    }

    var panel = document.createElement('div');
    panel.className = 'rec-config-panel';
    panel.style.cssText = 'position:fixed;left:' + Math.min(rect.left, window.innerWidth - 260) + 'px;top:' + panelTop + 'px;z-index:50000;';

    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var dayChecks = dayNames.map(function(_, i) {
        return '<label class="rec-day-label"><input type="checkbox" class="rec-day-cb" value="' + i + '" ' +
            (days.indexOf(i) !== -1 ? 'checked' : '') + '>' + dayNames[i].substring(0, 2) + '</label>';
    }).join('');

    panel.innerHTML = '<div class="rec-config-header">RECURRENCE</div>' +
        '<div class="rec-config-row">' +
            '<label class="rec-config-label">Every</label>' +
            '<input type="number" class="rec-config-interval" value="' + interval + '" min="1" max="365">' +
            '<select class="rec-config-type">' +
                '<option value="daily"' + (recType === 'daily' ? ' selected' : '') + '>day(s)</option>' +
                '<option value="weekly"' + (recType === 'weekly' ? ' selected' : '') + '>week(s)</option>' +
                '<option value="monthly"' + (recType === 'monthly' ? ' selected' : '') + '>month(s)</option>' +
            '</select>' +
        '</div>' +
        '<div class="rec-config-days" id="rec-config-days"' +
            (recType !== 'weekly' ? ' style="display:none"' : '') + '>' +
            '<div class="rec-config-label" style="margin-bottom:4px">On</div>' +
            '<div class="rec-day-grid">' + dayChecks + '</div>' +
        '</div>' +
        '<div class="rec-config-actions">' +
            '<button class="rec-config-btn rec-config-cancel">CANCEL</button>' +
            '<button class="rec-config-btn rec-config-apply">APPLY</button>' +
        '</div>';

    document.body.appendChild(panel);
    _currentConfigPanel = panel;

    // Show/hide day checkboxes when type changes
    var typeSelect = panel.querySelector('.rec-config-type');
    var daysDiv = panel.querySelector('.rec-config-days');
    typeSelect.addEventListener('change', function() {
        daysDiv.style.display = typeSelect.value === 'weekly' ? '' : 'none';
    });

    // Cancel
    panel.querySelector('.rec-config-cancel').addEventListener('click', _closeRecurrenceConfig);

    // Apply
    panel.querySelector('.rec-config-apply').addEventListener('click', function() {
        var newType = typeSelect.value;
        var newInterval = parseInt(panel.querySelector('.rec-config-interval').value) || 1;
        var newDays = [];
        panel.querySelectorAll('.rec-day-cb:checked').forEach(function(cb) {
            newDays.push(parseInt(cb.value));
        });

        var targetTask = State.TASKS[_currentConfigTaskIdx];
        if (targetTask) {
            targetTask.recurrence = newType;
            targetTask.recurrenceInterval = newInterval;
            targetTask.recurrenceDays = newDays;
            saveData();
            renderMissions();
        }
        _closeRecurrenceConfig();

        getShowNotification()('Recurrence updated: every ' + (newInterval > 1 ? newInterval + ' ' : '') + newType);
    });

    // Close on Escape key
    var escHandler = function(e) {
        if (e.key === 'Escape') {
            _closeRecurrenceConfig();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Close on outside click
    setTimeout(function() {
        var closeHandler = function(e) {
            if (!panel.contains(e.target) && e.target !== badgeEl) {
                _closeRecurrenceConfig();
                document.removeEventListener('mousedown', closeHandler);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('mousedown', closeHandler);
    }, 10);
}
