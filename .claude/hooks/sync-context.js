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

        // Read transcript to estimate context size
        let transcriptChars = 0;
        if (data.transcript_path && fs.existsSync(data.transcript_path)) {
            try {
                const stats = fs.statSync(data.transcript_path);
                transcriptChars = stats.size;
            } catch (e) {
                // Ignore errors reading transcript
            }
        }

        // Estimate tokens (chars / 4 is a common approximation)
        const estimatedTokens = Math.round(transcriptChars / 4);

        // Write stats (include transcriptPath for direct reading fallback)
        const statsData = {
            sessionId: data.session_id || 'unknown',
            transcriptPath: data.transcript_path || null,
            transcriptChars,
            estimatedTokens,
            lastTool: data.tool_name || 'unknown',
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(statsPath, JSON.stringify(statsData, null, 2));

    } catch (err) {
        // Silent fail
    }
    process.exit(0);
});
