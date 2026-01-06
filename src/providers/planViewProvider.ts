import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { CCHudConfig, getAbsolutePath } from '../config';
import { toggleCheckbox } from '../planParser';
import { renderMarkdownToHtml } from '../utils/markdown';

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
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
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

    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    private async _toggleCheckbox(line: number): Promise<void> {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`CC HUD: Failed to update plan file: ${errorMessage}`);
        }
    }

    private async _openPlanFile(): Promise<void> {
        const planPath = getAbsolutePath(this._config.planPath);
        if (!planPath) {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(planPath);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showErrorMessage('CC HUD: Failed to open plan file');
        }
    }

    private async _copyInstruction(): Promise<void> {
        try {
            const instruction = `Please update .cc/plan.md to reflect the current progress. Mark completed tasks with [x], in-progress tasks with [>], and blocked tasks with [!]. Keep the file structure intact.`;
            await vscode.env.clipboard.writeText(instruction);
            vscode.window.showInformationMessage('CC HUD: Instruction copied to clipboard');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`CC HUD: Failed to copy instruction to clipboard: ${errorMessage}`);
        }
    }

    private _getHtmlContent(): string {
        const planPath = getAbsolutePath(this._config.planPath);
        let markdownContent = '*No plan file found. Run "CC HUD: Initialize" first.*';

        if (planPath) {
            try {
                markdownContent = fs.readFileSync(planPath, 'utf8');
            } catch {
                // File doesn't exist or can't be read, use default message
            }
        }

        // Generate nonce for CSP
        const nonce = crypto.randomBytes(16).toString('base64');

        // Convert markdown to HTML with clickable checkboxes
        const htmlContent = renderMarkdownToHtml(markdownContent, { onCheckboxClick: 'toggleCheckbox' });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 10px;
            line-height: 1.5;
        }
        .toolbar {
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        button {
            background: transparent;
            color: var(--vscode-textLink-foreground);
            border: none;
            padding: 2px 0;
            cursor: pointer;
            font-size: 11px;
            text-decoration: underline;
        }
        button:hover {
            color: var(--vscode-textLink-activeForeground);
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
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 0.5em 0;
        }
        pre code {
            padding: 0;
            background: none;
        }
        blockquote {
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            margin: 0.5em 0;
            padding-left: 10px;
            color: var(--vscode-textBlockQuote-foreground);
        }
        hr {
            border: none;
            border-top: 1px solid var(--vscode-panel-border);
            margin: 1em 0;
        }
        h4 { font-size: 1em; margin-top: 1em; margin-bottom: 0.5em; }
        strong { font-weight: bold; }
        em { font-style: italic; }
        del { text-decoration: line-through; opacity: 0.7; }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        ol {
            padding-left: 1.5em;
            margin: 0.5em 0;
        }
        table {
            border-collapse: collapse;
            margin: 0.5em 0;
            width: 100%;
            font-size: 0.9em;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 6px 10px;
            text-align: left;
        }
        th {
            background: var(--vscode-editor-background);
            font-weight: bold;
        }
        tr:nth-child(even) {
            background: var(--vscode-list-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="openPlanFile()">Open File</button>
        <button onclick="copyInstruction()">Copy Prompt</button>
    </div>
    <div class="content">
        ${htmlContent}
    </div>
    <script nonce="${nonce}">
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
}
