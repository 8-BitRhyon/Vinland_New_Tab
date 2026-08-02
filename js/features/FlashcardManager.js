import { State } from '../core/Store.js';

/* =========================================
   FLASHCARD MANAGER — Spaced Repetition
   =========================================
   Parses cloze deletions from note content,
   schedules reviews with the SM-2 algorithm,
   and manages the review queue.

   Syntax supported:
   - {c1::text::hint} — Obsidian-style cloze (c1, c2, etc.)
   - ::text:: — Simple inline shorthand (maps to c1)
   ========================================= */

const DB_NAME = 'OPERATOR_FLASHCARDS';
const STORE_NAME = 'cards';

// SM-2 defaults
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const GRADUATING_INTERVAL = 1;    // days after first good review
const EASY_INTERVAL = 4;          // days if rated "easy" on first review
const INTERVAL_MODIFIER = 1.0;    // Global interval modifier
const MAX_INTERVAL = 365;         // Max days between reviews
const FAILED_BUFFER_MS = 600000;  // 10 minutes — failed cards come back quickly

export const FlashcardManager = {
    _db: null,
    _dbPromise: null,
    _initialized: false,
    _sessionCards: [],
    _currentCardIndex: 0,

    /* ── Lifecycle ─────────────────────────── */

    init: function() {
        if (this._initialized) return;
        this._initialized = true;
        console.log('[Flashcard] Initialized');
    },

    /* ── IndexedDB ─────────────────────────── */

    _getDB: function() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function(e) {
                FlashcardManager._db = e.target.result;
                resolve(e.target.result);
            };
            request.onerror = function(e) { reject(e); };
        }).catch(function(err) {
            console.warn('[Flashcard] DB open failed:', err);
            return null;
        });
        return this._dbPromise;
    },

    _getAllCards: function() {
        return this._getDB().then(function(db) {
            if (!db) return [];
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.getAll();
                request.onsuccess = function() { resolve(request.result || []); };
                request.onerror = function(e) { reject(e); };
            });
        }).catch(function(err) {
            console.warn('[Flashcard] getAllCards failed:', err);
            return [];
        });
    },

    _saveCards: function(cards) {
        return this._getDB().then(function(db) {
            if (!db) return;
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                cards.forEach(function(card) { store.put(card); });
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        }).catch(function(err) {
            console.warn('[Flashcard] saveCards failed:', err);
        });
    },

    _deleteCard: function(cardId) {
        return this._getDB().then(function(db) {
            if (!db) return;
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.delete(cardId);
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        }).catch(function(err) {
            console.warn('[Flashcard] deleteCard failed:', err);
        });
    },

    clearAll: function() {
        return this._getDB().then(function(db) {
            if (!db) return;
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.clear();
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        }).catch(function(err) {
            console.warn('[Flashcard] clearAll failed:', err);
        });
    },

    /* ── Cloze Parsing ─────────────────────── */

    /**
     * Extract all cloze deletions from text.
     * Supports {c1::text::hint} and ::text:: syntax.
     * Guards against :: inside code blocks.
     */
    extractClozes: function(text) {
        if (!text) return [];
        var clozes = [];

        // Build a map of code-fence regions to skip
        var codeRegions = [];
        var fenceRegex = /```[\s\S]*?```/g;
        var fenceMatch;
        while ((fenceMatch = fenceRegex.exec(text)) !== null) {
            codeRegions.push({ start: fenceMatch.index, end: fenceMatch.index + fenceMatch[0].length });
        }

        function isInCodeRegion(pos) {
            return codeRegions.some(function(r) { return pos >= r.start && pos < r.end; });
        }

        // 1. Parse {c1::text::hint} syntax
        var obsidianRegex = /\{c(\d+)::([^}]*?)(?:::([^}]*))?\}/g;
        var match;
        while ((match = obsidianRegex.exec(text)) !== null) {
            if (isInCodeRegion(match.index)) continue;
            clozes.push({
                cardNumber: parseInt(match[1], 10) || 1,
                text: match[2].trim(),
                hint: match[3] ? match[3].trim() : '',
                fullMatch: match[0]
            });
        }

        // 2. Parse ::text:: simple syntax
        // Simple regex: ::text:: with code-fence guard
        // Using basic pattern — code-fence regions are already skipped above
        var simpleRegex = /::([^:]+?)::/g;
        while ((match = simpleRegex.exec(text)) !== null) {
            if (isInCodeRegion(match.index)) continue;
            // Avoid matching ::text:: inside Obsidian {c1::text::hint} blocks.
            // Check if we're inside an open {...} by comparing last open/close braces.
            var textBefore = text.substring(0, match.index);
            var lastOpen = textBefore.lastIndexOf('{');
            var lastClose = textBefore.lastIndexOf('}');
            if (lastOpen > lastClose) continue;
            clozes.push({
                cardNumber: 1,
                text: match[1].trim(),
                hint: '',
                fullMatch: match[0]
            });
        }

        return clozes;
    },

    /**
     * Replace cloze markers with highlighted spans for rendering.
     */
    highlightClozes: function(text) {
        if (!text) return '';
        var result = text;

        // Highlight {c1::text::hint}
        result = result.replace(/\{c(\d+)::([^}]*?)(?:::([^}]*))?\}/g, function(match, num, txt, hint) {
            return '<span class="cloze-span" data-cloze="' + txt + '" data-hint="' + (hint || '') + '" data-card="c' + num + '">[?]</span>';
        });

        // Highlight ::text::
        result = result.replace(/::([^:]+?)::/g, function(match, txt) {
            return '<span class="cloze-span" data-cloze="' + txt + '">[?]</span>';
        });

        return result;
    },

    /* ── Flashcard Extraction from Notes ───── */

    /**
     * Scan notes and extract/reconcile flashcards.
     * When a noteId is given, only that note is re-scanned (incremental — the
     * save-path hook); without one, the whole vault is reconciled (boot,
     * review session, stats). Returns a promise.
     */
    syncFromNotes: function(noteId) {
        var self = this;
        return this._getAllCards().then(function(existingCards) {
            var existingMap = {};
            existingCards.forEach(function(c) { existingMap[c.id] = c; });

            var newCards = [];

            var notesToScan;
            if (noteId) {
                // Incremental: only reconcile the given note's cards.
                var target = State.NOTES.find(function(n) { return n.id === noteId; });
                notesToScan = target ? [target] : [];
            } else {
                notesToScan = State.NOTES || [];
            }

            // In incremental mode only cards owned by the target note may be
            // deleted; other notes' cards must be left untouched.
            var noteCardPrefix = noteId ? ('card_' + noteId + '_') : null;

            notesToScan.forEach(function(note) {
                if (!note || note.type === 'canvas' || (note.path && note.path.indexOf('/.trash') === 0)) return;

                var fullContent = note.content || '';
                if (!fullContent && note.blocks && note.blocks.length > 0) {
                    fullContent = note.blocks.map(function(b) { return b.content || ''; }).join('\n');
                }

                var noteClozes = self.extractClozes(fullContent);
                noteClozes.forEach(function(cloze, idx) {
                    var cardId = 'card_' + note.id + '_' + idx;

                    if (existingMap[cardId]) {
                        var existing = existingMap[cardId];
                        existing.clozeText = cloze.text;
                        existing.hint = cloze.hint;
                        existing.noteId = note.id;
                        existing.noteTitle = note.title || 'Untitled';
                        existing.fullContent = fullContent;
                        existing.cardNumber = cloze.cardNumber;
                        newCards.push(existing);
                        delete existingMap[cardId];
                    } else {
                        var now = Date.now();
                        newCards.push({
                            id: cardId,
                            noteId: note.id,
                            noteTitle: note.title || 'Untitled',
                            clozeText: cloze.text,
                            hint: cloze.hint,
                            fullContent: fullContent,
                            cardNumber: cloze.cardNumber,
                            ease: DEFAULT_EASE,
                            interval: 0,
                            dueDate: now,
                            reviews: 0,
                            lastReviewDate: null,
                            created: now
                        });
                    }
                });
            });

            var deletePromises = Object.keys(existingMap).filter(function(id) {
                return noteCardPrefix === null || id.indexOf(noteCardPrefix) === 0;
            }).map(function(id) {
                return self._deleteCard(id);
            });

            return Promise.all(deletePromises).then(function() {
                return self._saveCards(newCards);
            });
        });
    },

    /**
     * Force-sync all notes to rebuild the flashcard index.
     * Returns a promise.
     */
    rebuildIndex: function() {
        return this.syncFromNotes();
    },

    /* ── SM-2 Scheduling ───────────────────── */

    /**
     * Grade a card and compute next review date using SM-2.
     * Quality: 0=Again, 2=Hard, 3=Good, 5=Easy
     * Failed cards (quality < 3) come back in ~10 minutes.
     */
    _computeSM2: function(card, quality) {
        var ease = card.ease || DEFAULT_EASE;
        var interval = card.interval || 0;
        var reviews = card.reviews || 0;

        if (quality < 3) {
            // Failed — reset interval, card returns in 10 minutes
            interval = 0;
            reviews = 0;
            var dueDate = Date.now() + FAILED_BUFFER_MS;
        } else {
            if (reviews === 0) {
                interval = quality === 5 ? EASY_INTERVAL : GRADUATING_INTERVAL;
            } else if (reviews === 1) {
                interval = 6;
            } else {
                interval = Math.round(interval * ease);
            }
            reviews++;

            ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
            if (ease < MIN_EASE) ease = MIN_EASE;

            interval = Math.round(interval * INTERVAL_MODIFIER);
            if (interval < 1) interval = 1;
            if (interval > MAX_INTERVAL) interval = MAX_INTERVAL;

            var dueDate = Date.now() + interval * 24 * 60 * 60 * 1000;
        }

        return {
            ease: ease,
            interval: interval,
            reviews: reviews,
            dueDate: dueDate,
            lastReviewDate: Date.now()
        };
    },

    /**
     * Grade a specific card and persist the new schedule.
     */
    gradeCard: function(cardId, quality) {
        var self = this;
        return this._getAllCards().then(function(cards) {
            var card = cards.find(function(c) { return c.id === cardId; });
            if (!card) return null;

            var schedule = self._computeSM2(card, quality);
            card.ease = schedule.ease;
            card.interval = schedule.interval;
            card.reviews = schedule.reviews;
            card.dueDate = schedule.dueDate;
            card.lastReviewDate = schedule.lastReviewDate;

            return self._saveCards([card]).then(function() {
                return card;
            });
        });
    },

    /**
     * Grade the current card in the active session and advance.
     */
    gradeCurrentCard: function(quality) {
        if (this._sessionCards.length === 0) return Promise.resolve(null);
        var card = this._sessionCards[this._currentCardIndex];
        if (!card) return Promise.resolve(null);

        var self = this;
        return this.gradeCard(card.id, quality).then(function() {
            self._currentCardIndex++;
            if (self._currentCardIndex >= self._sessionCards.length) {
                self._updateReviewUI(true);
            } else {
                self._updateReviewUI(false);
            }
        });
    },

    /* ── Review Session ────────────────────── */

    /**
     * Start a review session — sync from notes, load due cards, open modal.
     * Uses proper promise chaining instead of setTimeout.
     */
    startReviewSession: function() {
        var self = this;
        this.rebuildIndex().then(function() {
            return self._loadAndOpenSession();
        }).catch(function(err) {
            console.warn('[Flashcard] Review session failed:', err);
            // Fallback: try loading without sync
            self._loadAndOpenSession();
        });
    },

    _loadAndOpenSession: function() {
        var self = this;
        var now = Date.now();

        return this._getAllCards().then(function(cards) {
            self._sessionCards = cards.filter(function(c) {
                return c.dueDate <= now;
            });
            self._sessionCards.sort(function(a, b) {
                return a.dueDate - b.dueDate;
            });
            self._currentCardIndex = 0;
            self._openReviewModal();
        });
    },

    /* ── Review Modal UI ───────────────────── */

    _openReviewModal: function() {
        var modal = document.getElementById('review-modal');
        if (!modal) return;

        if (this._sessionCards.length === 0) {
            this._renderEmptySession(modal);
        } else {
            this._currentCardIndex = 0;
            this._updateReviewUI(false);
        }

        if (window.ModalManager) {
            window.ModalManager.open('review-modal');
        }
    },

    _renderEmptySession: function(modal) {
        var content = modal.querySelector('.review-modal-content') || modal;
        content.innerHTML = '<div class="review-empty">All caught up! No cards due for review.</div>';
    },

    _renderSessionComplete: function(modal) {
        var content = modal.querySelector('.review-modal-content') || modal;
        content.innerHTML = '<div class="review-complete">' +
            '<div class="review-complete-icon">✅</div>' +
            '<div class="review-complete-text">Session Complete!</div>' +
            '<div class="review-complete-sub">' + this._sessionCards.length + ' cards reviewed.</div>' +
            '</div>';
    },

    _updateReviewUI: function(isComplete) {
        var modal = document.getElementById('review-modal');
        if (!modal) return;

        var content = modal.querySelector('.review-modal-content') || modal;

        if (isComplete) {
            this._renderSessionComplete(modal);
            return;
        }

        var card = this._sessionCards[this._currentCardIndex];
        if (!card) {
            this._renderEmptySession(modal);
            return;
        }

        var total = this._sessionCards.length;
        var current = this._currentCardIndex + 1;
        var revealText = this._escapeHtml(card.clozeText);

        content.innerHTML =
            '<div class="review-progress">Card ' + current + ' of ' + total + '</div>' +
            '<div class="review-note-title">' + this._escapeHtml(card.noteTitle) + '</div>' +
            '<div class="review-card">' +
            '<div class="review-card-front">' +
            '<div class="review-cloze-context">' + this._highlightClozeInContext(card) + '</div>' +
            (card.hint ? '<div class="review-hint">Hint: ' + this._escapeHtml(card.hint) + '</div>' : '') +
            '</div>' +
            '<div class="review-card-back" style="display:none">' +
            '<div class="review-reveal">' + revealText + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="review-actions">' +
            '<button id="review-flip-btn" class="review-btn review-btn-flip">SHOW ANSWER</button>' +
            '</div>' +
            '<div class="review-grade-row" style="display:none">' +
            '<button id="review-grade-again" class="review-btn review-grade-again">AGAIN (0)</button>' +
            '<button id="review-grade-hard" class="review-btn review-grade-hard">HARD (2)</button>' +
            '<button id="review-grade-good" class="review-btn review-grade-good">GOOD (3)</button>' +
            '<button id="review-grade-easy" class="review-btn review-grade-easy">EASY (5)</button>' +
            '</div>';

        // Bind flip button
        var flipBtn = document.getElementById('review-flip-btn');
        if (flipBtn) {
            flipBtn.addEventListener('click', function() {
                var back = content.querySelector('.review-card-back');
                var gradeRow = content.querySelector('.review-grade-row');
                if (back) back.style.display = 'block';
                if (gradeRow) gradeRow.style.display = 'flex';
                if (flipBtn) flipBtn.style.display = 'none';
            });
        }

        // Bind grade buttons
        var self = this;
        var grades = [
            { id: 'review-grade-again', quality: 0 },
            { id: 'review-grade-hard', quality: 2 },
            { id: 'review-grade-good', quality: 3 },
            { id: 'review-grade-easy', quality: 5 }
        ];
        grades.forEach(function(g) {
            var btn = document.getElementById(g.id);
            if (btn) {
                btn.addEventListener('click', function() {
                    self.gradeCurrentCard(g.quality);
                });
            }
        });

        // Hidden count display for test assertions
        var countEl = document.getElementById('review-card-count-display');
        if (!countEl) {
            countEl = document.createElement('div');
            countEl.id = 'review-card-count-display';
            countEl.className = 'review-card-count';
            countEl.style.display = 'none';
            document.body.appendChild(countEl);
        }
        countEl.textContent = card.clozeText + ' | ' + current + '/' + total;
    },

    /**
     * Highlight the cloze in context using content-based splitting.
     * Finds the cloze position in the ORIGINAL text, splits around it,
     * escapes each segment, and wraps the cloze in [?] span.
     * This avoids HTML-escape matching issues.
     */
    _highlightClozeInContext: function(card) {
        var text = card.fullContent || '';
        var clozeText = card.clozeText || '';
        if (!clozeText) return this._escapeHtml(text);

        var idx = text.indexOf(clozeText);
        if (idx === -1) {
            // Fallback: cloze text not found (might be different block content)
            return this._escapeHtml(text);
        }

        var before = this._escapeHtml(text.substring(0, idx));
        var after = this._escapeHtml(text.substring(idx + clozeText.length));
        return before + '<span class="review-cloze-hidden">[?]</span>' + after;
    },

    /* ── Utilities ─────────────────────────── */

    _escapeHtml: function(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    /**
     * Get card statistics: total, due, reviewed today.
     */
    getStats: function() {
        var self = this;
        return this._getAllCards().then(function(cards) {
            var now = Date.now();
            var todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            return {
                total: cards.length,
                due: cards.filter(function(c) { return c.dueDate <= now; }).length,
                reviewedToday: cards.filter(function(c) {
                    return c.lastReviewDate && c.lastReviewDate >= todayStart.getTime();
                }).length,
                learning: cards.filter(function(c) { return c.reviews < 2; }).length,
                young: cards.filter(function(c) { return c.reviews >= 2 && c.interval < 21; }).length,
                mature: cards.filter(function(c) { return c.interval >= 21; }).length
            };
        });
    },

    /**
     * Fetch stats and display them as a notification.
     * Used by the 'flashcards' CLI command.
     */
    showStats: function() {
        var self = this;
        return this.rebuildIndex().then(function() {
            return self.getStats();
        }).then(function(stats) {
            var msg = '📊 FLASHCARD STATS\n' +
                'Total: ' + stats.total + ' | Due: ' + stats.due + '\n' +
                'Reviewed today: ' + stats.reviewedToday + '\n' +
                'Learning: ' + stats.learning + ' | Young: ' + stats.young + ' | Mature: ' + stats.mature;
            if (window.showNotification) {
                window.showNotification(msg);
            } else {
                console.log('[Flashcard] Stats:', stats);
            }
            return stats;
        }).catch(function(err) {
            console.warn('[Flashcard] showStats failed:', err);
            if (window.showNotification) {
                window.showNotification('Failed to load flashcard stats', 'error');
            }
        });
    }
};
