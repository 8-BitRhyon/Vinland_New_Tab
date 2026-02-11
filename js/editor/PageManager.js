import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { HistoryManager } from './BlockEditor.js'; // Circular dependency note: handled by ES modules if used at runtime

/* =========================================
   PHASE 3: PAGE MANAGER
   Handles data model updates
   ========================================= */

/**
 * Parse markdown content into block array
 */
export function parseContentToBlocks(content) {
    if (!content) return [];

    var lines = content.split('\n');
    var blocks = [];
    var order = 0;

    lines.forEach(function (line) {
        var block = { id: 'blk_' + Date.now() + '_' + order, order: order };
        var workingLine = line;

        // 1. Detect Indentation (Leading spaces)
        var indentMatch = workingLine.match(/^(\s+)/);
        if (indentMatch) {
            block.level = Math.floor(indentMatch[1].length / 2);
            workingLine = workingLine.substring(indentMatch[1].length);
        } else {
            block.level = 0;
        }

        // 2. Detect Alignment Marker (Suffix)
        var alignMatch = workingLine.match(/\s?%%align:(left|center|right)%%$/);
        if (alignMatch) {
            block.align = alignMatch[1];
            workingLine = workingLine.substring(0, workingLine.length - alignMatch[0].length);
        }

        // 3. Detect Block Types
        if (workingLine.startsWith('# ')) {
            block.type = 'h1';
            block.content = workingLine.substring(2);
        } else if (workingLine.startsWith('## ')) {
            block.type = 'h2';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('### ')) {
            block.type = 'h3';
            block.content = workingLine.substring(4);
        } else if (workingLine.match(/^- \[( |x)\] /)) {
            block.type = 'task';
            block.checked = workingLine.includes('[x]');
            block.content = workingLine.replace(/^- \[( |x)\] /, '');
        } else if (workingLine.startsWith('- ') || workingLine.startsWith('* ')) {
            block.type = 'bullet';
            block.content = workingLine.substring(2);
        } else if (workingLine.match(/^1\.\s/)) {
            block.type = 'numbered';
            block.content = workingLine.substring(3);
        } else if (workingLine.startsWith('> ')) {
            block.type = 'quote';
            block.content = workingLine.substring(2);
        } else if (workingLine.startsWith('```')) {
            block.type = 'code';
            block.language = workingLine.substring(3).trim() || 'plain';
            block.content = ''; // Simplified multiline handling
        } else if (workingLine.trim() === '---') {
            block.type = 'divider';
            block.content = '';
        } else {
            block.type = 'p';
            block.content = workingLine;
        }

        blocks.push(block);
        order++;
    });

    return blocks;
}

/**
 * Sanitize path string
 */
export function sanitizePath(path) {
    if (!path) return '/';
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

/**
 * Extract wiki links from note content
 * Finds all [[Link]] references and returns array of link targets
 */
export function extractWikiLinks(content) {
    if (!content) return [];
    var regex = /\[\[([^\[\]]+)\]\]/g;
    var links = [];
    var match;

    while ((match = regex.exec(content)) !== null) {
        var raw = match[1];
        var linkTarget = raw.split('|')[0].trim(); // Handle [[Target|Label]]
        if (linkTarget) links.push(linkTarget);
    }

    return links;
}

export const PageManager = {
    // Create a new page
    createPage: function (title, type) {
        type = type || 'markdown'; // 'markdown' | 'canvas'
        var page = {
            id: 'page_' + Date.now(),
            title: title || 'UNTITLED_ENTRY',
            content: '',
            blocks: [],
            path: '/',
            links: [],
            created: Date.now(),
            modified: Date.now(),
            viewMode: 'edit'
        };

        // Initialize with one empty paragraph block
        this.addBlock(page, 'p', '');

        State.NOTES.unshift(page);
        saveData();
        return page;
    },

    // Add a block to a page object
    addBlock: function (page, blockType, content, afterBlockId) {
        if (HistoryManager && HistoryManager.push) HistoryManager.push(page.id); // V70: Snapshot tracking
        if (!page) return null;

        var newBlock = {
            id: 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            type: blockType,
            content: content || '',
            order: (page.blocks ? page.blocks.length : 0),
            level: 0, // V68: Indentation level (0-5)
            align: 'left' // V68: Text alignment
        };

        // Type-specific defaults
        if (blockType === 'task') {
            newBlock.checked = false;
            newBlock.createdAt = Date.now();
        }
        if (blockType === 'kanban_ref') newBlock.boardId = null;
        if (blockType === 'code') newBlock.language = 'javascript';

        if (!page.blocks) page.blocks = [];

        // Insert position
        if (afterBlockId) {
            var idx = page.blocks.findIndex(function (b) { return b.id === afterBlockId; });
            if (idx !== -1) {
                page.blocks.splice(idx + 1, 0, newBlock);
                this.reorderBlocks(page);
            } else {
                page.blocks.push(newBlock);
            }
        } else {
            page.blocks.push(newBlock);
        }

        page.modified = Date.now();
        return newBlock;
    },

    // Update a specific block
    updateBlock: function (pageId, blockId, updates) {
        if (HistoryManager && HistoryManager.push) HistoryManager.push(pageId); // V70: Snapshot tracking
        var page = State.NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return false;

        var block = page.blocks.find(function (b) { return b.id === blockId; });
        if (!block) return false;

        // V15.1: Tracking completion timestamp
        if (block.type === 'task' && updates.checked === true && !block.completedAt) {
            updates.completedAt = Date.now();
        } else if (block.type === 'task' && updates.checked === false) {
            updates.completedAt = null;
        }

        Object.assign(block, updates);
        
        // V68: Clamp level
        if (block.level !== undefined) {
            block.level = Math.max(0, Math.min(5, block.level));
        }

        page.modified = Date.now();
        return true;
    },

    // Delete a block
    deleteBlock: function (pageId, blockId) {
        if (HistoryManager && HistoryManager.push) HistoryManager.push(pageId); // V70: Snapshot tracking
        var page = State.NOTES.find(function (n) { return n.id === pageId; });
        if (!page) return false;

        page.blocks = page.blocks.filter(function (b) { return b.id !== blockId; });
        this.reorderBlocks(page);
        page.modified = Date.now();
        return true;
    },

    // Reorder blocks (fix order indices)
    reorderBlocks: function (page) {
        if (!page || !page.blocks) return;
        page.blocks.forEach(function (b, i) { b.order = i; });
    },

    // Sync content string from blocks (for search/legacy compat)
    syncContent: function (pageId) {
        var page = State.NOTES.find(function (n) { return n.id === pageId; });
        if (!page || !page.blocks) return;

        var listCounter = 0;

        page.content = page.blocks.map(function (b) {
            var content = '';
            
            // Track numbered list continuity
            if (b.type === 'numbered') {
                listCounter++;
            } else {
                // If we hit a non-list item (and not an indented child... strictly speaking complex)
                // For now, reset on any non-numbered block to treat it as a new list
                // To support nested lists properly with this simple generator we'd need stack logic, 
                // but this is better than '1. 1. 1.' everywhere.
                // Note: Bullets shouldn't reset if they are part of mixed list? usually they are separate.
                listCounter = 0; 
            }
            
            // 1. Indentation Prefix
            var prefix = (b.level && b.level > 0) ? '  '.repeat(b.level) : '';
            
            // 2. Alignment Suffix
            var suffix = (b.align && b.align !== 'left') ? ' %%align:' + b.align + '%%' : '';

            switch (b.type) {
                case 'h1': content = '# ' + (b.content || ''); break;
                case 'h2': content = '## ' + (b.content || ''); break;
                case 'h3': content = '### ' + (b.content || ''); break;
                case 'task': content = (b.checked ? '- [x] ' : '- [ ] ') + (b.content || ''); break;
                case 'code': content = '```' + (b.language || 'plain') + '\n' + (b.content || '') + '\n```'; break;
                case 'divider': content = '---'; break;
                case 'image': content = '![' + (b.caption || '') + '](' + (b.url || b.content || '') + ')'; break;
                case 'table':
                    if (b.tableData) {
                        var td = b.tableData;
                        var md = '| ' + td.headers.map(function(h) { return h || ' '; }).join(' | ') + ' |\n';
                        var aligns = td.columnAligns || [];
                        var separators = td.headers.map(function(_, i) {
                            var align = aligns[i] || 'left';
                            if (align === 'center') return ':---:';
                            if (align === 'right') return '---:';
                            return ':---';
                        });
                        md += '| ' + separators.join(' | ') + ' |\n';
                        td.rows.forEach(function(row) {
                            var cells = row.map(function(cell) { return cell || ' '; });
                            md += '| ' + cells.join(' | ') + ' |\n';
                        });
                        content = md.trim();
                    }
                    else content = ''; // Fallback
                    break;
                case 'kanban_ref':
                    if (b.boardId) {
                        var boards = State.BOARDS || [];
                        var board = boards.find(function(bd) { return bd.id === b.boardId; });
                        if (board) {
                            var totalCards = board.columns.reduce(function(sum, col) { return sum + col.cards.length; }, 0);
                            content = '%%KANBAN:' + board.id + ':' + b.id + ':' + board.title + ':' + board.columns.length + ':' + totalCards + '%%';
                        } else {
                            content = '[[KANBAN:' + b.boardId + ']]';
                        }
                    }
                    break;
                default: 
                    // bullet/numbered/quote/p
                    if (b.type === 'bullet') content = '- ' + (b.content || '');
                    else if (b.type === 'numbered') content = listCounter + '. ' + (b.content || '');
                    else if (b.type === 'quote') content = '> ' + (b.content || '');
                    else content = b.content || '';
            }
            return prefix + content + suffix;
        }).join('\n');
    }
};
