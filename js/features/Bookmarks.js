import { State } from '../core/Store.js';

/* =========================================
   BOOKMARKS
   ========================================= */

// Local State
export let FLAT_BOOKMARKS = [];
export let NAV_STACK = [];
export const ROOT_ID = '1';
export let CURRENT_BOOKMARK_FOLDER = '1';

export function indexBookmarks() {
    var container = document.getElementById('bookmarks-container');
    if (!container) return;

    if (typeof chrome === 'undefined' || !chrome.bookmarks || State.CONFIG.show_bookmarks === false) {
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    renderBottomBar(ROOT_ID);

    try {
        chrome.bookmarks.getTree(function (tree) {
            FLAT_BOOKMARKS = []; // Reset local
            // Update State for search if needed? The search uses State.FLAT_BOOKMARKS? 
            // In CommandLine.js I used State.FLAT_BOOKMARKS.
            // I should update State.FLAT_BOOKMARKS too or switch CommandLine.js to import FLAT_BOOKMARKS from here.
            // For now, I'll update State.FLAT_BOOKMARKS as well to keep compatibility with my previous CommandLine.js change.
            State.FLAT_BOOKMARKS = FLAT_BOOKMARKS; 

            function traverse(node) {
                if (node.title) {
                    var item = {
                        title: node.title,
                        url: node.url || null,
                        id: node.id,
                        type: node.url ? 'bookmark' : 'folder'
                    };
                    FLAT_BOOKMARKS.push(item);
                }
                if (node.children) node.children.forEach(traverse);
            }
            if (tree[0] && tree[0].children) tree[0].children.forEach(traverse);
        });
    } catch (e) { }
}

export function renderBottomBar(folderId) {
    CURRENT_BOOKMARK_FOLDER = folderId;
    State.CURRENT_BOOKMARK_FOLDER = folderId; // keep synced if needed

    var container = document.getElementById('bookmarks-container');
    if (!container || typeof chrome === 'undefined' || !chrome.bookmarks) return;

    container.innerHTML = '';

    try {
        chrome.bookmarks.getChildren(folderId, function (children) {
            // V15.4: Clear container inside callback to prevent race condition doubling
            container.innerHTML = '';

            // Always render back button first to prevent getting trapped
            if (NAV_STACK.length > 0) {
                var backBtn = document.createElement('div');
                backBtn.className = 'nav-back';
                backBtn.textContent = '[ < BACK ]';
                backBtn.onclick = function () { renderBottomBar(NAV_STACK.pop()); };
                container.appendChild(backBtn);
            } else {
                var label = document.createElement('span');
                label.className = 'nav-back';
                label.style.color = 'var(--main-color)';
                label.textContent = 'ROOT //';
                container.appendChild(label);
            }

            // Handle empty folders
            if (!children || children.length === 0) {
                var emptyMsg = document.createElement('span');
                emptyMsg.style.color = 'var(--dim-color)';
                emptyMsg.style.fontStyle = 'italic';
                emptyMsg.textContent = '[ EMPTY FOLDER ]';
                container.appendChild(emptyMsg);
                return;
            }

            children.forEach(function (node) {
                var el;
                var text = node.title.length > 20 ? node.title.substring(0, 18) + '..' : node.title;

                if (node.url) {
                    el = document.createElement('a');
                    el.className = 'bm-node';
                    el.textContent = text;
                    el.href = node.url;
                } else {
                    el = document.createElement('div');
                    el.className = 'bm-node bm-folder';
                    el.textContent = '[ ' + text + ' ]';
                    el.onclick = (function (nodeId, currentFolderId) {
                        return function () {
                            NAV_STACK.push(currentFolderId);
                            renderBottomBar(nodeId);
                        };
                    })(node.id, folderId);
                }
                container.appendChild(el);
            });
        });
    } catch (e) { }
}


export const Bookmarks = {
    init: indexBookmarks,
    renderBottomBar: renderBottomBar,
    FLAT_BOOKMARKS: FLAT_BOOKMARKS,
    getNavStack: function() { return NAV_STACK; }
};
