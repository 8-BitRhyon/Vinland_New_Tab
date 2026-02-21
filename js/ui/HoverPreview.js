import { State } from '../core/Store.js';
import { MetadataCache } from '../core/MetadataCache.js';
import { safeText } from '../core/Utils.js';

export const HoverPreview = {
    
    /**
     * Initialize Hover Previews
     */
    init: function() {
        console.log('[HoverPreview] Initializing...');
        this.setupHoverPreviews();
        this.injectStyles();
    },

    /**
     * Setup hover preview interactions for wiki links
     */
    setupHoverPreviews: function() {
        var self = this;
        var previewTimeout = null;
        var previewEl = null;
        
        // Create preview element
        function createPreviewElement() {
            var el = document.createElement('div');
            el.className = 'hover-preview';
            el.style.cssText = 'position: fixed; z-index: 30000; ' +
                'background: rgba(0, 0, 0, 0.95); ' +
                'border: 1px solid var(--main-color); ' +
                'border-radius: 4px; padding: 15px; ' +
                'max-width: 400px; max-height: 300px; ' +
                'overflow-y: auto; display: none; ' +
                'box-shadow: 0 4px 20px rgba(0, 255, 65, 0.3); pointer-events: none;';
            document.body.appendChild(el);
            return el;
        }
        
        // Show preview
        function showPreview(linkEl, noteTitle) {
            clearTimeout(previewTimeout);
            
            previewTimeout = setTimeout(function() {
                if (!previewEl) {
                    previewEl = createPreviewElement();
                }
                
                // Find note by title
                var note = State.NOTES.find(function(n) {
                    return (n.title || '').toLowerCase() === noteTitle.toLowerCase();
                });
                
                if (!note) {
                    previewEl.innerHTML = '<div style="color: #888;">Note not found: ' + 
                        safeText(noteTitle) + '</div>';
                } else {
                    // Get metadata
                    var metadata = MetadataCache.get(note.id);
                    
                    var html = '<div class="preview-header" style="color: var(--main-color); ' +
                        'font-weight: bold; margin-bottom: 10px; font-size: 16px;">' +
                        safeText(note.title) + '</div>';
                    
                    // Show metadata if available
                    if (metadata && metadata.tags.length > 0) {
                        html += '<div class="preview-tags" style="margin-bottom: 10px;">';
                        metadata.tags.forEach(function(tag) {
                            html += '<span style="color: #555; background: #222; ' +
                                'padding: 2px 6px; border-radius: 3px; font-size: 11px; ' +
                                'margin-right: 5px;">#' + safeText(tag) + '</span>';
                        });
                        html += '</div>';
                    }
                    
                    // Show preview of content
                    var preview = note.content || '';
                    if (note.blocks && note.blocks.length > 0) {
                        preview = note.blocks.slice(0, 3)
                            .map(function(b) { return b.content || ''; })
                            .join('\n');
                    }
                    
                    preview = preview.substring(0, 300);
                    if (preview.length >= 300) preview += '...';
                    
                    html += '<div class="preview-content" style="color: #ccc; ' +
                        'line-height: 1.6; font-size: 13px;">' +
                        safeText(preview) + '</div>';
                    
                    // Show word count
                    if (metadata) {
                        html += '<div class="preview-meta" style="margin-top: 10px; ' +
                            'color: #555; font-size: 11px;">' +
                            metadata.wordCount + ' words · ' +
                            metadata.blockCount + ' blocks</div>';
                    }
                    
                    previewEl.innerHTML = html;
                }
                
                // Position preview near link
                var rect = linkEl.getBoundingClientRect();
                previewEl.style.display = 'block';
                previewEl.style.left = (rect.left + window.scrollX) + 'px';
                previewEl.style.top = (rect.bottom + window.scrollY + 5) + 'px';
                
                // Adjust if off-screen
                setTimeout(function() {
                    var previewRect = previewEl.getBoundingClientRect();
                    if (previewRect.right > window.innerWidth) {
                        previewEl.style.left = (window.innerWidth - previewRect.width - 10) + 'px';
                    }
                    if (previewRect.bottom > window.innerHeight) {
                        previewEl.style.top = (rect.top + window.scrollY - previewRect.height - 5) + 'px';
                    }
                }, 10);
                
            }, 500); // 500ms delay
        }
        
        // Hide preview
        function hidePreview() {
            clearTimeout(previewTimeout);
            if (previewEl) {
                previewEl.style.display = 'none';
            }
        }
        
        // Attach to all wiki links
        document.addEventListener('mouseover', function(e) {
            var target = e.target;
            // Check if hovering over a wiki link
            if (target.classList && target.classList.contains('wiki-link')) {
                var noteTitle = target.getAttribute('data-note-title') || target.textContent;
                showPreview(target, noteTitle);
            }
        });
        
        document.addEventListener('mouseout', function(e) {
            var target = e.target;
            if (target.classList && target.classList.contains('wiki-link')) {
                hidePreview();
            }
        });
    },

    /**
     * Inject CSS styles for previews
     */
    injectStyles: function() {
        var style = document.createElement('style');
        style.textContent = `
            /* Wiki Links */
            .wiki-link {
                color: var(--main-color);
                border-bottom: 1px dashed var(--main-color);
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .wiki-link:hover {
                background: rgba(0, 255, 65, 0.1);
                text-shadow: 0 0 10px var(--main-color);
            }
            
            /* Hover Preview Scrollbar */
            .hover-preview::-webkit-scrollbar { width: 6px; }
            .hover-preview::-webkit-scrollbar-track { background: #111; }
            .hover-preview::-webkit-scrollbar-thumb { background: var(--main-color); border-radius: 3px; }
        `;
        document.head.appendChild(style);
    }
};

// Expose globally
if (typeof window !== 'undefined') {
    window.HoverPreview = HoverPreview;
}
