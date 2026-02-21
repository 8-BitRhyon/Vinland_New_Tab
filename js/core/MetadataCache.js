import { State } from './Store.js';
import { saveData } from './Storage.js';

/* =========================================
   METADATA CACHE
   Phase 0: The "Database Brain"
   
   Provides fast metadata indexing for:
   - YAML frontmatter parsing
   - Tag extraction
   - Wiki link tracking
   - Properties/custom fields
   - Real-time cache updates
   ========================================= */

export const MetadataCache = {
    // In-memory index: Map<noteId, metadata>
    index: new Map(),
    
    // Reverse indexes for fast lookups
    tagIndex: new Map(),      // Map<tag, Set<noteId>>
    linkIndex: new Map(),     // Map<targetTitle, Set<noteId>> - who links to what
    backlinks: new Map(),     // Map<noteId, Set<noteId>> - who links to this note
    
    initialized: false,
    
    /**
     * Initialize the cache - build index from all notes
     */
    init: function() {
        if (this.initialized) return;
        
        console.log('[MetadataCache] Building index...');
        var startTime = Date.now();
        
        if (!State.NOTES || !Array.isArray(State.NOTES)) {
            console.warn('[MetadataCache] No notes found');
            return;
        }
        
        // Build index for all notes
        State.NOTES.forEach(note => {
            this.updateNote(note.id, false); // Don't save on init
        });
        
        var elapsed = Date.now() - startTime;
        console.log(`[MetadataCache] Indexed ${State.NOTES.length} notes in ${elapsed}ms`);
        
        this.initialized = true;
    },
    
    /**
     * Parse YAML frontmatter from content
     * Format:
     * ---
     * key: value
     * tags: [tag1, tag2]
     * status: Active
     * ---
     * Rest of content...
     */
    parseFrontmatter: function(content) {
        if (!content || typeof content !== 'string') return { frontmatter: {}, body: content || '' };
        
        var fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!fmMatch) return { frontmatter: {}, body: content };
        
        var fmText = fmMatch[1];
        var body = fmMatch[2];
        var frontmatter = {};
        
        // Parse YAML-like key: value pairs
        var lines = fmText.split('\n');
        lines.forEach(line => {
            var match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
            if (match) {
                var key = match[1].trim();
                var value = match[2].trim();
                
                // Handle arrays: [item1, item2]
                if (value.startsWith('[') && value.endsWith(']')) {
                    value = value.slice(1, -1).split(',').map(v => v.trim());
                }
                // Handle quoted strings
                else if ((value.startsWith('"') && value.endsWith('"')) || 
                         (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                // Handle booleans
                else if (value === 'true') value = true;
                else if (value === 'false') value = false;
                // Handle numbers
                else if (!isNaN(value)) value = parseFloat(value);
                
                frontmatter[key] = value;
            }
        });
        
        return { frontmatter, body };
    },
    
    /**
     * Extract tags from content (both #hashtags and frontmatter tags)
     */
    extractTags: function(content, frontmatter) {
        var tags = new Set();
        
        // Get tags from frontmatter
        if (frontmatter && frontmatter.tags) {
            var fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
            fmTags.forEach(tag => {
                if (typeof tag === 'string') {
                    tags.add(tag.replace(/^#/, '').toLowerCase());
                }
            });
        }
        
        // Extract #hashtags from content
        if (content) {
            var hashtagMatches = content.match(/#[\w-]+/g);
            if (hashtagMatches) {
                hashtagMatches.forEach(tag => {
                    tags.add(tag.replace(/^#/, '').toLowerCase());
                });
            }
        }
        
        return Array.from(tags);
    },
    
    /**
     * Extract wiki links [[Page]] or [[Page|Alias]]
     */
    extractWikiLinks: function(content) {
        if (!content) return [];
        
        var links = [];
        var regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
        var match;
        
        while ((match = regex.exec(content)) !== null) {
            links.push({
                target: match[1].trim(),
                alias: match[2] ? match[2].trim() : match[1].trim()
            });
        }
        
        return links;
    },
    
    /**
     * Update metadata for a specific note
     */
    updateNote: function(noteId, shouldSave = true) {
        if (!noteId) return null;
        
        var note = State.NOTES.find(n => n.id === noteId);
        if (!note) {
            // Note was deleted, remove from cache
            this.removeNote(noteId);
            return null;
        }
        
        // Build full content from blocks
        var fullContent = note.content || '';
        if (note.blocks && note.blocks.length > 0) {
            fullContent = note.blocks.map(b => b.content || '').join('\n');
        }
        
        // Parse frontmatter
        var { frontmatter, body } = this.parseFrontmatter(fullContent);
        
        // Extract tags
        var tags = this.extractTags(body, frontmatter);
        
        // Extract wiki links
        var links = this.extractWikiLinks(body);
        
        // Build metadata object
        var metadata = {
            id: noteId,
            title: note.title || 'Untitled',
            path: note.path || '/',
            frontmatter: frontmatter,
            tags: tags,
            links: links,
            created: note.created,
            modified: note.modified,
            wordCount: body.split(/\s+/).filter(w => w.length > 0).length,
            blockCount: note.blocks ? note.blocks.length : 0
        };
        
        // Update main index
        this.index.set(noteId, metadata);
        
        // Update tag index
        this.updateTagIndex(noteId, tags);
        
        // Update link index
        this.updateLinkIndex(noteId, links);
        
        if (shouldSave) {
            // Persist cache to localStorage (optional - you can skip this if rebuilding on load is fast enough)
            this.saveCache();
        }
        
        return metadata;
    },
    
    /**
     * Remove note from cache
     */
    removeNote: function(noteId) {
        if (!this.index.has(noteId)) return;
        
        var metadata = this.index.get(noteId);
        
        // Remove from tag index
        if (metadata.tags) {
            metadata.tags.forEach(tag => {
                if (this.tagIndex.has(tag)) {
                    this.tagIndex.get(tag).delete(noteId);
                    if (this.tagIndex.get(tag).size === 0) {
                        this.tagIndex.delete(tag);
                    }
                }
            });
        }
        
        // Remove from link index
        if (metadata.links) {
            metadata.links.forEach(link => {
                if (this.linkIndex.has(link.target)) {
                    this.linkIndex.get(link.target).delete(noteId);
                    if (this.linkIndex.get(link.target).size === 0) {
                        this.linkIndex.delete(link.target);
                    }
                }
            });
        }
        
        // Remove from backlinks
        this.backlinks.delete(noteId);
        
        // Remove from main index
        this.index.delete(noteId);
        
        this.saveCache();
    },
    
    /**
     * Update tag index
     */
    updateTagIndex: function(noteId, tags) {
        // First, remove old tags for this note
        this.tagIndex.forEach((noteSet, tag) => {
            noteSet.delete(noteId);
            if (noteSet.size === 0) {
                this.tagIndex.delete(tag);
            }
        });
        
        // Add new tags
        tags.forEach(tag => {
            if (!this.tagIndex.has(tag)) {
                this.tagIndex.set(tag, new Set());
            }
            this.tagIndex.get(tag).add(noteId);
        });
    },
    
    /**
     * Update link index and backlinks
     */
    updateLinkIndex: function(noteId, links) {
        // Clear old links for this note
        this.linkIndex.forEach((noteSet, target) => {
            noteSet.delete(noteId);
            if (noteSet.size === 0) {
                this.linkIndex.delete(target);
            }
        });
        
        // Rebuild backlinks
        this.backlinks.clear();
        
        // Add new links
        links.forEach(link => {
            var target = link.target.toLowerCase();
            if (!this.linkIndex.has(target)) {
                this.linkIndex.set(target, new Set());
            }
            this.linkIndex.get(target).add(noteId);
            
            // Find target note and update backlinks
            var targetNote = State.NOTES.find(n => 
                (n.title || '').toLowerCase() === target
            );
            if (targetNote) {
                if (!this.backlinks.has(targetNote.id)) {
                    this.backlinks.set(targetNote.id, new Set());
                }
                this.backlinks.get(targetNote.id).add(noteId);
            }
        });
    },
    
    /**
     * Get metadata for a note
     */
    get: function(noteId) {
        return this.index.get(noteId) || null;
    },
    
    /**
     * Get all notes with a specific tag
     */
    getByTag: function(tag) {
        var noteIds = this.tagIndex.get(tag.toLowerCase()) || new Set();
        return Array.from(noteIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    /**
     * Get all backlinks to a note
     */
    getBacklinks: function(noteId) {
        var backlinkIds = this.backlinks.get(noteId) || new Set();
        return Array.from(backlinkIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    /**
     * Get all notes linking to a specific title
     */
    getLinkingNotes: function(title) {
        var noteIds = this.linkIndex.get(title.toLowerCase()) || new Set();
        return Array.from(noteIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    /**
     * Get all tags across all notes
     */
    getAllTags: function() {
        var tagCounts = {};
        this.tagIndex.forEach((noteSet, tag) => {
            tagCounts[tag] = noteSet.size;
        });
        return tagCounts;
    },
    
    /**
     * Search notes by query (simple text search)
     */
    search: function(query) {
        if (!query || !query.trim()) return [];
        
        query = query.toLowerCase();
        var results = [];
        
        this.index.forEach(metadata => {
            var score = 0;
            
            // Title match (highest priority)
            if (metadata.title.toLowerCase().includes(query)) {
                score += 100;
            }
            
            // Tag match
            if (metadata.tags.some(tag => tag.includes(query))) {
                score += 50;
            }
            
            // Frontmatter match
            Object.values(metadata.frontmatter).forEach(value => {
                if (String(value).toLowerCase().includes(query)) {
                    score += 25;
                }
            });
            
            if (score > 0) {
                results.push({ metadata, score });
            }
        });
        
        return results.sort((a, b) => b.score - a.score).map(r => r.metadata);
    },
    
    /**
     * Query notes by frontmatter property
     */
    query: function(propertyKey, propertyValue) {
        var results = [];
        
        this.index.forEach(metadata => {
            if (metadata.frontmatter[propertyKey] === propertyValue) {
                results.push(metadata);
            }
        });
        
        return results;
    },
    
    /**
     * Save cache to localStorage (optional - for persistence)
     */
    saveCache: function() {
        // Convert Maps to objects for JSON serialization
        var cacheData = {
            version: 1,
            timestamp: Date.now(),
            tagIndex: {},
            linkIndex: {},
            backlinks: {}
        };
        
        this.tagIndex.forEach((noteSet, tag) => {
            cacheData.tagIndex[tag] = Array.from(noteSet);
        });
        
        this.linkIndex.forEach((noteSet, target) => {
            cacheData.linkIndex[target] = Array.from(noteSet);
        });
        
        this.backlinks.forEach((noteSet, noteId) => {
            cacheData.backlinks[noteId] = Array.from(noteSet);
        });
        
        try {
            localStorage.setItem('VINLAND_METADATA_CACHE', JSON.stringify(cacheData));
        } catch (e) {
            console.warn('[MetadataCache] Failed to save cache:', e);
        }
    },
    
    /**
     * Load cache from localStorage (optional)
     */
    loadCache: function() {
        try {
            var cached = localStorage.getItem('VINLAND_METADATA_CACHE');
            if (!cached) return false;
            
            var cacheData = JSON.parse(cached);
            
            // Reconstruct Maps from objects
            Object.entries(cacheData.tagIndex).forEach(([tag, noteIds]) => {
                this.tagIndex.set(tag, new Set(noteIds));
            });
            
            Object.entries(cacheData.linkIndex).forEach(([target, noteIds]) => {
                this.linkIndex.set(target, new Set(noteIds));
            });
            
            Object.entries(cacheData.backlinks).forEach(([noteId, noteIds]) => {
                this.backlinks.set(noteId, new Set(noteIds));
            });
            
            return true;
        } catch (e) {
            console.warn('[MetadataCache] Failed to load cache:', e);
            return false;
        }
    },
    
    /**
     * Get statistics about the cache
     */
    getStats: function() {
        return {
            totalNotes: this.index.size,
            totalTags: this.tagIndex.size,
            totalLinks: Array.from(this.linkIndex.values()).reduce((sum, set) => sum + set.size, 0),
            totalBacklinks: Array.from(this.backlinks.values()).reduce((sum, set) => sum + set.size, 0)
        };
    }
};

// Event listener integration
// Listen for note changes and update cache automatically
if (typeof window !== 'undefined') {
    window.MetadataCache = MetadataCache;
}
