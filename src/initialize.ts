/**
 * Workspace initialization for CC HUD extension.
 *
 * ## Hook Script Management
 *
 * This file contains embedded hook scripts as string constants (LOG_ACTIVITY_HOOK,
 * SYNC_PLAN_HOOK, SYNC_CONTEXT_HOOK, PRE_COMPACT_HOOK). These constants are the
 * SOURCE OF TRUTH for hook scripts and are written to each project's `.claude/hooks/`
 * directory during initialization.
 *
 * The `.claude/hooks/` files in THIS repository (agent-panes) are just local copies
 * for this specific project - they are NOT the source for distribution. When updating
 * hook logic:
 *
 * 1. Update the embedded constant in this file (src/initialize.ts)
 * 2. Run the extension's "CC HUD: Initialize Workspace" command to update the local
 *    `.claude/hooks/` files, OR manually copy the changes
 * 3. Test the changes
 *
 * This approach ensures all users get the same hook scripts when they initialize
 * their workspaces, and avoids needing to bundle/read external files at runtime.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { defaultConfig } from './config';

// Type definitions for VS Code tasks.json
interface VsCodeTask {
    label: string;
    type: string;
    command: string;
    osx?: { command: string };
    linux?: { command: string };
    windows?: { command: string };
    problemMatcher: string[];
    presentation?: {
        reveal: string;
        panel: string;
    };
}

interface TasksJson {
    version: string;
    tasks: VsCodeTask[];
}

// Type definitions for Claude Code settings
interface HookCommand {
    type: string;
    command: string;
    timeout: number;
}

interface HookMatcher {
    matcher: string;
    hooks: HookCommand[];
}

interface HookEntry {
    hooks: HookCommand[];
}

interface ClaudeHooks {
    PostToolUse?: HookMatcher[];
    SessionStart?: HookEntry[];
    PreCompact?: HookEntry[];
}

interface ClaudeSettings {
    hooks?: ClaudeHooks;
}

const PLAN_TEMPLATE = `# Plan

## Objective
- [ ] (fill in objective)

## Steps
- [ ] Understand the existing codebase
- [ ] Implement required changes
  - [ ] Subtask A
  - [ ] Subtask B
- [ ] Add or update tests
- [ ] Run tests and fix failures
- [ ] Cleanup and finalize

## Notes
- (short notes only)
`;

const DEFAULT_CONTEXT = {
    items: []
};

/**
 * Hook script: logs tool activity to .cc/cc.log
 * SOURCE OF TRUTH - see module header for maintenance instructions.
 */
const LOG_ACTIVITY_HOOK = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const projectDir = data.cwd || process.cwd();
        const logPath = path.join(projectDir, '.cc', 'cc.log');

        // Ensure .cc directory exists
        const ccDir = path.dirname(logPath);
        if (!fs.existsSync(ccDir)) {
            fs.mkdirSync(ccDir, { recursive: true });
        }

        const timestamp = new Date().toLocaleTimeString();
        const toolName = data.tool_name || 'unknown';
        let logLine = '';

        // Format based on tool type
        if (toolName === 'Read') {
            const filePath = data.tool_input?.file_path || '';
            logLine = \`[\${timestamp}] Read: \${filePath}\\n\`;
        } else if (toolName === 'Write') {
            const filePath = data.tool_input?.file_path || '';
            logLine = \`[\${timestamp}] Write: \${filePath}\\n\`;
        } else if (toolName === 'Edit') {
            const filePath = data.tool_input?.file_path || '';
            logLine = \`[\${timestamp}] Edit: \${filePath}\\n\`;
        } else if (toolName === 'Bash') {
            const cmd = data.tool_input?.command || '';
            const shortCmd = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
            logLine = \`[\${timestamp}] Bash: \${shortCmd}\\n\`;
        } else if (toolName === 'Glob' || toolName === 'Grep') {
            const pattern = data.tool_input?.pattern || '';
            logLine = \`[\${timestamp}] \${toolName}: \${pattern}\\n\`;
        } else if (toolName === 'TodoWrite') {
            // Skip - handled by sync-plan.js
            process.exit(0);
        } else if (toolName === 'Task') {
            const desc = data.tool_input?.description || '';
            logLine = \`[\${timestamp}] Task: \${desc}\\n\`;
        } else {
            logLine = \`[\${timestamp}] \${toolName}\\n\`;
        }

        fs.appendFileSync(logPath, logLine);
    } catch (err) {
        // Silent fail
    }
    process.exit(0);
});
`;

/**
 * Hook script: syncs TodoWrite tool output to .cc/plan.md
 * Only updates the "## Current Tasks" section, preserving other content.
 * SOURCE OF TRUTH - see module header for maintenance instructions.
 */
const SYNC_PLAN_HOOK = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Read JSON input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);

        // Only process TodoWrite tool
        if (data.tool_name !== 'TodoWrite') {
            process.exit(0);
        }

        const todos = data.tool_input?.todos;
        if (!Array.isArray(todos)) {
            process.exit(0);
        }

        const projectDir = data.cwd || process.cwd();
        const planPath = path.join(projectDir, '.cc', 'plan.md');

        // Ensure .cc directory exists
        const ccDir = path.dirname(planPath);
        if (!fs.existsSync(ccDir)) {
            fs.mkdirSync(ccDir, { recursive: true });
        }

        // Convert todos to markdown format
        const statusMap = {
            'pending': '[ ]',
            'in_progress': '[>]',
            'completed': '[x]'
        };

        let tasksSection = '## Current Tasks\\n\\n';
        for (const todo of todos) {
            const checkbox = statusMap[todo.status] || '[ ]';
            tasksSection += \`- \${checkbox} \${todo.content}\\n\`;
        }

        // Read existing plan content
        let existingContent = '';
        if (fs.existsSync(planPath)) {
            existingContent = fs.readFileSync(planPath, 'utf8');
        }

        let newContent;

        // Pattern to find "## Current Tasks" section (until next ## or # or end of file)
        const tasksSectionRegex = /## Current Tasks[\\s\\S]*?(?=\\n## |\\n# |$)/;

        if (tasksSectionRegex.test(existingContent)) {
            // Replace existing "## Current Tasks" section
            newContent = existingContent.replace(tasksSectionRegex, tasksSection.trim());
        } else if (existingContent.trim()) {
            // Append section to existing content
            newContent = existingContent.trim() + '\\n\\n' + tasksSection;
        } else {
            // No existing content, create new file with default structure
            newContent = '# Plan\\n\\n## Objective\\n- (fill in objective)\\n\\n' + tasksSection + '\\n## Notes\\n- Auto-synced from Claude Code\\n';
        }

        fs.writeFileSync(planPath, newContent);

    } catch (err) {
        // Silent fail - don't break Claude Code
        console.error('CC HUD hook error:', err.message);
    }
    process.exit(0);
});
`;

/**
 * Hook script: syncs context/token stats to .cc/stats.json
 * Parses JSONL transcript for actual API token counts.
 * SOURCE OF TRUTH - see module header for maintenance instructions.
 */
const SYNC_CONTEXT_HOOK = `#!/usr/bin/env node
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
            const firstNewline = content.indexOf('\\n');
            if (firstNewline !== -1) {
                content = content.substring(firstNewline + 1);
            }
        } else {
            content = fs.readFileSync(transcriptPath, 'utf8');
        }

        const lines = content.trim().split('\\n');

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
            // Total context = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
            // - input_tokens: non-cached tokens processed this request
            // - cache_creation_input_tokens: tokens written to cache
            // - cache_read_input_tokens: tokens read from cache
            // All three together represent the full prompt context sent to the model.
            const inputTokens = (lastUsage.input_tokens || 0) +
                               (lastUsage.cache_creation_input_tokens || 0) +
                               (lastUsage.cache_read_input_tokens || 0);
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
`;

/**
 * Hook script: runs before context compaction
 * Records compaction events to .cc/stats.json.
 * SOURCE OF TRUTH - see module header for maintenance instructions.
 */
const PRE_COMPACT_HOOK = `#!/usr/bin/env node
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
    } catch {
        // Silent fail - don't break Claude Code
    }
    process.exit(0);
});
`;

// Claude Code hook configuration
const HOOK_SETTINGS: ClaudeSettings = {
    hooks: {
        PostToolUse: [
            {
                matcher: "TodoWrite",
                hooks: [
                    {
                        type: "command",
                        command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/sync-plan.js\"",
                        timeout: 10
                    }
                ]
            }
        ]
    }
};

export async function initialize(_context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('CC HUD: Please open a workspace folder first.');
        return;
    }

    const rootPath = workspaceFolder.uri.fsPath;

    try {
        // 1. Ensure .cc/ directory exists
        const ccDir = path.join(rootPath, '.cc');
        if (!fs.existsSync(ccDir)) {
            fs.mkdirSync(ccDir, { recursive: true });
        }

        // 2. Ensure .cc/context.json exists
        const contextPath = path.join(ccDir, 'context.json');
        if (!fs.existsSync(contextPath)) {
            fs.writeFileSync(contextPath, JSON.stringify(DEFAULT_CONTEXT, null, 2));
        }

        // 3. Ensure .cc/cc.log exists (empty file)
        const logPath = path.join(ccDir, 'cc.log');
        if (!fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }

        // 4. Ensure .cc/plan.md exists with template
        const planPath = path.join(ccDir, 'plan.md');
        if (!fs.existsSync(planPath)) {
            fs.writeFileSync(planPath, PLAN_TEMPLATE);
        }

        // 5. Ensure .vscode/ directory exists
        const vscodeDir = path.join(rootPath, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // 6. Create or merge .vscode/cc-hud.json
        const configPath = path.join(vscodeDir, 'cc-hud.json');
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        }

        // 7. Create or merge .vscode/tasks.json
        await mergeTasksJson(vscodeDir);

        // 8. Set up Claude Code hook for TodoWrite sync
        await setupClaudeHook(rootPath);

        vscode.window.showInformationMessage('CC HUD: Workspace initialized successfully!');

    } catch (error) {
        vscode.window.showErrorMessage(`CC HUD: Initialization failed - ${error}`);
    }
}

async function mergeTasksJson(vscodeDir: string): Promise<void> {
    const tasksPath = path.join(vscodeDir, 'tasks.json');

    const ccTask: VsCodeTask = {
        label: 'Claude Code (logged)',
        type: 'shell',
        command: '',
        osx: {
            command: "bash -lc 'claude 2>&1 | tee -a .cc/cc.log'"
        },
        linux: {
            command: "bash -lc 'claude 2>&1 | tee -a .cc/cc.log'"
        },
        windows: {
            command: 'powershell -NoProfile -Command "claude 2>&1 | Tee-Object -FilePath .cc\\cc.log -Append"'
        },
        problemMatcher: [],
        presentation: {
            reveal: 'always',
            panel: 'new'
        }
    };

    let tasksJson: TasksJson;

    if (fs.existsSync(tasksPath)) {
        try {
            const content = fs.readFileSync(tasksPath, 'utf8');
            tasksJson = JSON.parse(content) as TasksJson;

            // Check if task already exists
            const existingTask = tasksJson.tasks?.find(
                (t: VsCodeTask) => t.label === 'Claude Code (logged)'
            );

            if (existingTask !== undefined) {
                return; // Task already exists, don't modify
            }

            tasksJson.tasks ??= [];
            tasksJson.tasks.push(ccTask);
        } catch {
            // If parsing fails, create new file
            tasksJson = {
                version: '2.0.0',
                tasks: [ccTask]
            };
        }
    } else {
        tasksJson = {
            version: '2.0.0',
            tasks: [ccTask]
        };
    }

    fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 2));
}

async function setupClaudeHook(rootPath: string): Promise<void> {
    // 1. Create .claude/hooks/ directory
    const claudeDir = path.join(rootPath, '.claude');
    const hooksDir = path.join(claudeDir, 'hooks');

    if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
    }

    // 2. Write the hook scripts
    const syncPlanPath = path.join(hooksDir, 'sync-plan.js');
    fs.writeFileSync(syncPlanPath, SYNC_PLAN_HOOK);

    const logActivityPath = path.join(hooksDir, 'log-activity.js');
    fs.writeFileSync(logActivityPath, LOG_ACTIVITY_HOOK);

    const syncContextPath = path.join(hooksDir, 'sync-context.js');
    fs.writeFileSync(syncContextPath, SYNC_CONTEXT_HOOK);

    const preCompactPath = path.join(hooksDir, 'pre-compact.js');
    fs.writeFileSync(preCompactPath, PRE_COMPACT_HOOK);

    // Make executable on Unix systems
    try {
        fs.chmodSync(syncPlanPath, 0o755);
        fs.chmodSync(logActivityPath, 0o755);
        fs.chmodSync(syncContextPath, 0o755);
        fs.chmodSync(preCompactPath, 0o755);
    } catch {
        // Ignore chmod errors on Windows
    }

    // 3. Create or merge .claude/settings.local.json
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    let settings: ClaudeSettings = {};

    if (fs.existsSync(settingsPath)) {
        try {
            const content = fs.readFileSync(settingsPath, 'utf8');
            settings = JSON.parse(content) as ClaudeSettings;
        } catch {
            // If parsing fails, start fresh
            settings = {};
        }
    }

    // Merge hook settings
    settings.hooks ??= {};
    settings.hooks.PostToolUse ??= [];

    // Add sync-plan hook if not exists
    const existingSyncHook = settings.hooks.PostToolUse.find(
        (h: HookMatcher) => h.matcher === 'TodoWrite' &&
            h.hooks?.some((hook: HookCommand) => hook.command?.includes('sync-plan.js'))
    );

    if (existingSyncHook === undefined) {
        const syncPlanHook = HOOK_SETTINGS.hooks?.PostToolUse?.[0];
        if (syncPlanHook !== undefined) {
            settings.hooks.PostToolUse.push(syncPlanHook);
        }
    }

    // Add log-activity hook if not exists (matches all tools except TodoWrite)
    const existingLogHook = settings.hooks.PostToolUse.find(
        (h: HookMatcher) => h.hooks?.some((hook: HookCommand) => hook.command?.includes('log-activity.js'))
    );

    if (existingLogHook === undefined) {
        settings.hooks.PostToolUse.push({
            matcher: ".*",
            hooks: [
                {
                    type: "command",
                    command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-activity.js\"",
                    timeout: 5
                }
            ]
        });
    }

    // Add sync-context hook if not exists (matches all tools to track context usage)
    const existingContextHook = settings.hooks.PostToolUse.find(
        (h: HookMatcher) => h.hooks?.some((hook: HookCommand) => hook.command?.includes('sync-context.js'))
    );

    if (existingContextHook === undefined) {
        settings.hooks.PostToolUse.push({
            matcher: ".*",
            hooks: [
                {
                    type: "command",
                    command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/sync-context.js\"",
                    timeout: 5
                }
            ]
        });
    }

    // Add SessionStart hook for sync-context (captures context on session start/resume)
    settings.hooks.SessionStart ??= [];
    const existingSessionStartHook = settings.hooks.SessionStart.find(
        (h: HookEntry) => h.hooks?.some((hook: HookCommand) => hook.command?.includes('sync-context.js'))
    );

    if (existingSessionStartHook === undefined) {
        settings.hooks.SessionStart.push({
            hooks: [
                {
                    type: "command",
                    command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/sync-context.js\"",
                    timeout: 5
                }
            ]
        });
    }

    // Add PreCompact hook for compaction detection
    settings.hooks.PreCompact ??= [];
    const existingPreCompactHook = settings.hooks.PreCompact.find(
        (h: HookEntry) => h.hooks?.some((hook: HookCommand) => hook.command?.includes('pre-compact.js'))
    );

    if (existingPreCompactHook === undefined) {
        settings.hooks.PreCompact.push({
            hooks: [
                {
                    type: "command",
                    command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/pre-compact.js\"",
                    timeout: 5
                }
            ]
        });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
