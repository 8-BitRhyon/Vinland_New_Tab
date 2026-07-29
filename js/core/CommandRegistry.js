/**
 * Compute fuzzy match score between a query and a target string.
 * Returns { score, matched } where matched is a boolean array aligned
 * with target chars indicating which positions matched the query.
 * Score is 0 when not all query chars can be matched in sequence.
 */
function _fuzzyMatch(query, target) {
    if (!query || !target) return { score: 0, matched: [] };
    const q = query.toLowerCase();
    const t = target.toLowerCase();

    // Exact match = perfect
    if (t === q) return { score: 100, matched: t.split('').map(function() { return true; }) };
    // Prefix match
    if (t.startsWith(q)) {
        var m = t.split('').map(function(_, i) { return i < q.length; });
        return { score: 90, matched: m };
    }
    // Substring match
    var subIdx = t.indexOf(q);
    if (subIdx !== -1) {
        var m = t.split('').map(function(_, i) { return i >= subIdx && i < subIdx + q.length; });
        return { score: 70, matched: m };
    }

    // Sequential char match (fuzzy)
    var qi = 0;
    var score = 0;
    var matched = [];
    var prevMatched = false;
    for (var i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) {
            matched[i] = true;
            // Bonus for consecutive chars (tight groups score higher)
            score += prevMatched ? 10 : 5;
            // Bonus for word boundary (start of string, after space/dash/underscore)
            if (i === 0 || t[i-1] === ' ' || t[i-1] === '-' || t[i-1] === '_') {
                score += 8;
            }
            prevMatched = true;
            qi++;
        } else {
            matched[i] = false;
            prevMatched = false;
        }
    }
    // Mark remaining unmatched positions
    for (; i < t.length; i++) matched[i] = false;

    if (qi === q.length) {
        // All chars consumed — score normalized by target length
        return { score: Math.max(1, score / Math.max(1, t.length) * 10), matched: matched };
    }
    return { score: 0, matched: [] };
}

export { _fuzzyMatch };

export const CommandRegistry = {
    commands: [],

    /**
     * Register a new command
     * @param {string} id - Unique ID (e.g. 'notes:create')
     * @param {string} title - Display name (e.g. 'Create New Note')
     * @param {string} trigger - Typed keyword (e.g. 'note')
     * @param {function} action - The function to run
     * @param {string} icon - Optional icon char/html
     * @param {string} hint - Optional syntax hint
     */
    register: function({ id, title, trigger, action, icon = '>', hint = '' }) {
        // Prevent duplicates
        if (this.commands.find(c => c.id === id)) return;
        
        this.commands.push({ id, title, trigger: trigger.toLowerCase(), action, icon, hint });
    },

    /**
     * Find commands matching the input
     * @param {string} query 
     * @returns {Array} Array of { command, score, matchField, matchedIndices }
     */
    search: function(query) {
        if (!query) return [];
        const q = query.toLowerCase().trim();
        
        // 1. Exact trigger match (for arguments)
        // e.g. "task buy milk" -> matches "task" command
        const triggerMatch = this.commands.find(c => q.startsWith(c.trigger + ' '));
        if (triggerMatch) return [{ command: triggerMatch, score: 100, matchField: 'trigger', matchedIndices: null, isExactArg: true }];

        // 2. Fuzzy search all commands against both trigger and title
        var results = [];
        for (var i = 0; i < this.commands.length; i++) {
            var cmd = this.commands[i];

            // Score against trigger
            var tScore = _fuzzyMatch(q, cmd.trigger);
            // Score against title
            var titleScore = _fuzzyMatch(q, cmd.title);

            var best = tScore.score >= titleScore.score ? tScore : titleScore;
            if (best.score > 0) {
                results.push({
                    command: cmd,
                    score: best.score,
                    matchField: tScore.score >= titleScore.score ? 'trigger' : 'title',
                    matchedIndices: best.matched
                });
            }
        }

        // Sort by score descending, then trigger length ascending (shorter = tighter match)
        results.sort(function(a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.command.trigger.length - b.command.trigger.length;
        });

        return results;
    },

    execute: function(id, args) {
        const cmd = this.commands.find(c => c.id === id);
        if (cmd && cmd.action) {
            cmd.action(args);
            return true;
        }
        return false;
    }
};
