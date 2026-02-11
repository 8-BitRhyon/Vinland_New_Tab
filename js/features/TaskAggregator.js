import { State } from '../core/Store.js';
import { Notes } from '../modules/NotesController.js';
import { PageManager } from '../editor/PageManager.js';

export const TaskAggregator = {
    active: false,

    getAllTasks: function () {
        var tasks = [];
        State.NOTES.forEach(function (note) {
            if (!note.blocks) return;
            note.blocks.forEach(function (block) {
                if (block.type === 'task') {
                    tasks.push({
                        blockId: block.id,
                        pageId: note.id,
                        pageTitle: note.title,
                        content: block.content,
                        checked: block.checked,
                        created: note.created,
                        completedAt: block.completedAt || null
                    });
                }
            });
        });

        // Sort: unchecked first, then by created date
        return tasks.sort(function (a, b) {
            if (a.checked !== b.checked) return a.checked ? 1 : -1;
            return b.created - a.created;
        });
    },

    toggle: function () {
        this.active = !this.active;
        var btn = document.getElementById('master-tasks-btn');
        if (btn) btn.classList.toggle('active', this.active);

        if (this.active) {
            this.render();
        } else {
            if (Notes.activeNoteId) Notes.open(Notes.activeNoteId);
        }
    },

    render: function () {
        var container = document.getElementById('block-editor');
        if (!container) return;

        container.innerHTML = '<div class="aggregator-header">Task Manager</div>';
        
        var tasks = this.getAllTasks();
        if (tasks.length === 0) {
            container.innerHTML += '<div class="no-tasks">NO_ACTIVE_THREADS_FOUND_IN_WORKSPACE.</div>';
            return;
        }

        var self = this;
        var currentSection = '';

        tasks.forEach(function (task) {
            if (task.pageTitle !== currentSection) {
                currentSection = task.pageTitle;
                var header = document.createElement('div');
                header.className = 'task-agg-section-header';
                header.textContent = currentSection.toUpperCase();
                header.onclick = function() { self.active = false; Notes.open(task.pageId); };
                container.appendChild(header);
            }

            var item = document.createElement('div');
            item.className = 'task-agg-item' + (task.checked ? ' completed' : '');
            
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.checked;
            checkbox.className = 'task-checkbox-inline';
            checkbox.onchange = function() {
                PageManager.updateBlock(task.pageId, task.blockId, { checked: checkbox.checked, completedAt: checkbox.checked ? Date.now() : null }); 
                PageManager.syncContent(task.pageId);
                item.classList.toggle('completed', checkbox.checked);
            };

            var labelWrapper = document.createElement('div');
            labelWrapper.style.flex = '1';

            var label = document.createElement('div');
            label.textContent = task.content || '(Empty Task)';
            label.className = 'task-text';
            if (!task.content) label.style.color = 'var(--dim-color)';
            
            var meta = document.createElement('div');
            meta.className = 'task-card-meta';
            meta.style.color = 'var(--secondary-color)';
            meta.style.fontSize = '0.65rem';
            
            var createdStr = task.created ? new Date(task.created).toLocaleDateString() : 'UNKNOWN';
            var metaText = 'Created: ' + createdStr;
            if (task.checked && task.completedAt) {
                metaText += ' | Completed: ' + new Date(task.completedAt).toLocaleDateString();
            }
            meta.textContent = metaText;

            labelWrapper.appendChild(label);
            labelWrapper.appendChild(meta);

            item.appendChild(checkbox);
            item.appendChild(labelWrapper);
            container.appendChild(item);
        });

        // Disable contenteditable for this view
        container.contentEditable = 'false';
    }
};
