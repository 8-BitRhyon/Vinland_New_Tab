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
     */
    search: function(query) {
        if (!query) return [];
        const q = query.toLowerCase().trim();
        
        // 1. Exact trigger match (for arguments)
        // e.g. "task buy milk" -> matches "task" command
        const triggerMatch = this.commands.find(c => q.startsWith(c.trigger + ' '));
        if (triggerMatch) return [triggerMatch];

        // 2. Fuzzy search titles/triggers
        return this.commands.filter(c => 
            c.trigger.includes(q) || 
            c.title.toLowerCase().includes(q)
        ).sort((a, b) => {
            // Prioritize startsWith
            const aStart = a.trigger.startsWith(q);
            const bStart = b.trigger.startsWith(q);
            if (aStart && !bStart) return -1;
            if (!aStart && bStart) return 1;
            return 0;
        });
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
