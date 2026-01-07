#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/**
 * Parse JSONL transcript file and extract actual token usage from API responses
 * Returns the most recent cumulative token count (API returns cumulative values)
 */
function parseTranscriptForTokens(transcriptPath) {
    try {
        const fileStats = fs.statSync(transcriptPath);
        const MAX_READ_SIZE = 100 * 1024; // 100KB

        let content;
        if (fileStats.size > MAX_READ_SIZE) {
            // Read only the last 100KB for performance
            // Since we only need the most recent usage data (API returns cumulative counts),
            // reading the tail of the file is sufficient
            const fd = fs.openSync(transcriptPath, 'r');
            try {
                const buffer = Buffer.alloc(MAX_READ_SIZE);
                fs.readSync(fd, buffer, 0, MAX_READ_SIZE, fileStats.size - MAX_READ_SIZE);
                content = buffer.toString('utf8');
            } finally {
                fs.closeSync(fd);
            }
            // Skip first line as it may be partial due to starting mid-file
            const firstNewline = content.indexOf('\n');
            if (firstNewline !== -1) {
                content = content.substring(firstNewline + 1);
            }
        } else {
            content = fs.readFileSync(transcriptPath, 'utf8');
        }

        const lines = content.trim().split('\n');

        let lastUsage = null;

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const entry = JSON.parse(line);

                // Skip sidechain entries (subagent operations have their own context)
                if (entry.is_sidechain || entry.sidechain) continue;

                // Look for usage data in the entry
                if (entry.usage) {
                    lastUsage = entry.usage;
                }
                // Also check nested message.usage pattern
                if (entry.message?.usage) {
                    lastUsage = entry.message.usage;
                }
            } catch {
                // Skip malformed lines
            }
        }

        if (lastUsage) {
            // Use input_tokens as the total context size
            // Note: cache_read_input_tokens and cache_creation_input_tokens are for
            // billing/performance tracking, not additional tokens. input_tokens represents
            // the full prompt context sent to the model.
            const inputTokens = lastUsage.input_tokens || 0;
            return {
                actualTokens: inputTokens,
                tokenSource: 'api'
            };
        }

        return null;
    } catch {
        return null;
    }
}

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

        // Read existing stats to preserve compaction info
        let existingStats = {};
        if (fs.existsSync(statsPath)) {
            try {
                existingStats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            } catch {
                // Ignore parse errors
            }
        }

        // Try to get actual token count from JSONL parsing
        let actualTokens = null;
        let tokenSource = 'estimated';
        let transcriptChars = 0;

        if (data.transcript_path && fs.existsSync(data.transcript_path)) {
            try {
                const transcriptFileStats = fs.statSync(data.transcript_path);
                transcriptChars = transcriptFileStats.size;

                // Parse JSONL for actual token usage
                const parsed = parseTranscriptForTokens(data.transcript_path);
                if (parsed) {
                    actualTokens = parsed.actualTokens;
                    tokenSource = parsed.tokenSource;
                }
            } catch {
                // Ignore errors reading transcript
            }
        }

        // Estimate tokens as fallback (chars / 4 is a common approximation)
        const estimatedTokens = Math.round(transcriptChars / 4);

        // Write stats (include both actual and estimated tokens)
        const statsData = {
            sessionId: data.session_id || null,
            transcriptPath: data.transcript_path || null,
            transcriptChars,
            actualTokens,
            estimatedTokens,
            tokenSource,
            lastTool: data.tool_name || 'unknown',
            updatedAt: new Date().toISOString(),
            // Preserve compaction info from previous stats
            compactedAt: existingStats.compactedAt || null,
            compactionType: existingStats.compactionType || null,
            compactedSessionId: existingStats.compactedSessionId || null
        };

        fs.writeFileSync(statsPath, JSON.stringify(statsData, null, 2));

    } catch (err) {
        // Silent fail
    }
    process.exit(0);
});
