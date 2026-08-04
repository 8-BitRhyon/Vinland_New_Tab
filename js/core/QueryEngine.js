import { State } from './Store.js';
import { MetadataCache } from './MetadataCache.js';



export const QueryEngine = {
    
    
    execute: function(queryString) {
        if (!queryString || !queryString.trim()) {
            return { error: 'Empty query', results: [] };
        }
        
        try {
            var parsed = this.parse(queryString);
            if (parsed.error) return { error: parsed.error, results: [] };
            
            var results = this.run(parsed);
            return { results, parsed };
        } catch (e) {
            return { error: e.message, results: [] };
        }
    },
    
    
    parse: function(queryString) {
        queryString = queryString.trim();
        
        // Determine query type
        var type = 'LIST'; // Default
        if (queryString.match(/^TABLE/i)) type = 'TABLE';
        else if (queryString.match(/^TASK/i)) type = 'TASK';
        else if (queryString.match(/^COUNT/i)) type = 'COUNT';
        else if (queryString.match(/^LIST/i)) type = 'LIST';
        
        // Parse FROM clause
        var fromMatch = queryString.match(/FROM\s+([^\s]+(?:\s+OR\s+[^\s]+)*)/i);
        var fromSources = [];
        
        if (fromMatch) {
            var sources = fromMatch[1].split(/\s+OR\s+/i);
            sources.forEach(source => {
                source = source.trim();
                if (source.startsWith('#')) {
                    fromSources.push({ type: 'tag', value: source.substring(1) });
                } else if (source.startsWith('"') && source.endsWith('"')) {
                    fromSources.push({ type: 'path', value: source.slice(1, -1) });
                } else {
                    fromSources.push({ type: 'tag', value: source });
                }
            });
        }
        
        // Parse WHERE clause
        var whereClauses = [];
        var whereMatch = queryString.match(/WHERE\s+(.+?)(?:\s+(?:ORDER|LIMIT|$))/i);
        
        if (whereMatch) {
            var whereString = whereMatch[1];
            // Split by AND
            var conditions = whereString.split(/\s+AND\s+/i);
            
            conditions.forEach(condition => {
                condition = condition.trim();
                
                // Handle negation: !completed or NOT completed
                var negated = false;
                if (condition.startsWith('!') || condition.match(/^NOT\s+/i)) {
                    negated = true;
                    condition = condition.replace(/^!/, '').replace(/^NOT\s+/i, '').trim();
                }
                
                // Parse condition: property operator value
                var match = condition.match(/^([a-zA-Z0-9._-]+)\s*(=|!=|>|<|>=|<=|contains|in)\s*(.+)$/i);
                
                if (match) {
                    whereClauses.push({
                        property: match[1].trim(),
                        operator: match[2].trim().toLowerCase(),
                        value: this.parseValue(match[3].trim()),
                        negated: negated
                    });
                } else {
                    // Simple boolean property check
                    whereClauses.push({
                        property: condition,
                        operator: 'exists',
                        value: true,
                        negated: negated
                    });
                }
            });
        }
        
        // Parse SELECT fields (for TABLE queries)
        var selectFields = [];
        if (type === 'TABLE') {
            var selectMatch = queryString.match(/^TABLE\s+(.+?)\s+FROM/i);
            if (selectMatch) {
                selectFields = selectMatch[1].split(',').map(f => f.trim());
            }
        }
        
        // Parse ORDER BY
        var orderBy = null;
        var orderMatch = queryString.match(/ORDER\s+BY\s+([a-zA-Z0-9._-]+)(?:\s+(ASC|DESC))?/i);
        if (orderMatch) {
            orderBy = {
                field: orderMatch[1].trim(),
                direction: (orderMatch[2] || 'ASC').toUpperCase()
            };
        }
        
        // Parse LIMIT
        var limit = null;
        var limitMatch = queryString.match(/LIMIT\s+(\d+)/i);
        if (limitMatch) {
            limit = parseInt(limitMatch[1]);
        }
        
        return {
            type,
            from: fromSources,
            where: whereClauses,
            select: selectFields,
            orderBy,
            limit
        };
    },
    
    
    parseValue: function(valueStr) {
        valueStr = valueStr.trim();
        
        // String (quoted)
        if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
            (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
            return valueStr.slice(1, -1);
        }
        
        // Boolean
        if (valueStr === 'true') return true;
        if (valueStr === 'false') return false;
        
        // Number
        if (!isNaN(valueStr)) return parseFloat(valueStr);
        
        // Array
        if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
            return valueStr.slice(1, -1).split(',').map(v => this.parseValue(v.trim()));
        }
        
        // Default to string
        return valueStr;
    },
    
    
    run: function(query) {
        // Initialize MetadataCache if needed
        if (!MetadataCache.initialized) {
            MetadataCache.init();
        }
        
        // Step 1: Get candidate notes from FROM sources
        var candidates = this.getCandidates(query.from);
        
        // Step 2: Apply WHERE filters
        var filtered = this.applyFilters(candidates, query.where);
        
        // Step 3: Apply ORDER BY
        if (query.orderBy) {
            filtered = this.applySort(filtered, query.orderBy);
        }
        
        // Step 4: Apply LIMIT
        if (query.limit) {
            filtered = filtered.slice(0, query.limit);
        }
        
        // Step 5: Format results based on query type
        return this.formatResults(filtered, query);
    },
    
    
    getCandidates: function(sources) {
        if (!sources || sources.length === 0) {
            // No FROM clause - return all notes
            return State.NOTES.map(note => MetadataCache.get(note.id)).filter(Boolean);
        }
        
        var candidateSet = new Set();
        
        sources.forEach(source => {
            if (source.type === 'tag') {
                var tagged = MetadataCache.getByTag(source.value);
                tagged.forEach(metadata => candidateSet.add(metadata.id));
            } else if (source.type === 'path') {
                // Filter by path prefix
                State.NOTES.forEach(note => {
                    if (note.path && note.path.startsWith(source.value)) {
                        var metadata = MetadataCache.get(note.id);
                        if (metadata) candidateSet.add(metadata.id);
                    }
                });
            }
        });
        
        // Convert Set to array of metadata objects
        return Array.from(candidateSet).map(id => MetadataCache.get(id)).filter(Boolean);
    },
    
    
    applyFilters: function(candidates, whereClauses) {
        if (!whereClauses || whereClauses.length === 0) {
            return candidates;
        }
        
        return candidates.filter(metadata => {
            return whereClauses.every(clause => {
                var result = this.evaluateCondition(metadata, clause);
                return clause.negated ? !result : result;
            });
        });
    },
    
    
    evaluateCondition: function(metadata, clause) {
        var value = this.getPropertyValue(metadata, clause.property);
        
        switch (clause.operator) {
            case 'exists':
                return value !== undefined && value !== null;
            
            case '=':
            case '==':
                return this._equalsCoerced(value, clause.value);
            
            case '!=':
                return !this._equalsCoerced(value, clause.value);
            
            case '>':
                return value > clause.value;
            
            case '<':
                return value < clause.value;
            
            case '>=':
                return value >= clause.value;
            
            case '<=':
                return value <= clause.value;
            
            case 'contains':
                if (typeof value === 'string') {
                    return value.toLowerCase().includes(String(clause.value).toLowerCase());
                }
                if (Array.isArray(value)) {
                    return value.some(v => String(v).toLowerCase().includes(String(clause.value).toLowerCase()));
                }
                return false;
            
            case 'in':
                if (Array.isArray(clause.value)) {
                    return clause.value.includes(value);
                }
                return false;
            
            default:
                return false;
        }
    },

    // L2: explicit replacement for the old loose `==` — same useful behaviors
    // (number vs numeric-string, boolean passthrough) but with no silent
    // coercion of unrelated types. Equal types compare strictly; numbers and
    // numeric strings compare numerically; everything else must string-match.
    _equalsCoerced: function(a, b) {
        if (typeof a === typeof b) return a === b;
        // Number vs numeric string → compare numerically.
        if (typeof a === 'number' && typeof b === 'string') {
            return b.trim() !== '' && !isNaN(Number(b)) && a === Number(b);
        }
        if (typeof b === 'number' && typeof a === 'string') {
            return a.trim() !== '' && !isNaN(Number(a)) && Number(a) === b;
        }
        // Boolean vs 'true'/'false' string (frontmatter may store either).
        if (typeof a === 'boolean') return String(a) === b;
        if (typeof b === 'boolean') return a === String(b);
        // Arrays/objects: strict reference equality only (no deep coercion).
        return false;
    },
    
    
    getPropertyValue: function(metadata, property) {
        // Handle special properties
        if (property === 'file.name' || property === 'title') {
            return metadata.title;
        }
        if (property === 'file.path' || property === 'path') {
            return metadata.path;
        }
        if (property === 'file.tags' || property === 'tags') {
            return metadata.tags;
        }
        if (property === 'file.created' || property === 'created') {
            return metadata.created;
        }
        if (property === 'file.modified' || property === 'modified') {
            return metadata.modified;
        }
        if (property === 'wordCount') {
            return metadata.wordCount;
        }
        if (property === 'blockCount') {
            return metadata.blockCount;
        }
        
        // Check frontmatter
        if (metadata.frontmatter && metadata.frontmatter[property] !== undefined) {
            return metadata.frontmatter[property];
        }
        
        // Handle nested properties
        if (property.includes('.')) {
            var parts = property.split('.');
            var value = metadata;
            for (var i = 0; i < parts.length; i++) {
                if (value && typeof value === 'object') {
                    value = value[parts[i]];
                } else {
                    return undefined;
                }
            }
            return value;
        }
        
        return undefined;
    },
    
    
    applySort: function(results, orderBy) {
        return results.sort((a, b) => {
            var aVal = this.getPropertyValue(a, orderBy.field);
            var bVal = this.getPropertyValue(b, orderBy.field);
            
            if (aVal === undefined) return 1;
            if (bVal === undefined) return -1;
            
            var comparison = 0;
            if (aVal < bVal) comparison = -1;
            else if (aVal > bVal) comparison = 1;
            
            return orderBy.direction === 'DESC' ? -comparison : comparison;
        });
    },
    
    
    formatResults: function(results, query) {
        switch (query.type) {
            case 'LIST':
                return results.map(m => ({
                    id: m.id,
                    title: m.title,
                    path: m.path
                }));
            
            case 'TABLE':
                return results.map(m => {
                    var row = { id: m.id };
                    query.select.forEach(field => {
                        row[field] = this.getPropertyValue(m, field);
                    });
                    return row;
                });
            
            case 'TASK':
                // Return only notes with uncompleted tasks
                return results.filter(m => {
                    var note = State.getNote(m.id);
                    if (!note || !note.blocks) return false;
                    return note.blocks.some(b => b.type === 'task' && !b.checked);
                }).map(m => ({
                    id: m.id,
                    title: m.title,
                    tasks: this.getTasksFromNote(m.id)
                }));
            
            case 'COUNT':
                return { count: results.length };
            
            default:
                return results;
        }
    },
    
    
    getTasksFromNote: function(noteId) {
        var note = State.getNote(noteId);
        if (!note || !note.blocks) return [];
        
        return note.blocks
            .filter(b => b.type === 'task')
            .map(b => ({
                id: b.id,
                content: b.content,
                checked: b.checked,
                createdAt: b.createdAt,
                completedAt: b.completedAt
            }));
    },
    
    
    renderResults: function(results, queryType) {
        if (!results || results.length === 0) {
            return '<div class="query-empty">No results found</div>';
        }
        
        switch (queryType) {
            case 'LIST':
                return '<ul class="query-list">' +
                    results.map(r => 
                        '<li><a href="#" data-note-id="' + r.id + '">' + 
                        this.escapeHtml(r.title) + '</a></li>'
                    ).join('') +
                    '</ul>';
            
            case 'TABLE':
                if (results.length === 0) return '';
                var headers = Object.keys(results[0]).filter(k => k !== 'id');
                return '<table class="query-table">' +
                    '<thead><tr>' + 
                    headers.map(h => '<th>' + this.escapeHtml(h) + '</th>').join('') +
                    '</tr></thead><tbody>' +
                    results.map(row => 
                        '<tr>' + 
                        headers.map(h => '<td>' + this.escapeHtml(String(row[h] || '')) + '</td>').join('') +
                        '</tr>'
                    ).join('') +
                    '</tbody></table>';
            
            case 'TASK':
                return '<div class="query-tasks">' +
                    results.map(r =>
                        '<div class="task-group">' +
                        '<h4>' + this.escapeHtml(r.title) + '</h4>' +
                        '<ul>' +
                        r.tasks.map(t =>
                            '<li class="' + (t.checked ? 'completed' : '') + '">' +
                            this.escapeHtml(t.content) +
                            '</li>'
                        ).join('') +
                        '</ul></div>'
                    ).join('') +
                    '</div>';
            
            case 'COUNT':
                return '<div class="query-count">Count: ' + results.count + '</div>';
            
            default:
                return '<pre>' + JSON.stringify(results, null, 2) + '</pre>';
        }
    },
    
    
    escapeHtml: function(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Expose globally
if (typeof window !== 'undefined') {
    window.QueryEngine = QueryEngine;
}
