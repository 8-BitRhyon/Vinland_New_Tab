import { State } from './store.js';

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
    }
};

// V15.2: Voltron Architecture - VinlandDB Wrapper
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

// V19.36: Per-note sharding for the NOTES vault.
// Each note is stored under NOTE_PREFIX+id; NOTES_INDEX holds the ordered id list.
// saveData() only writes notes whose serialized form changed (diff-cache) and removes
// orphaned keys for deleted notes. Avoids re-serializing the entire vault on every save.
const NOTE_PREFIX = 'OPERATOR_NOTE_';
const NOTES_INDEX = 'OPERATOR_NOTES_INDEX';

// id -> last serialized string (in-memory diff cache)
let noteCache = new Map();
// ordered list of note ids currently on disk
let noteIdList = [];

export function loadData() {
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
    noteIdList = [];
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

    var sessions = parseInt(localStorage.getItem(VinlandDB.collections.SESSIONS) || '0') + 1;
    localStorage.setItem(VinlandDB.collections.SESSIONS, sessions.toString());
    var sessionEl = document.getElementById('session-count');
    if (sessionEl) sessionEl.textContent = sessions;
}

export function saveData() {
    // TASKS / BOARDS / CANVASES / HISTORY: small collections, full write is fine.
    VinlandDB.save('TASKS', State.TASKS);
    VinlandDB.save('BOARDS', State.BOARDS);
    VinlandDB.save('CANVASES', State.CANVASES);
    VinlandDB.save('HISTORY', State.COMMAND_HISTORY);

    // NOTES: differential per-note write.
    var currentIds = (State.NOTES || []).map(function (n) { return n.id; });

    (State.NOTES || []).forEach(function (note) {
        if (!note || !note.id) return;
        var serialized = JSON.stringify(note);
        if (noteCache.get(note.id) !== serialized) {
            localStorage.setItem(NOTE_PREFIX + note.id, serialized);
            noteCache.set(note.id, serialized);
        }
    });

    // Remove orphaned keys for notes no longer in State.NOTES.
    noteIdList.forEach(function (id) {
        if (currentIds.indexOf(id) === -1) {
            localStorage.removeItem(NOTE_PREFIX + id);
            noteCache.delete(id);
        }
    });

    noteIdList = currentIds;
    localStorage.setItem(NOTES_INDEX, JSON.stringify(noteIdList));
}

// Full resync of the notes vault (writes every note key + rebuilds index/cache).
export function saveAllNotes() {
    (State.NOTES || []).forEach(function (note) {
        if (!note || !note.id) return;
        var serialized = JSON.stringify(note);
        localStorage.setItem(NOTE_PREFIX + note.id, serialized);
        noteCache.set(note.id, serialized);
    });
    noteIdList = (State.NOTES || []).map(function (n) { return n.id; });
    localStorage.setItem(NOTES_INDEX, JSON.stringify(noteIdList));
}

// Deletes all per-note keys and the index (used by #clear-data).
export function clearAllNotes() {
    noteIdList.forEach(function (id) {
        localStorage.removeItem(NOTE_PREFIX + id);
    });
    noteCache = new Map();
    noteIdList = [];
    localStorage.removeItem(NOTES_INDEX);
}
