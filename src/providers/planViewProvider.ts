import * as vscode from 'vscode';
import * as fs from 'fs';
import { CCHudConfig, getAbsolutePath } from '../config';
import { toggleCheckbox } from '../planParser';
import { escapeHtml } from '../utils/html';

export class PlanViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cc-hud.plan';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _config: CCHudConfig;

    constructor(extensionUri: vscode.Uri, config: CCHudConfig) {
        this._extensionUri = extensionUri;
        this._config = config;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlContent();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'toggleCheckbox':
                    // Validate that line is a positive integer
                    if (typeof message.line === 'number' && Number.isInteger(message.line) && message.line > 0) {
                        await this._toggleCheckbox(message.line);
                    }
                    break;
                case 'openPlanFile':
                    await this._openPlanFile();
                    break;
                case 'copyInstruction':
                    await this._copyInstruction();
                    break;
            }
        });
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    private async _toggleCheckbox(line: number) {
        const planPath = getAbsolutePath(this._config.planPath);
        if (!planPath) {
            return;
        }

        try {
            const content = fs.readFileSync(planPath, 'utf8');
            const newContent = toggleCheckbox(content, line);
            fs.writeFileSync(planPath, newContent);
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('CC HUD: Failed to update plan file');
        }
    }

    private async _openPlanFile() {
        const planPath = getAbsolutePath(this._config.planPath);
        if (planPath) {
            try {
                const doc = await vscode.workspace.openTextDocument(planPath);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                vscode.window.showErrorMessage('CC HUD: Failed to open plan file');
            }
        }
    }

    private async _copyInstruction() {
        const instruction = `Please update .cc/plan.md to reflect the current progress. Mark completed tasks with [x], in-progress tasks with [>], and blocked tasks with [!]. Keep the file structure intact.`;
        await vscode.env.clipboard.writeText(instruction);
        vscode.window.showInformationMessage('CC HUD: Instruction copied to clipboard');
    }

    private _getHtmlContent(): string {
        const planPath = getAbsolutePath(this._config.planPath);
        let markdownContent = '*No plan file found. Run "CC HUD: Initialize" first.*';

        if (planPath) {
            try {
                markdownContent = fs.readFileSync(planPath, 'utf8');
            } catch (error) {
                // File doesn't exist or can't be read, use default message
            }
        }

        // Convert markdown to HTML with clickable checkboxes
        const htmlContent = this._renderMarkdown(markdownContent);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 10px;
            line-height: 1.5;
        }
        .toolbar {
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            margin-right: 5px;
            cursor: pointer;
            border-radius: 2px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .checkbox {
            cursor: pointer;
            user-select: none;
        }
        .checkbox:hover {
            opacity: 0.8;
        }
        h1, h2, h3 {
            color: var(--vscode-foreground);
            margin-top: 1em;
            margin-bottom: 0.5em;
        }
        h1 { font-size: 1.5em; }
        h2 { font-size: 1.3em; }
        h3 { font-size: 1.1em; }
        ul {
            list-style: none;
            padding-left: 1.5em;
        }
        li {
            margin: 0.3em 0;
        }
        .done {
            text-decoration: line-through;
            opacity: 0.7;
        }
        .in-progress {
            color: var(--vscode-charts-yellow);
        }
        .blocked {
            color: var(--vscode-charts-red);
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="openPlanFile()">Open Plan File</button>
        <button onclick="copyInstruction()">Copy Update Instruction</button>
    </div>
    <div class="content">
        ${htmlContent}
    </div>
    <script>
        const vscode = acquireVsCodeApi();

        function toggleCheckbox(line) {
            vscode.postMessage({ type: 'toggleCheckbox', line: line });
        }

        function openPlanFile() {
            vscode.postMessage({ type: 'openPlanFile' });
        }

        function copyInstruction() {
            vscode.postMessage({ type: 'copyInstruction' });
        }
    </script>
</body>
</html>`;
    }

    private _renderMarkdown(content: string): string {
        const lines = content.split('\n');
        let html = '';
        let inList = false;
        let listStack: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Headers
            if (line.startsWith('# ')) {
                if (inList) { html += this._closeList(listStack); inList = false; listStack = []; }
                html += `<h1>${this._escapeAndFormatHtml(line.slice(2))}</h1>`;
                continue;
            }
            if (line.startsWith('## ')) {
                if (inList) { html += this._closeList(listStack); inList = false; listStack = []; }
                html += `<h2>${this._escapeAndFormatHtml(line.slice(3))}</h2>`;
                continue;
            }
            if (line.startsWith('### ')) {
                if (inList) { html += this._closeList(listStack); inList = false; listStack = []; }
                html += `<h3>${this._escapeAndFormatHtml(line.slice(4))}</h3>`;
                continue;
            }

            // Checkbox items
            const checkboxMatch = line.match(/^(\s*)-\s*\[([ x~>!])\]\s*(.+)$/);
            if (checkboxMatch) {
                const indent = checkboxMatch[1].length;
                const status = checkboxMatch[2];
                const text = checkboxMatch[3];

                if (!inList) {
                    html += '<ul>';
                    inList = true;
                    listStack.push(indent);
                } else {
                    while (listStack.length > 0 && listStack[listStack.length - 1] > indent) {
                        html += '</ul></li>';
                        listStack.pop();
                    }
                    if (listStack.length === 0 || listStack[listStack.length - 1] < indent) {
                        html += '<ul>';
                        listStack.push(indent);
                    }
                }

                const statusClass = status === 'x' ? 'done' : (status === '>' || status === '~') ? 'in-progress' : status === '!' ? 'blocked' : '';
                const checkboxChar = status === 'x' ? '&#9745;' : (status === '>' || status === '~') ? '&#9655;' : status === '!' ? '&#9888;' : '&#9744;';

                html += `<li class="${statusClass}"><span class="checkbox" onclick="toggleCheckbox(${lineNum})">${checkboxChar}</span> ${this._escapeAndFormatHtml(text)}`;
                continue;
            }

            // Regular list items
            const listMatch = line.match(/^(\s*)-\s+(.+)$/);
            if (listMatch) {
                const indent = listMatch[1].length;
                const text = listMatch[2];

                if (!inList) {
                    html += '<ul>';
                    inList = true;
                    listStack.push(indent);
                }

                html += `<li>${this._escapeAndFormatHtml(text)}</li>`;
                continue;
            }

            // Empty lines close lists
            if (line.trim() === '') {
                if (inList) {
                    html += this._closeList(listStack);
                    inList = false;
                    listStack = [];
                }
                html += '<br>';
                continue;
            }

            // Regular paragraphs
            if (inList) {
                html += this._closeList(listStack);
                inList = false;
                listStack = [];
            }
            html += `<p>${this._escapeAndFormatHtml(line)}</p>`;
        }

        if (inList) {
            html += this._closeList(listStack);
        }

        return html;
    }

    private _closeList(stack: number[]): string {
        let html = '';
        for (let i = 0; i < stack.length; i++) {
            html += '</li></ul>';
        }
        return html;
    }

    private _escapeAndFormatHtml(text: string): string {
        // First escape HTML, then convert backticks to code tags
        return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
    }
}
