import * as vscode from 'vscode';
import * as fs from 'fs';
import { CCHudConfig, getAbsolutePath } from '../config';
import { loadContext, saveContext, calculateContextPercent, ContextItem } from '../context';
import { escapeHtml } from '../utils/html';

export class ContextViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cc-hud.context';

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
                case 'toggleItem':
                    // Validate that index is a non-negative integer
                    if (typeof message.index === 'number' && Number.isInteger(message.index) && message.index >= 0) {
                        this._toggleItem(message.index);
                    }
                    break;
                case 'removeItem':
                    // Validate that index is a non-negative integer
                    if (typeof message.index === 'number' && Number.isInteger(message.index) && message.index >= 0) {
                        this._removeItem(message.index);
                    }
                    break;
                case 'openFile':
                    // Validate that path is a string
                    if (typeof message.path === 'string') {
                        await this._openFile(message.path);
                    }
                    break;
            }
        });
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    public async getContextPercent(): Promise<number> {
        return calculateContextPercent(this._config.contextTokenLimit);
    }

    private _toggleItem(index: number) {
        const context = loadContext();
        if (index >= 0 && index < context.items.length) {
            context.items[index].included = !context.items[index].included;
            saveContext(context);
            this.refresh();
        }
    }

    private _removeItem(index: number) {
        const context = loadContext();
        if (index >= 0 && index < context.items.length) {
            context.items.splice(index, 1);
            saveContext(context);
            this.refresh();
        }
    }

    private async _openFile(filePath: string) {
        const absolutePath = getAbsolutePath(filePath);
        if (absolutePath) {
            try {
                const doc = await vscode.workspace.openTextDocument(absolutePath);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                vscode.window.showWarningMessage(`CC HUD: File not found: ${filePath}`);
            }
        }
    }

    private _getHtmlContent(): string {
        const context = loadContext();
        const percent = calculateContextPercent(this._config.contextTokenLimit);

        // Calculate totals
        let includedChars = 0;
        let totalChars = 0;
        for (const item of context.items) {
            totalChars += item.sizeChars;
            if (item.included) {
                includedChars += item.sizeChars;
            }
        }

        // Add plan.md size
        const planPath = getAbsolutePath(this._config.planPath);
        let planSize = 0;
        if (planPath) {
            try {
                const planContent = fs.readFileSync(planPath, 'utf8');
                planSize = planContent.length;
            } catch (error) {
                // File doesn't exist or can't be read, use default size
            }
        }

        const estimatedTokens = Math.round((includedChars + planSize) / 4);

        const itemsHtml = context.items.length === 0
            ? '<div class="empty-state">No pinned items. Use "CC HUD: Pin Current File" to add files.</div>'
            : context.items.map((item, index) => this._renderItem(item, index)).join('');

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
            margin: 0;
        }
        .context-meter {
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }
        .meter-bar {
            height: 8px;
            background: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
            margin: 8px 0;
        }
        .meter-fill {
            height: 100%;
            background: var(--vscode-progressBar-background);
            transition: width 0.3s ease;
        }
        .meter-fill.low { background: #4caf50; }
        .meter-fill.medium { background: #ff9800; }
        .meter-fill.high { background: #f44336; }
        .meter-stats {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .item {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            margin: 4px 0;
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
        .item.excluded {
            opacity: 0.5;
        }
        .item-checkbox {
            margin-right: 8px;
            cursor: pointer;
        }
        .item-info {
            flex: 1;
            min-width: 0;
        }
        .item-name {
            cursor: pointer;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .item-name:hover {
            text-decoration: underline;
        }
        .item-size {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .item-remove {
            cursor: pointer;
            padding: 2px 6px;
            opacity: 0.6;
        }
        .item-remove:hover {
            opacity: 1;
        }
        .item-type {
            font-size: 0.75em;
            padding: 2px 4px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 2px;
            margin-right: 8px;
        }
        .empty-state {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
            text-align: center;
        }
        h3 {
            margin: 0 0 10px 0;
            font-size: 1em;
        }
    </style>
</head>
<body>
    <div class="context-meter">
        <h3>Context Usage: ${percent}%</h3>
        <div class="meter-bar">
            <div class="meter-fill ${percent < 50 ? 'low' : percent < 80 ? 'medium' : 'high'}" style="width: ${percent}%"></div>
        </div>
        <div class="meter-stats">
            ~${estimatedTokens.toLocaleString()} tokens / ${this._config.contextTokenLimit.toLocaleString()} limit
            <br>
            Plan: ~${Math.round(planSize / 4).toLocaleString()} tokens
        </div>
    </div>
    <h3>Pinned Items</h3>
    <div class="items">
        ${itemsHtml}
    </div>
    <script>
        const vscode = acquireVsCodeApi();

        function toggleItem(index) {
            vscode.postMessage({ type: 'toggleItem', index: index });
        }

        function removeItem(index) {
            vscode.postMessage({ type: 'removeItem', index: index });
        }

        function openFile(path) {
            vscode.postMessage({ type: 'openFile', path: path });
        }
    </script>
</body>
</html>`;
    }

    private _renderItem(item: ContextItem, index: number): string {
        const name = item.path || item.label || 'Unknown';
        const sizeTokens = Math.round(item.sizeChars / 4);
        const typeLabel = item.type === 'file' ? 'FILE' : item.type === 'snippet' ? 'SNIP' : 'NOTE';
        const includedClass = item.included ? '' : 'excluded';
        const checkboxIcon = item.included ? '&#9745;' : '&#9744;';

        return `
        <div class="item ${includedClass}">
            <span class="item-checkbox" onclick="toggleItem(${index})">${checkboxIcon}</span>
            <span class="item-type">${typeLabel}</span>
            <div class="item-info">
                <div class="item-name" onclick="openFile('${escapeHtml(item.path || '', { escapeSingleQuotes: true })}')">${escapeHtml(name)}</div>
                <div class="item-size">~${sizeTokens.toLocaleString()} tokens</div>
            </div>
            <span class="item-remove" onclick="removeItem(${index})">&#10005;</span>
        </div>`;
    }

}
