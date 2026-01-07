#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const projectDir = data.cwd || process.cwd();
        const statsPath = path.join(projectDir, '.cc', 'stats.json');

        // Ensure .cc directory exists
        const ccDir = path.dirname(statsPath);
        if (!fs.existsSync(ccDir)) {
            fs.mkdirSync(ccDir, { recursive: true });
        }

        // Read existing stats
        let stats = {};
        if (fs.existsSync(statsPath)) {
            try {
                stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            } catch {
                // Start fresh if parse fails
            }
        }

        // Mark that compaction is about to occur (PreCompact hook runs before compaction)
        stats.compactedAt = new Date().toISOString();
        stats.compactionType = data.trigger || 'unknown'; // 'auto' or 'manual'
        stats.compactedSessionId = data.session_id || null; // Track which session was compacted

        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    } catch (err) {
        // Silent fail
    }
    process.exit(0);
});
