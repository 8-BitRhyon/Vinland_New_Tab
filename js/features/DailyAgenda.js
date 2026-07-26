/**
 * DailyAgenda - Daily Notes Aggregation View
 *
 * Shows a weekly or monthly view where each day card displays the daily
 * note's title and content preview. Click a day to open the full note,
 * navigate between periods, and jump back to today.
 *
 * Opens on:
 *   - `agenda` CLI command
 *   - `Cmd+Shift+A` keyboard shortcut
 *
 * Features:
 *   - Week/Month toggle to switch between views
 *   - Scrollable list of day cards with content previews
 *   - Navigation arrows to move between periods
 *   - "Today" button to jump back to the current period
 *   - Keyboard navigation (arrows, Enter, Escape)
 */

import { State } from '../core/Store.js';

export const DailyAgenda = {
    isOpen: false,
    viewMode: 'week', // 'week' or 'month'
    currentAnchor: null, // Date object for the start of the current period
    selectedDateStr: null,

    /**
     * Initialize DailyAgenda. Called once from boot.js
     */
    init: function () {
        this.currentAnchor = new Date();
        this._injectDOM();
    },

    /**
     * Open the DailyAgenda modal
     */
    open: function () {
        if (this.isOpen) return;
        this.isOpen = true;

        this.currentAnchor = new Date();
        this.selectedDateStr = null;

        var overlay = document.getElementById('agenda-overlay');
        var modal = document.getElementById('agenda-modal');
        if (!overlay || !modal) return;

        overlay.classList.add('active');
        modal.classList.add('active');

        this._render();
        this._bindEvents();
    },

    /**
     * Close the DailyAgenda modal
     */
    close: function () {
        if (!this.isOpen) return;
        this.isOpen = false;

        var overlay = document.getElementById('agenda-overlay');
        var modal = document.getElementById('agenda-modal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');

        this._unbindEvents();
        this.selectedDateStr = null;
    },

    /**
     * Navigate to previous period (week or month)
     */
    prevPeriod: function () {
        var anchor = new Date(this.currentAnchor);
        if (this.viewMode === 'week') {
            anchor.setDate(anchor.getDate() - 7);
            // Go to Monday of that week
            var dayOfWeek = (anchor.getDay() + 6) % 7; // Monday = 0
            anchor.setDate(anchor.getDate() - dayOfWeek);
        } else {
            anchor.setMonth(anchor.getMonth() - 1);
            anchor.setDate(1);
        }
        this.currentAnchor = anchor;
        this.selectedDateStr = null;
        this._render();
    },

    /**
     * Navigate to next period (week or month)
     */
    nextPeriod: function () {
        var anchor = new Date(this.currentAnchor);
        if (this.viewMode === 'week') {
            anchor.setDate(anchor.getDate() + 7);
            // Go to Monday of that week
            var dayOfWeek = (anchor.getDay() + 6) % 7; // Monday = 0
            anchor.setDate(anchor.getDate() - dayOfWeek);
        } else {
            anchor.setMonth(anchor.getMonth() + 1);
            anchor.setDate(1);
        }
        this.currentAnchor = anchor;
        this.selectedDateStr = null;
        this._render();
    },

    /**
     * Jump to today's week/month
     */
    goToToday: function () {
        this.currentAnchor = new Date();
        if (this.viewMode === 'week') {
            // Go to Monday of this week
            var dayOfWeek = (this.currentAnchor.getDay() + 6) % 7; // Monday = 0
            this.currentAnchor.setDate(this.currentAnchor.getDate() - dayOfWeek);
        } else {
            this.currentAnchor.setDate(1);
        }
        this.selectedDateStr = null;
        this._render();
    },

    /**
     * Toggle between week and month view
     */
    toggleViewMode: function () {
        this.viewMode = (this.viewMode === 'week') ? 'month' : 'week';
        // Re-anchor to the start of the new period
        if (this.viewMode === 'month') {
            this.currentAnchor.setDate(1);
        } else {
            // Go to Monday of the current week
            var dayOfWeek = (this.currentAnchor.getDay() + 6) % 7;
            this.currentAnchor.setDate(this.currentAnchor.getDate() - dayOfWeek);
        }
        this.selectedDateStr = null;
        this._render();
    },

    // ─── Private Methods ─────────────────────────────────────────

    /**
     * Inject DailyAgenda DOM elements on first init
     */
    _injectDOM: function () {
        if (document.getElementById('agenda-overlay')) return;

        // Overlay backdrop
        var overlay = document.createElement('div');
        overlay.id = 'agenda-overlay';
        overlay.className = 'agenda-overlay';
        overlay.onclick = this.close.bind(this);
        document.body.appendChild(overlay);

        // Main modal container
        var modal = document.createElement('div');
        modal.id = 'agenda-modal';
        modal.className = 'agenda-modal';

        var html =
            // Header
            '<div class="agenda-header">' +
                '<button class="agenda-nav-btn" id="agenda-prev-btn" title="Previous">&larr;</button>' +
                '<span class="agenda-title" id="agenda-title"></span>' +
                '<button class="agenda-nav-btn" id="agenda-next-btn" title="Next">&rarr;</button>' +
                '<button class="agenda-today-btn" id="agenda-today-btn">TODAY</button>' +
                '<button class="agenda-toggle-btn" id="agenda-toggle-btn">MONTH</button>' +
            '</div>' +
            // Content area
            '<div class="agenda-content" id="agenda-content">' +
                '<div class="agenda-loading">Loading...</div>' +
            '</div>' +
            // Footer
            '<div class="agenda-footer">' +
                '<span class="agenda-footer-hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> period  <kbd>W</kbd> toggle view  <kbd>Enter</kbd> open  <kbd>Esc</kbd> close</span>' +
                '<span class="agenda-footer-count" id="agenda-footer-count"></span>' +
            '</div>';

        modal.innerHTML = html;
        document.body.appendChild(modal);

        // Bind static button handlers
        document.getElementById('agenda-prev-btn').onclick = this.prevPeriod.bind(this);
        document.getElementById('agenda-next-btn').onclick = this.nextPeriod.bind(this);
        document.getElementById('agenda-today-btn').onclick = this.goToToday.bind(this);
        document.getElementById('agenda-toggle-btn').onclick = this.toggleViewMode.bind(this);
    },

    /**
     * Get all notes indexed by date (same logic as Calendar._getNotesByDate)
     */
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

    /**
     * Get a plain-text preview of a note's content
     */
    _getPreview: function (note) {
        if (!note) return '';

        // Try blocks first
        if (note.blocks && note.blocks.length > 0) {
            var text = note.blocks.map(function (b) { return b.content || ''; }).join(' ').trim();
            if (text) return text.substring(0, 120) + (text.length > 120 ? '...' : '');
        }

        // Fall back to content field
        if (note.content) {
            var cleaned = note.content
                .replace(/[#*_`~]/g, '') // Strip simple markdown
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Strip links
                .replace(/!\[.*?\]\(.*?\)/g, '') // Strip images
                .replace(/\n/g, ' ')
                .trim();
            return cleaned.substring(0, 120) + (cleaned.length > 120 ? '...' : '');
        }

        return '';
    },

    /**
     * Format a date string to a readable label
     */
    _formatDateLabel: function (dateStr) {
        var parts = dateStr.split('-');
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var today = new Date();
        var tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // Check if same day
        var isToday = d.toDateString() === today.toDateString();
        var isTomorrow = d.toDateString() === tomorrow.toDateString();
        var isYesterday = d.toDateString() === yesterday.toDateString();

        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        var label = dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();

        if (isToday) label = 'Today';
        else if (isTomorrow) label = 'Tomorrow';
        else if (isYesterday) label = 'Yesterday';

        return label;
    },

    /**
     * Render the agenda content
     */
    _render: function () {
        var titleEl = document.getElementById('agenda-title');
        var contentEl = document.getElementById('agenda-content');
        var footerEl = document.getElementById('agenda-footer-count');
        var toggleBtn = document.getElementById('agenda-toggle-btn');
        if (!titleEl || !contentEl) return;

        // Update toggle button text
        if (toggleBtn) {
            toggleBtn.textContent = this.viewMode === 'week' ? 'MONTH' : 'WEEK';
        }

        // Calculate the date range
        var notesByDate = this._getNotesByDate();

        if (this.viewMode === 'week') {
            this._renderWeek(titleEl, contentEl, footerEl, notesByDate);
        } else {
            this._renderMonth(titleEl, contentEl, footerEl, notesByDate);
        }
    },

    /**
     * Render a single week view
     */
    _renderWeek: function (titleEl, contentEl, footerEl, notesByDate) {
        var anchor = new Date(this.currentAnchor);
        // Ensure we start on Monday
        var dayOfWeek = (anchor.getDay() + 6) % 7;
        anchor.setDate(anchor.getDate() - dayOfWeek);

        var monday = new Date(anchor);

        // Calculate the Sunday
        var sunday = new Date(anchor);
        sunday.setDate(sunday.getDate() + 6);

        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Format header: "Jan 5 - Jan 11, 2026" or "Jan 5 - Feb 1, 2026"
        var headerLabel;
        if (monday.getMonth() === sunday.getMonth()) {
            headerLabel = monthNames[monday.getMonth()] + ' ' + monday.getDate() + ' - ' +
                sunday.getDate() + ', ' + sunday.getFullYear();
        } else {
            headerLabel = monthNames[monday.getMonth()] + ' ' + monday.getDate() + ' - ' +
                monthNames[sunday.getMonth()] + ' ' + sunday.getDate() + ', ' + sunday.getFullYear();
        }
        titleEl.textContent = headerLabel;

        var self = this;
        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        var html = '';
        var totalNotes = 0;

        // Render 7 days (Monday to Sunday)
        for (var i = 0; i < 7; i++) {
            var day = new Date(anchor);
            day.setDate(day.getDate() + i);

            var dateStr = day.getFullYear() + '-' +
                String(day.getMonth() + 1).padStart(2, '0') + '-' +
                String(day.getDate()).padStart(2, '0');

            var dayNotes = notesByDate[dateStr] || [];
            var isToday = dateStr === todayStr;
            var isSelected = this.selectedDateStr === dateStr;
            var isFuture = day > today;

            totalNotes += dayNotes.length;

            var classes = 'agenda-day';
            if (isToday) classes += ' agenda-day-today';
            if (isSelected) classes += ' agenda-day-selected';
            if (isFuture) classes += ' agenda-day-future';
            if (dayNotes.length === 0) classes += ' agenda-day-empty';

            html += '<div class="' + classes + '" data-date="' + dateStr + '">';

            // Day header
            html += '<div class="agenda-day-header">';
            html += '<span class="agenda-day-label">' + this._formatDateLabel(dateStr) + '</span>';
            if (dayNotes.length > 0) {
                html += '<span class="agenda-day-count">' + dayNotes.length + ' note' + (dayNotes.length !== 1 ? 's' : '') + '</span>';
            }
            html += '</div>';

            // Notes for this day
            if (dayNotes.length === 0) {
                html += '<div class="agenda-day-empty-content">' +
                    '<span class="agenda-empty-text">No notes</span>' +
                    '</div>';
            } else {
                dayNotes.forEach(function (note) {
                    var preview = self._getPreview(note);
                    html += '<div class="agenda-note-card" data-note-id="' + note.id + '">';
                    html += '<div class="agenda-note-title">' + self._escapeHtml(note.title || 'Untitled') + '</div>';
                    if (preview) {
                        html += '<div class="agenda-note-preview">' + self._escapeHtml(preview) + '</div>';
                    }
                    html += '</div>';
                });
            }

            html += '</div>';
        }

        contentEl.innerHTML = html;
        contentEl.scrollTop = 0;

        // Update footer
        if (footerEl) {
            footerEl.textContent = totalNotes + ' note' + (totalNotes !== 1 ? 's' : '') + ' this week';
        }

        // Bind click handlers on day cards
        var self = this;
        Array.from(contentEl.querySelectorAll('.agenda-day')).forEach(function (dayEl) {
            dayEl.onclick = function () {
                var dateStr = dayEl.getAttribute('data-date');
                self._onDayClick(dateStr);
            };
        });

        // Bind click handlers on note cards to open specific note
        Array.from(contentEl.querySelectorAll('.agenda-note-card')).forEach(function (card) {
            card.onclick = function (e) {
                e.stopPropagation();
                var noteId = card.getAttribute('data-note-id');
                if (noteId && window.Notes) {
                    self.close();
                    window.Notes.open(noteId);
                }
            };
        });
    },

    /**
     * Render a full month view (shorter cards for each day)
     */
    _renderMonth: function (titleEl, contentEl, footerEl, notesByDate) {
        var anchor = new Date(this.currentAnchor);
        anchor.setDate(1); // Start of month

        var year = anchor.getFullYear();
        var month = anchor.getMonth();

        var monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        titleEl.textContent = monthNames[month] + ' ' + year;

        var daysInMonth = new Date(year, month + 1, 0).getDate();

        var self = this;
        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        var html = '';
        var totalNotes = 0;

        for (var dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            var dateStr = year + '-' +
                String(month + 1).padStart(2, '0') + '-' +
                String(dayNum).padStart(2, '0');

            var dayNotes = notesByDate[dateStr] || [];
            var isToday = dateStr === todayStr;
            var isSelected = this.selectedDateStr === dateStr;
            var dayDate = new Date(year, month, dayNum);
            var isFuture = dayDate > today;

            totalNotes += dayNotes.length;

            var classes = 'agenda-day agenda-day-month';
            if (isToday) classes += ' agenda-day-today';
            if (isSelected) classes += ' agenda-day-selected';
            if (isFuture) classes += ' agenda-day-future';
            if (dayNotes.length === 0) classes += ' agenda-day-empty';

            html += '<div class="' + classes + '" data-date="' + dateStr + '">';

            // Day header
            html += '<div class="agenda-day-header">';
            html += '<span class="agenda-day-label">' + this._formatDateLabel(dateStr) + '</span>';
            if (dayNotes.length > 0) {
                html += '<span class="agenda-day-count">' + dayNotes.length + '</span>';
            }
            html += '</div>';

            // Notes
            if (dayNotes.length === 0) {
                html += '<div class="agenda-day-empty-content">' +
                    '<span class="agenda-empty-text">—</span>' +
                    '</div>';
            } else {
                dayNotes.forEach(function (note) {
                    var preview = self._getPreview(note);
                    html += '<div class="agenda-note-card" data-note-id="' + note.id + '">';
                    html += '<div class="agenda-note-title">' + self._escapeHtml(note.title || 'Untitled') + '</div>';
                    if (preview) {
                        html += '<div class="agenda-note-preview">' + self._escapeHtml(preview) + '</div>';
                    }
                    html += '</div>';
                });
            }

            html += '</div>';
        }

        contentEl.innerHTML = html;
        contentEl.scrollTop = 0;

        // Update footer
        if (footerEl) {
            footerEl.textContent = totalNotes + ' note' + (totalNotes !== 1 ? 's' : '') + ' this month';
        }

        // Bind click handlers on day cards
        Array.from(contentEl.querySelectorAll('.agenda-day')).forEach(function (dayEl) {
            dayEl.onclick = function () {
                var dateStr = dayEl.getAttribute('data-date');
                self._onDayClick(dateStr);
            };
        });

        // Bind click handlers on note cards
        Array.from(contentEl.querySelectorAll('.agenda-note-card')).forEach(function (card) {
            card.onclick = function (e) {
                e.stopPropagation();
                var noteId = card.getAttribute('data-note-id');
                if (noteId && window.Notes) {
                    self.close();
                    window.Notes.open(noteId);
                }
            };
        });
    },

    /**
     * Handle click on a day
     */
    _onDayClick: function (dateStr) {
        // Toggle selection: if already selected, open the daily note
        if (this.selectedDateStr === dateStr) {
            var notesByDate = this._getNotesByDate();
            var dayNotes = notesByDate[dateStr] || [];
            var parts = dateStr.split('-');
            var title = 'Daily Log ' + dateStr;

            this.close();
            if (window.Notes) {
                if (dayNotes.length === 1) {
                    // Single note - open it directly
                    window.Notes.open(dayNotes[0].id);
                } else {
                    // Try to open/create daily note by title
                    var exists = window.Notes.openByTitle(title);
                    if (!exists) {
                        window.Notes.create(title, '/Journal');
                    }
                }
            }
            return;
        }

        this.selectedDateStr = dateStr;
        this._render();
    },

    /**
     * Escape HTML special characters
     */
    _escapeHtml: function (str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Bind keyboard events
     */
    _bindEvents: function () {
        this._boundKeyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);
    },

    /**
     * Unbind keyboard events
     */
    _unbindEvents: function () {
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this._boundKeyHandler = null;
        }
    },

    /**
     * Handle keyboard events
     */
    _onKeyDown: function (e) {
        if (!this.isOpen) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.prevPeriod();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextPeriod();
                break;
            case 'w':
            case 'W':
                e.preventDefault();
                this.toggleViewMode();
                break;
            case 'Escape':
                e.preventDefault();
                this.close();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedDateStr) {
                    this._onDayClick(this.selectedDateStr);
                }
                break;
        }
    }
};

// Expose globally
window.DailyAgenda = DailyAgenda;
