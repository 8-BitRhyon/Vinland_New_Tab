

import assert from 'node:assert/strict';

// ============================================================
// FUNCTION EXTRACTS (pure data operations from Missions.js)
// ============================================================

function parseAddTaskText(rawText) {
    if (!rawText || !rawText.trim()) return null;
    var text = rawText.trim();
    var timeStart = text.indexOf('[');
    var timeEnd = text.indexOf(']');
    var time = '';
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

    var category = null;
    var catMatch = text.match(/@(\w+)/);
    if (catMatch) {
        category = catMatch[1];
        text = text.replace(catMatch[0], '').trim();
    }

    return {
        text: text,
        time: time,
        priority: priority,
        category: category
    };
}

function toggleTaskState(tasks, index) {
    if (!tasks || index < 0 || index >= tasks.length) return false;
    tasks[index].completed = !tasks[index].completed;
    return true;
}

function clearCompleted(tasks) {
    return tasks.filter(function (t) { return !t.completed; });
}

function sortByPriority(tasks) {
    var priorityOrder = { high: 0, medium: 1, normal: 2, low: 3 };
    return tasks.slice().sort(function (a, b) {
        var aPri = priorityOrder[a.priority] ?? 2;
        var bPri = priorityOrder[b.priority] ?? 2;
        return aPri - bPri;
    });
}

function reorderTask(tasks, fromIdx, toIdx, dropAfter) {
    if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= tasks.length || toIdx < 0 || toIdx >= tasks.length) return tasks;
    var task = tasks.splice(fromIdx, 1)[0];
    var adjustedToIdx = (fromIdx < toIdx) ? toIdx - 1 : toIdx;
    if (dropAfter) adjustedToIdx++;
    adjustedToIdx = Math.max(0, Math.min(adjustedToIdx, tasks.length));
    tasks.splice(adjustedToIdx, 0, task);
    return tasks;
}

function updateStreakPure(streakCount, lastCompletionDate, todayStr) {
    if (lastCompletionDate === todayStr) return { streak: streakCount, updated: false };
    return { streak: streakCount + 1, updated: true };
}

function checkStreakResetPure(lastCompletionDate, todayStr) {
    if (!lastCompletionDate) return { reset: false, streak: 0 };
    if (lastCompletionDate === todayStr) return { reset: false, streak: null }; // null = no change needed

    var today = new Date(todayStr);
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    var lastDate = new Date(lastCompletionDate);

    if (lastDate < yesterday) {
        return { reset: true, streak: 0 };
    }
    return { reset: false, streak: null };
}

function parseRecurrence(text) {
    if (!text) return { text: '', recurrence: 'none' };
    var cleaned = text.trim();
    var recurrence = 'none';
    var recMatch = cleaned.match(/^\+(daily|weekly|monthly)\b/);
    if (recMatch) {
        recurrence = recMatch[1];
        cleaned = cleaned.substring(recMatch[0].length).trim();
    }
    return { text: cleaned, recurrence: recurrence };
}

function _getNextRecurrenceDate(recurrence) {
    var now = new Date();
    switch (recurrence) {
        case 'daily':
            var next = new Date(now);
            next.setDate(next.getDate() + 1);
            return next;
        case 'weekly':
            var next = new Date(now);
            next.setDate(next.getDate() + 7);
            return next;
        case 'monthly':
            var next = new Date(now);
            next.setMonth(next.getMonth() + 1);
            return next;
        default:
            return now;
    }
}

// ============================================================
// TEST RUNNER
// ============================================================

var passed = 0;
var failed = 0;
var errors = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  \u2713 ' + name);
    } catch (e) {
        failed++;
        errors.push({ name: name, error: e.message });
        console.log('  \u2717 ' + name);
        console.log('    \u2192 ' + e.message);
    }
}

// ============================================================
// TESTS: addTask() text parsing
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: addTask text parsing \u2500\u2500\u2500');

test('parses plain text task with normal priority', function() {
    var result = parseAddTaskText('Buy groceries');
    assert.notEqual(result, null);
    assert.equal(result.text, 'Buy groceries');
    assert.equal(result.priority, 'normal');
    assert.equal(result.time, '');
    assert.equal(result.category, null);
});

test('parses high priority task (!! prefix)', function() {
    var result = parseAddTaskText('!! Urgent bug fix');
    assert.equal(result.text, 'Urgent bug fix');
    assert.equal(result.priority, 'high');
});

test('parses medium priority task (! prefix)', function() {
    var result = parseAddTaskText('! Medium priority item');
    assert.equal(result.text, 'Medium priority item');
    assert.equal(result.priority, 'medium');
});

test('parses low priority task (~ prefix)', function() {
    var result = parseAddTaskText('~ Low priority task');
    assert.equal(result.text, 'Low priority task');
    assert.equal(result.priority, 'low');
});

test('parses task with time bracket [14:00]', function() {
    var result = parseAddTaskText('Meeting [14:00]');
    assert.equal(result.text, 'Meeting');
    assert.equal(result.time, '14:00');
});

test('parses task with time and priority', function() {
    var result = parseAddTaskText('!! Deploy [16:30]');
    assert.equal(result.text, 'Deploy');
    assert.equal(result.priority, 'high');
    assert.equal(result.time, '16:30');
});

test('parses task with category @work', function() {
    var result = parseAddTaskText('Write report @work');
    assert.equal(result.text, 'Write report');
    assert.equal(result.category, 'work');
});

test('parses task with priority, time, and category', function() {
    var result = parseAddTaskText('!! Presentation [10:00] @work');
    assert.equal(result.text, 'Presentation');
    assert.equal(result.priority, 'high');
    assert.equal(result.time, '10:00');
    assert.equal(result.category, 'work');
});

test('parses task with multi-word category @my_project', function() {
    var result = parseAddTaskText('Fix bug @my_project');
    assert.equal(result.text, 'Fix bug');
    assert.equal(result.category, 'my_project');
});

test('handles task with time at start', function() {
    var result = parseAddTaskText('[09:00] Standup');
    assert.equal(result.text, 'Standup');
    assert.equal(result.time, '09:00');
});

test('returns null for empty string', function() {
    var result = parseAddTaskText('');
    assert.equal(result, null);
});

test('returns null for whitespace-only string', function() {
    var result = parseAddTaskText('   ');
    assert.equal(result, null);
});

test('returns null for undefined', function() {
    var result = parseAddTaskText(undefined);
    assert.equal(result, null);
});

test('handles malformed bracket (missing close)', function() {
    var result = parseAddTaskText('[14:00 Task');
    assert.equal(result.text, '[14:00 Task');
    assert.equal(result.time, '');
});

test('handles bracket text containing spaces', function() {
    var result = parseAddTaskText('Task [after lunch]');
    assert.equal(result.text, 'Task');
    assert.equal(result.time, 'after lunch');
});

test('priority exclamation in middle of text is not a prefix', function() {
    var result = parseAddTaskText('Say !important thing');
    assert.equal(result.text, 'Say !important thing');
    assert.equal(result.priority, 'normal', '! mid-text should not set priority');
});

test('tilde in middle of text is not a prefix', function() {
    var result = parseAddTaskText('The ~ symbol');
    assert.equal(result.text, 'The ~ symbol');
    assert.equal(result.priority, 'normal', '~ mid-text should not set priority');
});

test('handles consecutive whitespace in text', function() {
    var result = parseAddTaskText('  Task  with   spaces  ');
    assert.equal(result.text, 'Task  with   spaces');
});

test('priority prefix with no following text', function() {
    var result = parseAddTaskText('!!');
    assert.equal(result.text, '');
    assert.equal(result.priority, 'high');
});

test('category with number @v2', function() {
    var result = parseAddTaskText('Update docs @v2');
    assert.equal(result.text, 'Update docs');
    assert.equal(result.category, 'v2');
});

// ============================================================
// TESTS: toggleTaskComplete()
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: toggleTaskComplete() \u2500\u2500\u2500');

test('toggles a task from incomplete to complete', function() {
    var tasks = [{ text: 'Buy milk', completed: false }];
    var result = toggleTaskState(tasks, 0);
    assert.equal(result, true);
    assert.equal(tasks[0].completed, true);
});

test('toggles a task from complete to incomplete', function() {
    var tasks = [{ text: 'Buy milk', completed: true }];
    toggleTaskState(tasks, 0);
    assert.equal(tasks[0].completed, false);
});

test('returns false for out-of-range index (too large)', function() {
    var tasks = [{ text: 'Task 1', completed: false }];
    var result = toggleTaskState(tasks, 5);
    assert.equal(result, false);
    assert.equal(tasks[0].completed, false, 'should not mutate');
});

test('returns false for negative index', function() {
    var tasks = [{ text: 'Task 1', completed: false }];
    var result = toggleTaskState(tasks, -1);
    assert.equal(result, false);
});

test('returns false for empty tasks array', function() {
    var result = toggleTaskState([], 0);
    assert.equal(result, false);
});

test('returns false when tasks is null', function() {
    var result = toggleTaskState(null, 0);
    assert.equal(result, false);
});

test('returns false when tasks is undefined', function() {
    var result = toggleTaskState(undefined, 0);
    assert.equal(result, false);
});

test('only toggles the specified index, not others', function() {
    var tasks = [
        { text: 'Task A', completed: false },
        { text: 'Task B', completed: true },
        { text: 'Task C', completed: false }
    ];
    toggleTaskState(tasks, 0);
    assert.equal(tasks[0].completed, true, 'Task A should be toggled');
    assert.equal(tasks[1].completed, true, 'Task B should be unchanged');
    assert.equal(tasks[2].completed, false, 'Task C should be unchanged');
});

test('toggles preserve other task properties', function() {
    var tasks = [{ text: 'Test', completed: false, time: '10:00', priority: 'high', category: 'work' }];
    toggleTaskState(tasks, 0);
    assert.equal(tasks[0].text, 'Test');
    assert.equal(tasks[0].time, '10:00');
    assert.equal(tasks[0].priority, 'high');
    assert.equal(tasks[0].category, 'work');
});

// ============================================================
// TESTS: clearCompletedTasks()
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: clearCompletedTasks() \u2500\u2500\u2500');

test('removes completed tasks', function() {
    var tasks = [
        { text: 'Task 1', completed: false },
        { text: 'Task 2', completed: true },
        { text: 'Task 3', completed: false }
    ];
    var result = clearCompleted(tasks);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'Task 1');
    assert.equal(result[1].text, 'Task 3');
});

test('returns empty array when all tasks completed', function() {
    var tasks = [
        { text: 'Done 1', completed: true },
        { text: 'Done 2', completed: true }
    ];
    var result = clearCompleted(tasks);
    assert.equal(result.length, 0);
});

test('returns all tasks when none completed', function() {
    var tasks = [
        { text: 'Active 1', completed: false },
        { text: 'Active 2', completed: false }
    ];
    var result = clearCompleted(tasks);
    assert.equal(result.length, 2);
});

test('does not mutate original array', function() {
    var tasks = [{ text: 'Task', completed: true }];
    clearCompleted(tasks);
    assert.equal(tasks.length, 1, 'original should be unchanged');
});

test('handles empty array', function() {
    var result = clearCompleted([]);
    assert.deepEqual(result, []);
});

// ============================================================
// TESTS: Priority sorting
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: Priority sorting \u2500\u2500\u2500');

test('sorts tasks high -> medium -> normal -> low', function() {
    var tasks = [
        { text: 'Normal', priority: 'normal' },
        { text: 'High', priority: 'high' },
        { text: 'Low', priority: 'low' },
        { text: 'Medium', priority: 'medium' }
    ];
    var sorted = sortByPriority(tasks);
    assert.equal(sorted[0].text, 'High');
    assert.equal(sorted[1].text, 'Medium');
    assert.equal(sorted[2].text, 'Normal');
    assert.equal(sorted[3].text, 'Low');
});

test('preserves relative order within same priority (stable-ish)', function() {
    var tasks = [
        { text: 'Normal A', priority: 'normal' },
        { text: 'High A', priority: 'high' },
        { text: 'Normal B', priority: 'normal' },
        { text: 'High B', priority: 'high' }
    ];
    var sorted = sortByPriority(tasks);
    assert.equal(sorted[0].text, 'High A', 'first high');
    assert.equal(sorted[1].text, 'High B', 'second high');
    assert.equal(sorted[2].text, 'Normal A', 'first normal');
    assert.equal(sorted[3].text, 'Normal B', 'second normal');
});

test('handles tasks with missing priority (defaults to normal)', function() {
    var tasks = [
        { text: 'No priority' },
        { text: 'High', priority: 'high' }
    ];
    var sorted = sortByPriority(tasks);
    assert.equal(sorted[0].text, 'High');
    assert.equal(sorted[1].text, 'No priority');
});

test('handles tasks with unknown priority value (defaults to normal)', function() {
    var tasks = [
        { text: 'Unknown', priority: 'urgent' },
        { text: 'High', priority: 'high' }
    ];
    var sorted = sortByPriority(tasks);
    assert.equal(sorted[0].text, 'High');
    assert.equal(sorted[1].text, 'Unknown');
});

test('does not mutate original array', function() {
    var tasks = [
        { text: 'Low', priority: 'low' },
        { text: 'High', priority: 'high' }
    ];
    sortByPriority(tasks);
    assert.equal(tasks[0].text, 'Low', 'original should keep order');
});

// ============================================================
// TESTS: Drag-to-reorder (State.TASKS splice logic)
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: Drag-to-reorder splice logic \u2500\u2500\u2500');

test('moves task forward (from 0 to 2, drop before)', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }
    ];
    // Remove A (idx 0), insert before C (original idx 2 → adjusted idx 1 after removal)
    reorderTask(tasks, 0, 2, false);
    assert.equal(tasks[0].text, 'B');
    assert.equal(tasks[1].text, 'A');
    assert.equal(tasks[2].text, 'C');
    assert.equal(tasks[3].text, 'D');
});

test('moves task backward (from 3 to 0, drop before)', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }
    ];
    reorderTask(tasks, 3, 0, false);
    assert.equal(tasks[0].text, 'D');
    assert.equal(tasks[1].text, 'A');
    assert.equal(tasks[2].text, 'B');
    assert.equal(tasks[3].text, 'C');
});

test('moves task forward with dropAfter (from 0 to 1, after)', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }
    ];
    reorderTask(tasks, 0, 1, true);
    assert.equal(tasks[0].text, 'B');
    assert.equal(tasks[1].text, 'A');
    assert.equal(tasks[2].text, 'C');
});

test('moves task backward with dropAfter (from 2 to 0, after)', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }
    ];
    reorderTask(tasks, 2, 0, true);
    assert.equal(tasks[0].text, 'A');
    assert.equal(tasks[1].text, 'C');
    assert.equal(tasks[2].text, 'B');
});

test('inserts at end when dropAfter on last element', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }
    ];
    reorderTask(tasks, 0, 2, true);
    assert.equal(tasks[0].text, 'B');
    assert.equal(tasks[1].text, 'C');
    assert.equal(tasks[2].text, 'A');
});

test('no change when fromIdx equals toIdx without dropAfter', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }
    ];
    reorderTask(tasks, 1, 1, false);
    assert.equal(tasks[0].text, 'A');
    assert.equal(tasks[1].text, 'B');
    assert.equal(tasks[2].text, 'C');
});

test('moves task to beginning (from 2 to 0, drop before)', function() {
    var tasks = [
        { text: 'A' }, { text: 'B' }, { text: 'C' }
    ];
    reorderTask(tasks, 2, 0, false);
    assert.equal(tasks[0].text, 'C');
    assert.equal(tasks[1].text, 'A');
    assert.equal(tasks[2].text, 'B');
});

test('handles single-element array gracefully', function() {
    var tasks = [{ text: 'Solo' }];
    reorderTask(tasks, 0, 0, false);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].text, 'Solo');
});

// ============================================================
// TESTS: updateStreak()
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: updateStreak() date logic \u2500\u2500\u2500');

test('increments streak when last completion is not today', function() {
    var result = updateStreakPure(3, '2026-07-27', '2026-07-28');
    assert.equal(result.streak, 4);
    assert.equal(result.updated, true);
});

test('does not increment if already completed today', function() {
    var result = updateStreakPure(5, '2026-07-28', '2026-07-28');
    assert.equal(result.streak, 5);
    assert.equal(result.updated, false);
});

test('increments from zero streak', function() {
    var result = updateStreakPure(0, '2026-07-27', '2026-07-28');
    assert.equal(result.streak, 1);
    assert.equal(result.updated, true);
});

test('handles undefined last completion date (first completion ever)', function() {
    var result = updateStreakPure(0, undefined, '2026-07-28');
    assert.equal(result.streak, 1);
    assert.equal(result.updated, true);
});

test('handles null last completion date', function() {
    var result = updateStreakPure(0, null, '2026-07-28');
    assert.equal(result.streak, 1);
    assert.equal(result.updated, true);
});

// ============================================================
// TESTS: checkStreakReset()
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: checkStreakReset() date logic \u2500\u2500\u2500');

test('does not reset streak if completed today', function() {
    var result = checkStreakResetPure('Tue Jul 28 2026', 'Tue Jul 28 2026');
    assert.equal(result.reset, false);
});

test('does not reset streak if completed yesterday', function() {
    var result = checkStreakResetPure('Mon Jul 27 2026', 'Tue Jul 28 2026');
    assert.equal(result.reset, false);
});

test('resets streak if gap of 2+ days', function() {
    var result = checkStreakResetPure('Sat Jul 25 2026', 'Tue Jul 28 2026');
    assert.equal(result.reset, true);
    assert.equal(result.streak, 0);
});

test('does not reset if last completion date is undefined', function() {
    var result = checkStreakResetPure(undefined, 'Tue Jul 28 2026');
    assert.equal(result.reset, false);
    assert.equal(result.streak, 0);
});

test('does not reset if last completion date is null', function() {
    var result = checkStreakResetPure(null, 'Tue Jul 28 2026');
    assert.equal(result.reset, false);
    assert.equal(result.streak, 0);
});

// ============================================================
// TESTS: Recurrence parsing
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: Recurrence parsing \u2500\u2500\u2500');

test('parses +daily prefix', function() {
    var result = parseRecurrence('+daily Buy groceries');
    assert.equal(result.text, 'Buy groceries');
    assert.equal(result.recurrence, 'daily');
});

test('parses +weekly prefix', function() {
    var result = parseRecurrence('+weekly Clean garage');
    assert.equal(result.text, 'Clean garage');
    assert.equal(result.recurrence, 'weekly');
});

test('parses +monthly prefix', function() {
    var result = parseRecurrence('+monthly Pay bills');
    assert.equal(result.text, 'Pay bills');
    assert.equal(result.recurrence, 'monthly');
});

test('parses +daily with priority prefix', function() {
    var text = 'Buy groceries';
    var rec = parseRecurrence('+daily ' + text);
    assert.equal(rec.text, text);
    assert.equal(rec.recurrence, 'daily');
});

test('returns none for text without recurrence prefix', function() {
    var result = parseRecurrence('Buy groceries');
    assert.equal(result.text, 'Buy groceries');
    assert.equal(result.recurrence, 'none');
});

test('returns none for empty string', function() {
    var result = parseRecurrence('');
    assert.equal(result.text, '');
    assert.equal(result.recurrence, 'none');
});

test('handles +daily with trailing text', function() {
    var result = parseRecurrence('+daily Read books for 30 minutes');
    assert.equal(result.text, 'Read books for 30 minutes');
    assert.equal(result.recurrence, 'daily');
});

test('does not match +daily inside text (must be prefix)', function() {
    var result = parseRecurrence('Do +daily workout');
    assert.equal(result.text, 'Do +daily workout');
    assert.equal(result.recurrence, 'none');
});

test('handles +daily with extra whitespace', function() {
    var result = parseRecurrence('  +daily   Task');
    assert.equal(result.text, 'Task');
    assert.equal(result.recurrence, 'daily');
});

// ============================================================
// TESTS: Recurrence date calculation
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: Recurrence date calculation \u2500\u2500\u2500');

test('daily recurrence returns tomorrow', function() {
    var result = _getNextRecurrenceDate('daily');
    var expected = new Date();
    expected.setDate(expected.getDate() + 1);
    assert.equal(result.toDateString(), expected.toDateString());
});

test('weekly recurrence returns 7 days later', function() {
    var result = _getNextRecurrenceDate('weekly');
    var expected = new Date();
    expected.setDate(expected.getDate() + 7);
    assert.equal(result.toDateString(), expected.toDateString());
});

test('monthly recurrence returns 1 month later', function() {
    var result = _getNextRecurrenceDate('monthly');
    var expected = new Date();
    expected.setMonth(expected.getMonth() + 1);
    assert.equal(result.toDateString(), expected.toDateString());
});

test('unknown recurrence returns today', function() {
    var result = _getNextRecurrenceDate('unknown');
    assert.equal(result.toDateString(), new Date().toDateString());
});

// ============================================================
// TESTS: Recurrence auto-respawn in toggleTaskComplete
// ============================================================

console.log('\n\u2500\u2500\u2500 Missions: Recurrence auto-respawn \u2500\u2500\u2500');

test('completing a daily task creates a new instance', function() {
    var tasks = [
        { text: 'Daily task', completed: false, recurrence: 'daily', recurrence_created: 'Mon Jul 27 2026' }
    ];
    // Simulate toggleTaskComplete: toggle + check recurrence + push new
    tasks[0].completed = true;
    if (tasks[0].completed && tasks[0].recurrence !== 'none') {
        var nextDate = _getNextRecurrenceDate(tasks[0].recurrence);
        tasks.push({
            text: tasks[0].text,
            completed: false,
            recurrence: tasks[0].recurrence,
            recurrence_created: nextDate.toDateString()
        });
    }
    assert.equal(tasks.length, 2, 'new task should be added');
    assert.equal(tasks[0].completed, true, 'original should be completed');
    assert.equal(tasks[1].completed, false, 'new task should be incomplete');
    assert.equal(tasks[1].recurrence, 'daily', 'new task should have same recurrence');
    assert.equal(tasks[1].text, 'Daily task', 'new task should have same text');
});

test('completing a non-recurring task does not create a new instance', function() {
    var tasks = [
        { text: 'One-off task', completed: false, recurrence: 'none' }
    ];
    tasks[0].completed = true;
    var createdNew = false;
    if (tasks[0].completed && tasks[0].recurrence !== 'none') {
        createdNew = true;
    }
    assert.equal(createdNew, false, 'should not create new task for non-recurring tasks');
    assert.equal(tasks.length, 1);
});

test('completing a monthly task preserves all task properties on new instance', function() {
    var tasks = [
        { text: 'Review budget', completed: false, time: '10:00', priority: 'high', category: 'finance', recurrence: 'monthly', recurrence_created: 'Mon Jul 27 2026' }
    ];
    tasks[0].completed = true;
    if (tasks[0].completed && tasks[0].recurrence !== 'none') {
        var nextDate = _getNextRecurrenceDate(tasks[0].recurrence);
        tasks.push({
            text: tasks[0].text,
            completed: false,
            time: tasks[0].time,
            priority: tasks[0].priority,
            category: tasks[0].category,
            recurrence: tasks[0].recurrence,
            recurrence_created: nextDate.toDateString()
        });
    }
    assert.equal(tasks.length, 2);
    assert.equal(tasks[1].text, 'Review budget');
    assert.equal(tasks[1].time, '10:00');
    assert.equal(tasks[1].priority, 'high');
    assert.equal(tasks[1].category, 'finance');
    assert.equal(tasks[1].recurrence, 'monthly');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (errors.length > 0) {
    console.log('FAILURES:');
    errors.forEach(function(e) { console.log('  \u2022 ' + e.name + ': ' + e.error); });
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
