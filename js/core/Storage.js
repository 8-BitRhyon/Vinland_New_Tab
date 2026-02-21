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

export function loadData() {
    State.TASKS = VinlandDB.load('TASKS');
    State.NOTES = VinlandDB.load('NOTES');
    State.BOARDS = VinlandDB.load('BOARDS');
    State.CANVASES = VinlandDB.load('CANVASES');
    State.COMMAND_HISTORY = VinlandDB.load('HISTORY');
    
    var sessions = parseInt(localStorage.getItem(VinlandDB.collections.SESSIONS) || '0') + 1;
    localStorage.setItem(VinlandDB.collections.SESSIONS, sessions.toString());
    var sessionEl = document.getElementById('session-count');
    if (sessionEl) sessionEl.textContent = sessions;
}

export function saveData() {
    VinlandDB.save('TASKS', State.TASKS);
    VinlandDB.save('NOTES', State.NOTES);
    VinlandDB.save('BOARDS', State.BOARDS);
    VinlandDB.save('CANVASES', State.CANVASES);
    VinlandDB.save('HISTORY', State.COMMAND_HISTORY);
}
