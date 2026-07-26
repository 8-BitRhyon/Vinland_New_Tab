import { State } from '../core/Store.js';
import { saveData } from '../core/Storage.js';

/* =========================================
   OBSIDIAN VAULT IMPORTER
   =========================================
   Imports .md files from an Obsidian vault:
   - YAML frontmatter parsing
   - Tag extraction (#hashtags + frontmatter tags)
   - Wiki link ([[Page]]) extraction
   - Preserves filename as title
   ========================================= */

export const ObsidianImporter = {
    importInProgress: false,
    totalImported: 0,
    errors: [],

    /* ── CLI Entry Point ──────────────────── */

    /**
     * Opens the file picker for .md files.
     * Called by the `obsidian-import` CLI command.
     */
    openFilePicker: function() {
        var input = document.getElementById('obsidian-import-file');
        if (!input) {
            // Create the file input if it doesn't exist
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'obsidian-import-file';
            input.accept = '.md';
            input.multiple = true;
            input.style.display = 'none';
            document.body.appendChild(input);
        }

        // Always re-wire the change listener (handles case where input pre-exists in HTML)
        // Remove old listener first to avoid duplicates
        input.removeEventListener('change', ObsidianImporter._onFilesSelected);
        input.addEventListener('change', ObsidianImporter._onFilesSelected);

        input.click();
    },

    /**
     * Handler bound to the file input change event.
     * Extracted as a named reference so removeEventListener works correctly.
     */
    _onFilesSelected: function(e) {
        ObsidianImporter.handleFiles(e.target.files);
        // Reset so the same file can be re-selected
        e.target.value = '';
    },

    /* ── File Handling ────────────────────── */

    /**
     * Process selected .md files.
     * Reads each file, parses frontmatter/content, and creates notes.
     */
    handleFiles: function(files) {
        if (!files || files.length === 0) {
            if (window.showNotification) {
                window.showNotification('OBSIDIAN_IMPORT // No files selected');
            }
            return;
        }

        this.importInProgress = true;
        this.totalImported = 0;
        this.errors = [];

        var total = files.length;
        var processed = 0;
        var self = this;

        Array.from(files).forEach(function(file) {
            var reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    var text = evt.target.result;
                    self._importMdFile(text, file.name);
                    processed++;
                    self._checkDone(processed, total);
                } catch (e) {
                    self.errors.push({ file: file.name, error: e.message });
                    processed++;
                    self._checkDone(processed, total);
                }
            };
            reader.onerror = function() {
                self.errors.push({ file: file.name, error: 'Failed to read file' });
                processed++;
                self._checkDone(processed, total);
            };
            reader.readAsText(file);
        });
    },

    /**
     * Check if all files have been processed and show summary.
     */
    _checkDone: function(processed, total) {
        if (processed >= total) {
            this.importInProgress = false;

            // Update MetadataCache so backlinks/tags are fresh
            if (window.MetadataCache && window.MetadataCache.init) {
                // Re-init to pick up new notes
                window.MetadataCache.initialized = false;
                window.MetadataCache.init();
            }

            // Show notification
            var msg = 'OBSIDIAN_IMPORT // ' + this.totalImported + ' note' +
                (this.totalImported !== 1 ? 's' : '') + ' imported';
            if (this.errors.length > 0) {
                msg += ' (' + this.errors.length + ' error' +
                    (this.errors.length !== 1 ? 's' : '') + ')';
            }
            if (window.showNotification) {
                window.showNotification(msg);
            }

            // Refresh sidebar to show new notes
            if (window.Notes && window.Notes.renderSidebar) {
                window.Notes.renderSidebar();
            }
            if (window.Notes && window.Notes.renderNotes) {
                window.Notes.renderNotes();
            }

            console.log('[ObsidianImporter] Complete:', this.totalImported, 'imported,', this.errors.length, 'errors');
            if (this.errors.length > 0) {
                console.warn('[ObsidianImporter] Errors:', this.errors);
            }
        }
    },

    /* ── Single File Import ───────────────── */

    /**
     * Parse a single .md file and create a note from it.
     */
    _importMdFile: function(text, filename) {
        if (!text || !text.trim()) return;

        // Parse frontmatter
        var parsed = this._parseContent(text);

        // Extract title from filename (strip .md extension)
        var title = this._titleFromFilename(filename);

        // If frontmatter has a 'title' field, use that instead
        if (parsed.frontmatter && parsed.frontmatter.title) {
            title = String(parsed.frontmatter.title).trim();
        }

        // Build the note
        var now = Date.now();
        var newNote = {
            id: 'note_' + now + '_' + Math.random().toString(36).substring(2, 8),
            title: title,
            content: parsed.content,
            path: '/',
            tags: parsed.tags, // Store tags directly on the note
            links: parsed.links,
            created: now,
            modified: now,
            frontmatter: parsed.frontmatter // Preserve raw frontmatter
        };

        // Add to state (unshift so most recent is first)
        State.NOTES.unshift(newNote);
        this.totalImported++;

        // Persist immediately
        saveData();
    },

    /**
     * Parse .md content: extract YAML frontmatter, tags, wiki links.
     * Returns { frontmatter, body, content, tags, links }
     */
    _parseContent: function(text) {
        var frontmatter = {};
        var body = text;

        // Extract YAML frontmatter (--- delimited)
        var fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (fmMatch) {
            var fmText = fmMatch[1];
            body = fmMatch[2];

            // Parse YAML-like key: value pairs
            var lines = fmText.split('\n');
            lines.forEach(function(line) {
                var match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
                if (match) {
                    var key = match[1].trim();
                    var value = match[2].trim();

                    // Handle arrays: [item1, item2]
                    if (value.startsWith('[') && value.endsWith(']')) {
                        value = value.slice(1, -1).split(',').map(function(v) { return v.trim(); });
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
        }

        // Extract tags from frontmatter
        var tags = [];
        if (frontmatter.tags) {
            var fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
            fmTags.forEach(function(tag) {
                if (typeof tag === 'string') {
                    var clean = tag.replace(/^#/, '').toLowerCase();
                    if (tags.indexOf(clean) === -1) tags.push(clean);
                }
            });
        }

        // Extract #hashtags from body
        var hashtagMatches = body.match(/#[\w-]+/g);
        if (hashtagMatches) {
            hashtagMatches.forEach(function(tag) {
                var clean = tag.replace(/^#/, '').toLowerCase();
                if (tags.indexOf(clean) === -1) tags.push(clean);
            });
        }

        // Extract [[wiki links]] from body
        var links = [];
        var linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
        var match;
        while ((match = linkRegex.exec(body)) !== null) {
            links.push({
                target: match[1].trim(),
                alias: match[2] ? match[2].trim() : match[1].trim()
            });
        }

        // Trim leading/trailing whitespace from body for cleaner content
        body = body.trim();

        return {
            frontmatter: frontmatter,
            body: body,
            content: text, // Preserve original content (including frontmatter)
            tags: tags,
            links: links
        };
    },

    /**
     * Extract a display title from a filename.
     * Strips .md extension and replaces dashes/underscores with spaces.
     */
    _titleFromFilename: function(filename) {
        if (!filename) return 'Untitled';
        var name = filename;
        // Strip .md extension
        if (name.toLowerCase().endsWith('.md')) {
            name = name.slice(0, -3);
        }
        // Replace dashes and underscores with spaces for better readability
        name = name.replace(/[-_]/g, ' ');
        // Capitalize first letter of each word
        name = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        return name.trim();
    }
};
