import { State } from './Store.js';

/* =========================================
   INDEXEDDB - STORAGE MATRIX
   ========================================= */
const DB_NAME = "OPERATOR_VAULT";
const STORE_NAME = "media_assets";

export const DB = {
    open: function () {
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function (e) { resolve(e.target.result); };
            request.onerror = function (e) { reject(e); };
        });
    },
    save: function (key, blob) {
        return DB.open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, "readwrite");
                var store = tx.objectStore(STORE_NAME);
                store.put(blob, key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function (e) { reject(e); };
            });
        });
    },
    get: function (key) {
        return DB.open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, "readonly");
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(key);
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function (e) { reject(e); };
            });
        });
    },
    delete: function (key) {
        return DB.open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, "readwrite");
                var store = tx.objectStore(STORE_NAME);
                store.delete(key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function (e) { reject(e); };
            });
        });
    }
};

// .2: Voltron Architecture - VinlandDB Wrapper
export var VinlandDB = {
    collections: {
        TASKS: 'OPERATOR_TASKS_V2',
        NOTES: 'OPERATOR_NOTES_V2',
        BOARDS: 'OPERATOR_BOARDS_V1',
        CANVASES: 'OPERATOR_CANVASES_V1',
        HISTORY: 'OPERATOR_HISTORY_V2',
        SESSIONS: 'OPERATOR_SESSIONS'
    },

    save: function(collection, data) {
        try {
            var key = this.collections[collection];
            if (key) localStorage.setItem(key, JSON.stringify(data));
        } catch (e) { console.error('VinlandDB: Save failure', e); }
    },

    load: function(collection, defaultValue) {
        try {
            var key = this.collections[collection];
            var data = localStorage.getItem(key);
            return data ? JSON.parse(data) : (defaultValue || []);
        } catch (e) { 
            console.error('VinlandDB: Load failure', e);
            return defaultValue || [];
        }
    }
};

// .36: Per-note sharding for the NOTES vault.
// Each note is stored under NOTE_PREFIX+id; NOTES_INDEX holds the ordered id list.
// saveData() only writes notes whose serialized form changed (diff-cache) and removes
// orphaned keys for deleted notes. Avoids re-serializing the entire vault on every save.
const NOTE_PREFIX = 'OPERATOR_NOTE_';
const NOTES_INDEX = 'OPERATOR_NOTES_INDEX';

// id -> last serialized string (in-memory diff cache)
let noteCache = new Map();
// ordered list of note ids currently on disk
let noteIdList = [];
// id -> last serialized canvasData (avoids redundant IndexedDB writes)
let canvasCache = new Map();

// ponytail: keep the big canvas payload out of localStorage. The per-note shard
// stores only a marker; the real canvasData lives in IndexedDB (see saveData).
const CANVAS_IDX_PREFIX = 'vinland_canvas_';

function serializeNote(note) {
    if (!note || !note.canvasData) return JSON.stringify(note);
    var clone = Object.assign({}, note);
    clone.canvasData = { _external: true };
    return JSON.stringify(clone);
}

// ── Dirty-set (save-path lever) ──────────────────────────────────────────
// Notes whose in-memory state changed since the last saveData(). saveData()
// re-serializes ONLY dirty notes (O(changed)) instead of stringifying the
// whole vault (O(vault)) on every save.
//
// SAFETY CONTRACT: the dirty-set is an optimization, never a correctness
// mechanism. When the set is empty, saveData() falls back to a full scan, so
// any mutation path that forgets to markNoteDirty() degrades gracefully to
// the previous (correct) behavior — it is only slower, never lossy.
// Mutation chokepoints that MUST mark: Notes.save/create/moveNote/togglePin/
// restore, PageManager.addBlock/updateBlock/deleteBlock, BlockEditor
// reorder/duplicate/undo-redo, CanvasManager._saveData.
let dirtyNotes = new Set();

export function markNoteDirty(noteId) {
    if (noteId) dirtyNotes.add(noteId);
}

export function markAllNotesDirty() {
    (State.NOTES || []).forEach(function (n) {
        if (n && n.id) dirtyNotes.add(n.id);
    });
}

export function loadData() {
    // Top-level integrity guard: wrap the entire load path so a single
    // corrupt localStorage key or IndexedDB failure never blocks startup.
    try {
        State.TASKS = VinlandDB.load('TASKS');
        State.BOARDS = VinlandDB.load('BOARDS');
        State.CANVASES = VinlandDB.load('CANVASES');
        State.COMMAND_HISTORY = VinlandDB.load('HISTORY');
    
        // --- NOTES: migrate legacy blob once, then hydrate from shards ---
        var legacy = localStorage.getItem(VinlandDB.collections.NOTES);
        if (legacy) {
            try {
                var legacyNotes = JSON.parse(legacy) || [];
                legacyNotes.forEach(function (n) {
                    if (!n || !n.id) return;
                    localStorage.setItem(NOTE_PREFIX + n.id, JSON.stringify(n));
                });
                var ids = legacyNotes.filter(function (n) { return n && n.id; }).map(function (n) { return n.id; });
                localStorage.setItem(NOTES_INDEX, JSON.stringify(ids));
                localStorage.removeItem(VinlandDB.collections.NOTES);
            } catch (e) {
                console.error('VinlandDB: legacy NOTES migration failed', e);
            }
        }
    
        State.NOTES = [];
        noteCache = new Map();
        canvasCache = new Map();
        noteIdList = [];
        // Sprint C: note lookups must reflect the freshly hydrated vault.
        if (State._invalidateNoteMaps) State._invalidateNoteMaps();
        var indexRaw = localStorage.getItem(NOTES_INDEX);
        if (indexRaw) {
            try {
                var ids = JSON.parse(indexRaw) || [];
                ids.forEach(function (id) {
                    var raw = localStorage.getItem(NOTE_PREFIX + id);
                    if (!raw) return;
                    try {
                        var note = JSON.parse(raw);
                        State.NOTES.push(note);
                        noteCache.set(id, raw);
                        noteIdList.push(id);
                    } catch (e) { console.error('VinlandDB: note parse failed', id, e); }
                });
            } catch (e) { console.error('VinlandDB: NOTES_INDEX parse failed', e); }
        }
    
        // Fallback: if index was missing or yielded no notes, scan for orphaned shards.
        // This can happen if a mid-migration crash removed the legacy blob but didn't
        // finish writing the index. Rebuild the index from whatever shards exist.
        if (State.NOTES.length === 0 && typeof localStorage.length === 'number') {
            var recovered = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key || !key.startsWith(NOTE_PREFIX)) continue;
                try {
                    var note = JSON.parse(localStorage.getItem(key));
                    if (note && note.id) {
                        State.NOTES.push(note);
                        noteCache.set(key.substring(NOTE_PREFIX.length), localStorage.getItem(key));
                        recovered.push(note.id);
                    }
                } catch (e) { /* skip malformed keys */ }
            }
            if (recovered.length > 0) {
                noteIdList = recovered;
                localStorage.setItem(NOTES_INDEX, JSON.stringify(recovered));
                console.log('[loadData] recovered', recovered.length, 'notes from orphaned shards');
            }
        }
    
        // ponytail: hydrate canvasData from IndexedDB for notes whose shard only
        // carries the {_external:true} marker. Fire-and-forget so loadData stays
        // synchronous (the node unit-test path calls it without await; IndexedDB is
        // absent there anyway). Known ceiling: a canvas opened in the same tick as
        // boot may render before IDB resolves - local and fast enough to ignore.
        if (typeof indexedDB !== 'undefined') {
            State.NOTES.forEach(function (note) {
                if (note && note.canvasData && note.canvasData._external === true) {
                    DB.get(CANVAS_IDX_PREFIX + note.id).then(function (real) {
                        if (real) note.canvasData = real;
                    }).catch(function () { /* leave marker; canvas will show empty */ });
                }
            });
        }
    
        try {
          var sessions = parseInt(localStorage.getItem(VinlandDB.collections.SESSIONS) || '0') + 1;
          localStorage.setItem(VinlandDB.collections.SESSIONS, sessions.toString());
          var sessionEl = document.getElementById('session-count');
          if (sessionEl) sessionEl.textContent = sessions;
        } catch (e) { console.error('[Storage] session count error:', e); }
    } catch (e) {
        console.error('[Storage] loadData integrity guard — data may be partially loaded:', e);
    }
    }

// @param {boolean} [forceFullScan] — true forces a full-vault scan even when
// the dirty-set is non-empty. Used on beforeunload/visibilitychange so the
// final state always persists everything.
export function saveData(forceFullScan) {
    // TASKS / BOARDS / CANVASES / HISTORY: small collections, full write is fine.
    VinlandDB.save('TASKS', State.TASKS);
    VinlandDB.save('BOARDS', State.BOARDS);
    VinlandDB.save('CANVASES', State.CANVASES);
    VinlandDB.save('HISTORY', State.COMMAND_HISTORY);

    // Remove orphaned keys for notes no longer in State.NOTES.
    // Set-based lookup keeps this O(n) instead of O(n·m) indexOf scans.
    var currentIdSet = new Set();
    (State.NOTES || []).forEach(function (n) { if (n && n.id) currentIdSet.add(n.id); });
    noteIdList.forEach(function (id) {
        if (!currentIdSet.has(id)) {
            localStorage.removeItem(NOTE_PREFIX + id);
            noteCache.delete(id);
            dirtyNotes.delete(id);
        }
    });
    noteIdList = Array.from(currentIdSet);

    // NOTES: differential per-note write. Dirty-set when marks exist; full
    // scan when empty (or forced) — the safe fallback keeps unmarked callers
    // correct. The noteCache string-diff still skips unchanged notes.
    var fullScan = forceFullScan === true || dirtyNotes.size === 0;
    // Safety net: a note with no noteCache entry has never been written to
    // disk. If the dirty-set is non-empty, a brand-new note created by an
    // unmarked path (importers, wiki-link autocomplete, duplicate, restore)
    // would otherwise be skipped — force the full scan so it cannot be lost.
    if (!fullScan) {
        var hasUnpersisted = (State.NOTES || []).some(function (note) {
            return note && note.id && !noteCache.has(note.id);
        });
        if (hasUnpersisted) fullScan = true;
    }
    var notesToProcess = (State.NOTES || []).filter(function (note) {
        return fullScan || (note && note.id && dirtyNotes.has(note.id));
    });

    notesToProcess.forEach(function (note) {
        if (!note || !note.id) return;
        var key = NOTE_PREFIX + note.id;
        var serialized = serializeNote(note);
        if (noteCache.get(note.id) !== serialized) {
            localStorage.setItem(key, serialized);
            noteCache.set(note.id, serialized);
        }
        // ponytail: mirror real canvasData to IndexedDB, deduped via canvasCache
        // so unchanged canvases skip the (heavier) IDB write. Skip empty canvases.
        if (typeof indexedDB !== 'undefined' && note.canvasData && !note.canvasData._external) {
            var hasCanvasContent = (note.canvasData.nodes && note.canvasData.nodes.length) ||
                                   (note.canvasData.edges && note.canvasData.edges.length);
            if (hasCanvasContent) {
                var real = JSON.stringify(note.canvasData);
                if (canvasCache.get(note.id) !== real) {
                    DB.save(CANVAS_IDX_PREFIX + note.id, note.canvasData);
                    canvasCache.set(note.id, real);
                }
            }
        }
    });

    dirtyNotes.clear();
    localStorage.setItem(NOTES_INDEX, JSON.stringify(noteIdList));
    // Sprint C: keep the id/title lookup maps in sync after any structural
    // mutation (adds/removes land here via the dirty-set + orphan cleanup).
    if (State._invalidateNoteMaps) State._invalidateNoteMaps();
}

// Full resync of the notes vault (writes every note key + rebuilds index/cache).
export function saveAllNotes() {
    (State.NOTES || []).forEach(function (note) {
        if (!note || !note.id) return;
        var serialized = serializeNote(note);
        localStorage.setItem(NOTE_PREFIX + note.id, serialized);
        noteCache.set(note.id, serialized);
        if (typeof indexedDB !== 'undefined' && note.canvasData && !note.canvasData._external) {
            var hasCanvasContent2 = (note.canvasData.nodes && note.canvasData.nodes.length) ||
                                    (note.canvasData.edges && note.canvasData.edges.length);
            if (hasCanvasContent2) {
                canvasCache.set(note.id, JSON.stringify(note.canvasData));
                DB.save(CANVAS_IDX_PREFIX + note.id, note.canvasData);
            }
        }
    });
    noteIdList = (State.NOTES || []).map(function (n) { return n.id; });
    localStorage.setItem(NOTES_INDEX, JSON.stringify(noteIdList));
    dirtyNotes.clear();
    if (State._invalidateNoteMaps) State._invalidateNoteMaps();
}

// Deletes all per-note keys and the index (used by #clear-data).
export function clearAllNotes() {
    noteIdList.forEach(function (id) {
        localStorage.removeItem(NOTE_PREFIX + id);
        // ponytail: drop the offloaded canvas payload too, so IDB doesn't
        // accumulate orphaned vinland_canvas_* entries. Guarded - the node
        // unit-test env has no indexedDB.
        if (typeof indexedDB !== 'undefined') DB.delete(CANVAS_IDX_PREFIX + id);
    });
    noteCache = new Map();
    canvasCache = new Map();
    noteIdList = [];
    dirtyNotes.clear();
    if (State._invalidateNoteMaps) State._invalidateNoteMaps();
    localStorage.removeItem(NOTES_INDEX);
}
