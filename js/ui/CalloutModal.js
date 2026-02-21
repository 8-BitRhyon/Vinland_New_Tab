import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';
import { PageManager } from '../editor/PageManager.js';
import { BlockEditor } from '../editor/BlockEditor.js';

export const CalloutModal = {
    init: function() {
        console.log('[CalloutModal] Init called');
        // Create the modal DOM dynamically if it doesn't exist
        if (!document.getElementById('callout-edit-modal')) {
            const modalHtml = `
            <div id="callout-edit-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:22000; justify-content:center; align-items:center; backdrop-filter: blur(3px);">
                <div class="modal-content" style="background:var(--main-bg, #1a1a1a); border:1px solid var(--main-color, #00FF41); padding:20px; border-radius:8px; width:400px; max-width:90%; box-shadow:0 10px 40px rgba(0,0,0,0.9);">
                    <h3 style="margin-top:0; color:var(--main-color, #00FF41); border-bottom: 1px solid #333; padding-bottom: 10px;">Edit Callout</h3>
                    
                    <label style="display:block; margin-top:15px; color:#aaa; font-size:0.85rem; text-transform:uppercase; letter-spacing:1px;">Type</label>
                    <select id="callout-edit-type" class="config-input" style="width:100%; padding:8px 10px; margin-top:5px; background:#111; color:#fff; border:1px solid #444; border-radius: 4px; outline:none; height: 38px; box-sizing: border-box; font-size: 14px;">
                        <option value="info">ℹ️ Info</option>
                        <option value="warning">⚠️ Warning</option>
                        <option value="danger">🛑 Danger</option>
                        <option value="success">✅ Success</option>
                        <option value="note">📝 Note</option>
                        <option value="tip">💡 Tip</option>
                        <option value="quote">💬 Quote</option>
                    </select>

                    <label style="display:block; margin-top:15px; color:#aaa; font-size:0.85rem; text-transform:uppercase; letter-spacing:1px;">Title (Optional)</label>
                    <input type="text" id="callout-edit-title" class="config-input" style="width:100%; padding:10px; margin-top:5px; background:#111; color:#fff; border:1px solid #444; border-radius: 4px; outline:none;" placeholder="e.g., Important Update">

                    <label style="display:block; margin-top:15px; color:#aaa; font-size:0.85rem; text-transform:uppercase; letter-spacing:1px;">Content</label>
                    <textarea id="callout-edit-content" class="config-input" rows="5" style="width:100%; padding:10px; margin-top:5px; background:#111; color:#fff; border:1px solid #444; border-radius: 4px; font-family:inherit; resize:vertical; outline:none;"></textarea>

                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:25px;">
                        <button id="callout-edit-cancel" style="padding:8px 16px; background:transparent; border:1px solid #666; color:#ccc; border-radius:4px; cursor:pointer; transition: all 0.2s;">Cancel</button>
                        <button id="callout-edit-save" style="padding:8px 16px; background:var(--main-color, #00FF41); border:none; color:#000; font-weight:bold; border-radius:4px; cursor:pointer; box-shadow: 0 0 10px rgba(var(--main-color-rgb), 0.3);">Save Changes</button>
                    </div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // Bind Events
            document.getElementById('callout-edit-cancel').onclick = () => this.close();
            document.getElementById('callout-edit-save').onclick = () => this.save();
            
            // Close when clicking the dark background overlay
            document.getElementById('callout-edit-modal').addEventListener('mousedown', (e) => {
                if (e.target.id === 'callout-edit-modal') this.close();
            });
        }
        
        // Expose globally so BlockEditor can trigger it via window.CalloutModal
        window.CalloutModal = this; 
        console.log('[CalloutModal] Exposed globally as window.CalloutModal');
    },

    open: function(blockId) {
        console.log('[CalloutModal] Open requested for', blockId);
        this.currentBlockId = blockId;
        
        // Fetch current block data from State
        const page = State.NOTES.find(n => n.id === BlockEditor.activePageId);
        if (!page) return;
        const block = page.blocks.find(b => b.id === blockId);
        if (!block) return;

        // Extract values
        let cType = (block.calloutType || 'info').toLowerCase();
        let cTitle = block.calloutTitle || '';
        let cContent = block.content || '';

        // Safely strip the Obsidian [!type] markdown header and blockquote prefixes
        if (cContent) {
            const cLines = cContent.split('\n').map(l => l.replace(/^>\s?/, ''));
            if (cLines[0] && cLines[0].match(/^\[!\w+\]/)) {
                cContent = cLines.slice(1).join('\n').trim();
                // Extract title if it was stored inside the markdown string rather than the prop
                if (!cTitle) cTitle = cLines[0].replace(/^\[!\w+\]\s*/, '').trim();
            } else {
                cContent = cLines.join('\n'); // Join what's left
            }
        }

        // Populate fields
        document.getElementById('callout-edit-type').value = cType;
        document.getElementById('callout-edit-title').value = cTitle;
        document.getElementById('callout-edit-content').value = cContent;

        // Show Modal
        document.getElementById('callout-edit-modal').style.display = 'flex';
        document.getElementById('callout-edit-content').focus();
    },

    close: function() {
        document.getElementById('callout-edit-modal').style.display = 'none';
        this.currentBlockId = null;
    },

    save: function() {
        if (!this.currentBlockId) return;

        const newType = document.getElementById('callout-edit-type').value;
        const newTitle = document.getElementById('callout-edit-title').value.trim();
        const newContent = document.getElementById('callout-edit-content').value.trim();

        // 1. Format as strict Obsidian Markdown so export/preview mode works flawlessly
        let markdownContent = `[!${newType}]`;
        if (newTitle) markdownContent += ` ${newTitle}`;
        markdownContent += `\n${newContent}`;

        // 2. Update the block properties via PageManager
        PageManager.updateBlock(BlockEditor.activePageId, this.currentBlockId, {
            type: 'callout',
            calloutType: newType,
            calloutTitle: newTitle,
            content: markdownContent
        });

        // 3. Sync data string, save to disk, and visually re-render the block
        PageManager.syncContent(BlockEditor.activePageId);
        saveData();
        BlockEditor.render(BlockEditor.activePageId);

        this.close();
    }
};
