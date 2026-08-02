import { State } from './Store.js';
import { saveData } from './Storage.js';



export const MetadataCache = {
    // In-memory index: Map<noteId, metadata>
    index: new Map(),
    
    // Reverse indexes for fast lookups
    tagIndex: new Map(),      // Map<tag, Set<noteId>>
    linkIndex: new Map(),     // Map<targetTitle, Set<noteId>> - who links to what
    backlinks: new Map(),     // Map<noteId, Set<noteId>> - who links to this note
    
    initialized: false,

    // Save-path lever: debounce the full-index localStorage write so rapid
    // per-keystroke saves coalesce into one write instead of re-serializing
    // the whole tag/link/backlink index every time.
    _cacheDirty: false,
    _cacheTimer: null,
    CACHE_SAVE_DEBOUNCE_MS: 15000,

    
    init: function() {
        if (this.initialized) return;

        if (!State.NOTES || !Array.isArray(State.NOTES)) {
            console.warn('[MetadataCache] No notes found');
            return;
        }

        var startTime = Date.now();

        // Save-path lever: prefer the persisted cache when it matches the
        // current vault fingerprint — one JSON.parse instead of re-running
        // regex parsing over every note on every new-tab boot. Falls back to
        // a full rebuild when the vault changed or the cache is corrupt.
        if (this.loadCache()) {
            this.initialized = true;
            console.log(`[MetadataCache] Loaded ${this.index.size} notes from cache in ${Date.now() - startTime}ms`);
        } else {
            // Build index for all notes
            State.NOTES.forEach(note => {
                this.updateNote(note.id, false); // Don't save on init
            });
            // Persist the fresh rebuild so the next boot can load it.
            this.saveCache();
            this.initialized = true;
            console.log(`[MetadataCache] Indexed ${State.NOTES.length} notes in ${Date.now() - startTime}ms`);
        }

        // Flush the debounced cache write when the tab closes so the next
        // boot can load it instead of rebuilding.
        if (typeof window !== 'undefined' && window.addEventListener) {
            var self = this;
            window.addEventListener('beforeunload', function() {
                self._flushCache();
            });
        }
    },
    
    
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
    
    
    updateNote: function(noteId, shouldSave = true) {
        if (!noteId) return null;
        
        var note = State.getNote(noteId);
        if (!note) {
            // Note was deleted, remove from cache
            this.removeNote(noteId);
            return null;
        }
        
        // Build full content from blocks + canvas node body content
        var fullContent = note.content || '';
        if (note.blocks && note.blocks.length > 0) {
            fullContent = note.blocks.map(b => b.content || '').join('\n');
        }
        // Include canvas node body content for tag indexing
        if (note.canvasData && note.canvasData.nodes && note.canvasData.nodes.length > 0) {
            var canvasTexts = note.canvasData.nodes.map(function(n) {
                return (n.body || n.title || '') + ' ' + (n.tags ? '#' + n.tags.join(' #') : '');
            }).join('\n');
            fullContent += '\n' + canvasTexts;
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
            // Coalesce full-index persistence instead of writing on every update.
            this._markCacheDirty();
        }
        
        return metadata;
    },
    
    
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
        // IMPORTANT: link targets are stored lowercased in linkIndex (by updateLinkIndex)
        // so we MUST lowercase when looking up for cleanup
        if (metadata.links) {
            metadata.links.forEach(link => {
                var target = link.target.toLowerCase();
                if (this.linkIndex.has(target)) {
                    this.linkIndex.get(target).delete(noteId);
                    if (this.linkIndex.get(target).size === 0) {
                        this.linkIndex.delete(target);
                    }
                }
            });
        }
        
        // Remove the note's own backlinks entry first
        this.backlinks.delete(noteId);
        // Then remove this note's ID from all other notes' backlink sets
        // Without this, backlinks.get('otherNoteId') would still contain the
        // deleted note's ID as a stale reference, leaking memory.
        this.backlinks.forEach((noteSet, targetNoteId) => {
            noteSet.delete(noteId);
            if (noteSet.size === 0) {
                this.backlinks.delete(targetNoteId);
            }
        });
        
        // Remove from main index
        this.index.delete(noteId);
        
        this._markCacheDirty();
    },
    
    
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
    
    
    updateLinkIndex: function(noteId, links) {
        // Clear old links for this note
        this.linkIndex.forEach((noteSet, target) => {
            noteSet.delete(noteId);
            if (noteSet.size === 0) {
                this.linkIndex.delete(target);
            }
        });
        
        // Remove only THIS note's backlinks, not all backlinks
        this.backlinks.forEach((noteSet, targetNoteId) => {
            noteSet.delete(noteId);
            if (noteSet.size === 0) {
                this.backlinks.delete(targetNoteId);
            }
        });
        
        // Add new links
        links.forEach(link => {
            var target = link.target.toLowerCase();
            if (!this.linkIndex.has(target)) {
                this.linkIndex.set(target, new Set());
            }
            this.linkIndex.get(target).add(noteId);
            
            // Find target note and update backlinks (O(1) title map lookup)
            var targetNote = State.getNoteByTitle(target);
            if (targetNote) {
                if (!this.backlinks.has(targetNote.id)) {
                    this.backlinks.set(targetNote.id, new Set());
                }
                this.backlinks.get(targetNote.id).add(noteId);
            }
        });
    },
    
    
    get: function(noteId) {
        return this.index.get(noteId) || null;
    },
    
    
    getByTag: function(tag) {
        var noteIds = this.tagIndex.get(tag.toLowerCase()) || new Set();
        return Array.from(noteIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    
    getBacklinks: function(noteId) {
        var backlinkIds = this.backlinks.get(noteId) || new Set();
        return Array.from(backlinkIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    
    getLinkingNotes: function(title) {
        var noteIds = this.linkIndex.get(title.toLowerCase()) || new Set();
        return Array.from(noteIds).map(id => this.index.get(id)).filter(Boolean);
    },
    
    
    getAllTags: function() {
        var tagCounts = {};
        this.tagIndex.forEach((noteSet, tag) => {
            tagCounts[tag] = noteSet.size;
        });
        return tagCounts;
    },
    
    
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
    
    
    query: function(propertyKey, propertyValue) {
        var results = [];
        
        this.index.forEach(metadata => {
            if (metadata.frontmatter[propertyKey] === propertyValue) {
                results.push(metadata);
            }
        });
        
        return results;
    },
    
    
    _notesFingerprint: function() {
        var notes = State.NOTES || [];
        var n = notes.length;
        var maxMod = 0;
        var acc = 0;
        for (var i = 0; i < n; i++) {
            var note = notes[i];
            if (!note) continue;
            var m = note.modified || note.created || 0;
            if (m > maxMod) maxMod = m;
            var id = note.id || '';
            for (var j = 0; j < id.length; j++) {
                acc = (acc * 31 + id.charCodeAt(j)) | 0;
            }
        }
        return n + ':' + maxMod + ':' + (acc >>> 0);
    },

    
    _markCacheDirty: function() {
        this._cacheDirty = true;
        if (this._cacheTimer) return;
        var self = this;
        this._cacheTimer = setTimeout(function() {
            self._cacheTimer = null;
            if (self._cacheDirty) {
                self._cacheDirty = false;
                self.saveCache();
            }
        }, this.CACHE_SAVE_DEBOUNCE_MS);
    },

    
    _flushCache: function() {
        if (this._cacheTimer) {
            clearTimeout(this._cacheTimer);
            this._cacheTimer = null;
        }
        if (this._cacheDirty) {
            this._cacheDirty = false;
            this.saveCache();
        }
    },

    
    saveCache: function() {
        // Convert Maps to objects for JSON serialization
        var cacheData = {
            version: 2,
            timestamp: Date.now(),
            fingerprint: this._notesFingerprint(),
            index: {},
            tagIndex: {},
            linkIndex: {},
            backlinks: {}
        };

        // v2: persist the main metadata index too, so a boot can load the
        // full index without re-running per-note parsing.
        this.index.forEach((metadata, noteId) => {
            cacheData.index[noteId] = metadata;
        });
        
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
    
    
    loadCache: function() {
        try {
            var cached = localStorage.getItem('VINLAND_METADATA_CACHE');
            if (!cached) return false;
            
            var cacheData = JSON.parse(cached);
            if (!cacheData || cacheData.version !== 2) return false;

            // Staleness guard: if the vault changed since this cache was
            // written (edited without updateNote, imported, restored, etc.),
            // a full rebuild is required.
            if (cacheData.fingerprint !== this._notesFingerprint()) return false;

            // Reconstruct Maps from objects
            this.index = new Map(Object.entries(cacheData.index || {}));
            
            Object.entries(cacheData.tagIndex || {}).forEach(([tag, noteIds]) => {
                this.tagIndex.set(tag, new Set(noteIds));
            });
            
            Object.entries(cacheData.linkIndex || {}).forEach(([target, noteIds]) => {
                this.linkIndex.set(target, new Set(noteIds));
            });
            
            Object.entries(cacheData.backlinks || {}).forEach(([noteId, noteIds]) => {
                this.backlinks.set(noteId, new Set(noteIds));
            });
            
            return true;
        } catch (e) {
            console.warn('[MetadataCache] Failed to load cache:', e);
            return false;
        }
    },
    
    
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
