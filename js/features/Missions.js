import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { saveConfig } from '../core/Config.js';
import { safeText } from '../core/Utils.js';

// Helper for global notification
function getShowNotification() {
    return window.showNotification || function(msg) { console.log('Notify:', msg); };
}

export function renderMissions() {
    var list = document.getElementById('mission-list');
    var container = document.getElementById('mission-log');
    if (!list || !container) return;

    if (!State.TASKS || State.TASKS.length === 0) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    list.innerHTML = '';

    // V18.4: Filter out completed tasks if setting enabled
    var tasksToRender = State.TASKS;
    if (State.CONFIG.hide_completed_tasks) {
        tasksToRender = State.TASKS.filter(function (t) { return !t.completed; });
    }

    // V18.4: If all filtered out and hide enabled, show message
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

    // V18.0: Sort by priority (high first)
    var sortedTasks = tasksToRender.slice().sort(function (a, b) {
        var priorityOrder = { high: 0, medium: 1, normal: 2, low: 3 };
        var aPri = priorityOrder[a.priority] || 2;
        var bPri = priorityOrder[b.priority] || 2;
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

        // V18.0: Priority indicator
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

        // V18.0: Category badge
        if (task.category) {
            var catBadge = document.createElement('span');
            catBadge.className = 'category-badge';
            catBadge.textContent = '@' + task.category;
            div.appendChild(catBadge);
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
        category: category
    });

    saveData();
    renderMissions();
    updateProgressBar();
}

export function toggleTaskComplete(index) {
    if (State.TASKS[index]) {
        State.TASKS[index].completed = !State.TASKS[index].completed;
        saveData();
        renderMissions();
        updateProgressBar(); 
    }
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
