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

        vscode.window.showInformationMessage('CC HUD: Workspace initialized successfully!');

        // Refresh views
        vscode.commands.executeCommand('cc-hud.todo.refresh');

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
