

import { State } from '../core/Store.js';

export const Calendar = {
    isOpen: false,
    currentYear: 0,
    currentMonth: 0, // 0-indexed (0 = January)
    selectedDay: null,
    selectedDayNotes: [],
    showNotePicker: false,

    
    init: function () {
        var now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
        this._injectDOM();
    },

    
    open: function () {
        if (this.isOpen) return;
        this.isOpen = true;

        var now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
        this.selectedDay = null;
        this.selectedDayNotes = [];
        this.showNotePicker = false;

        var overlay = document.getElementById('calendar-overlay');
        var modal = document.getElementById('calendar-modal');
        if (!overlay || !modal) return;

        overlay.classList.add('active');
        modal.classList.add('active');

        this._render();
        this._bindEvents();
    },

    
    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;

        var overlay = document.getElementById('calendar-overlay');
        var modal = document.getElementById('calendar-modal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');

        this._unbindEvents();
        this.selectedDay = null;
        this.selectedDayNotes = [];
        this.showNotePicker = false;
    },

    
    prevMonth: function () {
        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.selectedDay = null;
        this.selectedDayNotes = [];
        this.showNotePicker = false;
        this._render();
    },

    
    nextMonth: function () {
        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.selectedDay = null;
        this.selectedDayNotes = [];
        this.showNotePicker = false;
        this._render();
    },

    
    goToToday: function () {
        var now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
        this.selectedDay = null;
        this.selectedDayNotes = [];
        this.showNotePicker = false;
        this._render();
    },

    // ─── Private Methods ─────────────────────────────────────────

    
    _injectDOM: function () {
        if (document.getElementById('calendar-overlay')) return;

        // Overlay backdrop
        var overlay = document.createElement('div');
        overlay.id = 'calendar-overlay';
        overlay.className = 'calendar-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Main modal container
        var modal = document.createElement('div');
        modal.id = 'calendar-modal';
        modal.className = 'calendar-modal';

        var html =
            // Header
            '<div class="calendar-header">' +
                '<button class="calendar-nav-btn" id="calendar-prev-btn" title="Previous month">&larr;</button>' +
                '<span class="calendar-title" id="calendar-title"></span>' +
                '<button class="calendar-nav-btn" id="calendar-next-btn" title="Next month">&rarr;</button>' +
                '<button class="calendar-today-btn" id="calendar-today-btn">TODAY</button>' +
            '</div>' +
            // Day-of-week header
            '<div class="calendar-dow-row">' +
                '<span class="calendar-dow">Mon</span>' +
                '<span class="calendar-dow">Tue</span>' +
                '<span class="calendar-dow">Wed</span>' +
                '<span class="calendar-dow">Thu</span>' +
                '<span class="calendar-dow">Fri</span>' +
                '<span class="calendar-dow">Sat</span>' +
                '<span class="calendar-dow">Sun</span>' +
            '</div>' +
            // Day grid
            '<div class="calendar-grid" id="calendar-grid"></div>' +
            // Note picker (hidden by default)
            '<div class="calendar-note-picker" id="calendar-note-picker" style="display:none">' +
                '<div class="calendar-picker-header">' +
                    '<span class="calendar-picker-title" id="calendar-picker-title"></span>' +
                    '<button class="calendar-picker-close" id="calendar-picker-close">&times;</button>' +
                '</div>' +
                '<div class="calendar-picker-list" id="calendar-picker-list"></div>' +
            '</div>' +
            // Footer
            '<div class="calendar-footer">' +
                '<span class="calendar-footer-hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> months  <kbd>Enter</kbd> open note  <kbd>Esc</kbd> close</span>' +
                '<span class="calendar-footer-count" id="calendar-footer-count"></span>' +
            '</div>';

        modal.innerHTML = html;
        document.body.appendChild(modal);

        // Bind static button handlers
        document.getElementById('calendar-prev-btn').onclick = this.prevMonth.bind(this);
        document.getElementById('calendar-next-btn').onclick = this.nextMonth.bind(this);
        document.getElementById('calendar-today-btn').onclick = this.goToToday.bind(this);
        document.getElementById('calendar-picker-close').onclick = this._closeNotePicker.bind(this);
    },

    
    _getNotesByDate: function () {
        var byDate = {};
        var notes = State.NOTES || [];

        notes.forEach(function (note) {
            // Skip trashed notes and canvas notes
            if (note.path && note.path.indexOf('/.trash') === 0) return;
            if (note.type === 'canvas') return;

            var dates = [];
            var title = note.title || '';

            // 1. Check title for date patterns: "Daily Log YYYY-MM-DD" or "YYYY-MM-DD"
            var titleDateMatch = title.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (titleDateMatch) {
                dates.push(titleDateMatch[1] + '-' + titleDateMatch[2] + '-' + titleDateMatch[3]);
            }

            // 2. Check frontmatter date (via MetadataCache if available)
            if (window.MetadataCache) {
                var meta = window.MetadataCache.get(note.id);
                if (meta && meta.frontmatter && meta.frontmatter.date) {
                    var fmDate = meta.frontmatter.date;
                    if (typeof fmDate === 'string' && fmDate.match(/^\d{4}-\d{2}-\d{2}/)) {
                        dates.push(fmDate.substring(0, 10));
                    }
                }
            }

            // 3. Fallback: use created date
            if (dates.length === 0 && note.created) {
                var d = new Date(note.created);
                var y = d.getFullYear();
                var m = String(d.getMonth() + 1).padStart(2, '0');
                 var day = String(d.getDate()).padStart(2, '0');
                dates.push(y + '-' + m + '-' + day);
            }

            dates.forEach(function (dateStr) {
                if (!byDate[dateStr]) byDate[dateStr] = [];
                byDate[dateStr].push(note);
            });
        });

        return byDate;
    },

    
    _render: function () {
        var titleEl = document.getElementById('calendar-title');
        var gridEl = document.getElementById('calendar-grid');
        var footerEl = document.getElementById('calendar-footer-count');
        if (!titleEl || !gridEl) return;

        // Update title
        var monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        titleEl.textContent = monthNames[this.currentMonth] + ' ' + this.currentYear;

        // Get notes indexed by date
        var notesByDate = this._getNotesByDate();
        var totalDatedNotes = Object.keys(notesByDate).length;

        // Calculate calendar grid
        var firstDay = new Date(this.currentYear, this.currentMonth, 1);
        var lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        var daysInMonth = lastDay.getDate();

        // Adjust for ISO weekday (Monday = 0, Sunday = 6)
        var startDow = (firstDay.getDay() + 6) % 7; // Monday = 0

        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        var self = this;

        // Build grid rows
        var gridHtml = '';
        var dayNum = 1;
        var started = false;

        // We need up to 6 rows (42 cells)
        for (var row = 0; row < 6; row++) {
            gridHtml += '<div class="calendar-row">';
            for (var col = 0; col < 7; col++) {
                if (!started && col < startDow) {
                    gridHtml += '<div class="calendar-cell calendar-cell-empty"></div>';
                } else if (dayNum > daysInMonth) {
                    gridHtml += '<div class="calendar-cell calendar-cell-empty"></div>';
                } else {
                    started = true;
                    var dateStr = this.currentYear + '-' +
                        String(this.currentMonth + 1).padStart(2, '0') + '-' +
                        String(dayNum).padStart(2, '0');
                    var isToday = dateStr === todayStr;
                    var dayNotes = notesByDate[dateStr] || [];
                    var noteCount = dayNotes.length;
                    var isSelected = this.selectedDay === dayNum;

                    var classes = 'calendar-cell';
                    if (isToday) classes += ' calendar-today';
                    if (noteCount > 0) classes += ' calendar-has-notes';
                    if (isSelected) classes += ' calendar-selected';

                    var noteIndicator = '';
                    if (noteCount > 0) {
                        noteIndicator = '<span class="calendar-dot"></span>';
                        if (noteCount > 1) {
                            noteIndicator += '<span class="calendar-count">' + noteCount + '</span>';
                        }
                    }

                    gridHtml += '<div class="' + classes + '" data-date="' + dateStr + '" data-day="' + dayNum + '">' +
                        '<span class="calendar-day-num">' + dayNum + '</span>' +
                        noteIndicator +
                        '</div>';
                    dayNum++;
                }
            }
            gridHtml += '</div>';
            if (dayNum > daysInMonth && row >= 4) break; // Stop early if we've filled the month
        }

        gridEl.innerHTML = gridHtml;

        // Bind click handlers on day cells
        Array.from(gridEl.querySelectorAll('.calendar-cell:not(.calendar-cell-empty)')).forEach(function (cell) {
            cell.onclick = function () {
                var dateStr = cell.getAttribute('data-date');
                var day = parseInt(cell.getAttribute('data-day'), 10);
                self._onDayClick(day, dateStr);
            };
        });

        // Update footer
        if (footerEl) {
            var monthNoteCount = 0;
            var prefix = this.currentYear + '-' + String(this.currentMonth + 1).padStart(2, '0');
            Object.keys(notesByDate).forEach(function (d) {
                if (d.indexOf(prefix) === 0) {
                    monthNoteCount += notesByDate[d].length;
                }
            });
            footerEl.textContent = monthNoteCount + ' note' + (monthNoteCount !== 1 ? 's' : '') + ' this month';
        }

        // Hide note picker if visible
        this._closeNotePicker();
    },

    
    _onDayClick: function (day, dateStr) {
        this.selectedDay = day;

        var notesByDate = this._getNotesByDate();
        var dayNotes = notesByDate[dateStr] || [];
        this.selectedDayNotes = dayNotes;

        var parts = dateStr.split('-');
        var title = 'Daily Log ' + dateStr;

        if (dayNotes.length === 0) {
            // No notes for this day - create/open daily note
            this.close();
            if (window.Notes) {
                var exists = window.Notes.openByTitle(title);
                if (!exists) {
                    window.Notes.create(title, '/Journal');
                }
            }
        } else if (dayNotes.length === 1) {
            // One note - open it directly
            this.close();
            if (window.Notes) {
                window.Notes.open(dayNotes[0].id);
            }
        } else {
            // Multiple notes - show picker
            this._showNotePicker(dateStr, dayNotes);
        }
    },

    
    _showNotePicker: function (dateStr, notes) {
        this.showNotePicker = true;

        var picker = document.getElementById('calendar-note-picker');
        var titleEl = document.getElementById('calendar-picker-title');
        var listEl = document.getElementById('calendar-picker-list');
        if (!picker || !titleEl || !listEl) return;

        picker.style.display = 'block';
        titleEl.textContent = dateStr + ' (' + notes.length + ' notes)';

        listEl.innerHTML = '';
        var self = this;

        notes.forEach(function (note) {
            var item = document.createElement('div');
            item.className = 'calendar-picker-item';

            var title = document.createElement('span');
            title.className = 'calendar-picker-item-title';
            title.textContent = note.title || 'Untitled';
            item.appendChild(title);

            var path = document.createElement('span');
            path.className = 'calendar-picker-item-path';
            var displayPath = note.path || '/';
            path.textContent = displayPath === '/' ? '' : displayPath;
            item.appendChild(path);

            item.onclick = function () {
                self.close();
                if (window.Notes) {
                    window.Notes.open(note.id);
                }
            };

            listEl.appendChild(item);
        });

        // Update grid selection
        var grid = document.getElementById('calendar-grid');
        if (grid) {
            Array.from(grid.querySelectorAll('.calendar-cell')).forEach(function (cell) {
                cell.classList.toggle('calendar-selected', parseInt(cell.getAttribute('data-day'), 10) === this.selectedDay);
            }, this);
        }
    },

    
    _closeNotePicker: function () {
        this.showNotePicker = false;
        var picker = document.getElementById('calendar-note-picker');
        if (picker) picker.style.display = 'none';
    },

    
    _bindEvents: function () {
        this._boundKeyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);
    },

    
    _unbindEvents: function () {
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this._boundKeyHandler = null;
        }
    },

    
    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.prevMonth();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextMonth();
                break;
            case 'Escape':
                e.preventDefault();
                this.close();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedDay) {
                    var dateStr = this.currentYear + '-' +
                        String(this.currentMonth + 1).padStart(2, '0') + '-' +
                        String(this.selectedDay).padStart(2, '0');
                    this._onDayClick(this.selectedDay, dateStr);
                }
                break;
        }
    }
};

// Expose globally
window.Calendar = Calendar;
