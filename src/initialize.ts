import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { defaultConfig } from './config';

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

// Hook script that logs tool activity to .cc/cc.log
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

// Hook script that syncs TodoWrite tool output to .cc/plan.md
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

        // Convert todos to plan.md format
        const statusMap = {
            'pending': '[ ]',
            'in_progress': '[>]',
            'completed': '[x]'
        };

        let planContent = '# Plan\\n\\n## Current Tasks\\n';

        for (const todo of todos) {
            const checkbox = statusMap[todo.status] || '[ ]';
            planContent += \`- \${checkbox} \${todo.content}\\n\`;
        }

        planContent += '\\n## Notes\\n- Auto-synced from Claude Code\\n';

        // Write to .cc/plan.md
        const projectDir = data.cwd || process.cwd();
        const planPath = path.join(projectDir, '.cc', 'plan.md');

        // Ensure .cc directory exists
        const ccDir = path.dirname(planPath);
        if (!fs.existsSync(ccDir)) {
            fs.mkdirSync(ccDir, { recursive: true });
        }

        fs.writeFileSync(planPath, planContent);

    } catch (err) {
        // Silent fail - don't break Claude Code
        console.error('CC HUD hook error:', err.message);
    }
    process.exit(0);
});
`;

// Claude Code hook configuration
const HOOK_SETTINGS = {
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

export async function initialize(_context: vscode.ExtensionContext) {
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

async function mergeTasksJson(vscodeDir: string) {
    const tasksPath = path.join(vscodeDir, 'tasks.json');

    const ccTask = {
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

    let tasksJson: { version: string; tasks: any[] };

    if (fs.existsSync(tasksPath)) {
        try {
            const content = fs.readFileSync(tasksPath, 'utf8');
            tasksJson = JSON.parse(content);

            // Check if task already exists
            const existingTask = tasksJson.tasks?.find(
                (t: any) => t.label === 'Claude Code (logged)'
            );

            if (existingTask) {
                return; // Task already exists, don't modify
            }

            if (!tasksJson.tasks) {
                tasksJson.tasks = [];
            }
            tasksJson.tasks.push(ccTask);
        } catch (error) {
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

async function setupClaudeHook(rootPath: string) {
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

    // Make executable on Unix systems
    try {
        fs.chmodSync(syncPlanPath, 0o755);
        fs.chmodSync(logActivityPath, 0o755);
    } catch {
        // Ignore chmod errors on Windows
    }

    // 3. Create or merge .claude/settings.local.json
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    let settings: any = {};

    if (fs.existsSync(settingsPath)) {
        try {
            const content = fs.readFileSync(settingsPath, 'utf8');
            settings = JSON.parse(content);
        } catch {
            // If parsing fails, start fresh
            settings = {};
        }
    }

    // Merge hook settings
    if (!settings.hooks) {
        settings.hooks = {};
    }

    if (!settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = [];
    }

    // Add sync-plan hook if not exists
    const existingSyncHook = settings.hooks.PostToolUse.find(
        (h: any) => h.matcher === 'TodoWrite' &&
            h.hooks?.some((hook: any) => hook.command?.includes('sync-plan.js'))
    );

    if (!existingSyncHook) {
        settings.hooks.PostToolUse.push(HOOK_SETTINGS.hooks.PostToolUse[0]);
    }

    // Add log-activity hook if not exists (matches all tools except TodoWrite)
    const existingLogHook = settings.hooks.PostToolUse.find(
        (h: any) => h.hooks?.some((hook: any) => hook.command?.includes('log-activity.js'))
    );

    if (!existingLogHook) {
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

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
