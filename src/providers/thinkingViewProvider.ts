import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CCHudConfig, getAbsolutePath } from '../config';
import { escapeHtml } from '../utils/html';

export class ThinkingViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cc-hud.thinking';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _config: CCHudConfig;
    private _watcher?: fs.FSWatcher;
    private _autoFollow: boolean = true;
    private _searchFilter: string = '';

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
                case 'toggleAutoFollow':
                    // Validate that value is a boolean
                    if (typeof message.value === 'boolean') {
                        this._autoFollow = message.value;
                    }
                    break;
                case 'search':
                    // Validate that value is a string
                    if (typeof message.value === 'string') {
                        this._searchFilter = message.value;
                        this.refresh();
                    }
                    break;
                case 'clearView':
                    this._clearView();
                    break;
                case 'openLogFile':
                    await this._openLogFile();
                    break;
            }
        });

        // Watch log file for changes
        this._setupWatcher();

        webviewView.onDidDispose(() => {
            if (this._watcher) {
                this._watcher.close();
            }
        });
    }

    private _setupWatcher() {
        const logPath = getAbsolutePath(this._config.logPath);
        if (!logPath) {
            return;
        }

        // Clean up existing watcher
        if (this._watcher) {
            this._watcher.close();
        }

        try {
            // Watch the directory since the file might not exist yet
            const dir = path.dirname(logPath);
            if (fs.existsSync(dir)) {
                this._watcher = fs.watch(dir, (eventType, filename) => {
                    if (filename === 'cc.log') {
                        this.refresh();
                    }
                });
            }
        } catch (error) {
            console.error('Failed to setup log watcher:', error);
        }
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    private _clearView() {
        // Just clear the view content, don't delete the file
        if (this._view) {
            this._view.webview.postMessage({ type: 'clear' });
        }
    }

    private async _openLogFile() {
        const logPath = getAbsolutePath(this._config.logPath);
        if (logPath) {
            try {
                const doc = await vscode.workspace.openTextDocument(logPath);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                vscode.window.showWarningMessage('CC HUD: Log file not found. Run initialize first.');
            }
        }
    }

    private _getHtmlContent(): string {
        const logPath = getAbsolutePath(this._config.logPath);
        let logContent = '';

        if (logPath) {
            try {
                const MAX_READ_SIZE = 1024 * 1024; // 1MB limit
                const stats = fs.statSync(logPath);
                let fullContent: string;

                if (stats.size > MAX_READ_SIZE) {
                    // For large files, only read the last 1MB
                    const startPosition = stats.size - MAX_READ_SIZE;
                    const buffer = Buffer.alloc(MAX_READ_SIZE);
                    const fd = fs.openSync(logPath, 'r');
                    try {
                        fs.readSync(fd, buffer, 0, MAX_READ_SIZE, startPosition);
                        fullContent = buffer.toString('utf8');
                        // Skip potentially incomplete first line
                        const firstNewline = fullContent.indexOf('\n');
                        if (firstNewline > 0) {
                            fullContent = fullContent.substring(firstNewline + 1);
                        }
                    } finally {
                        fs.closeSync(fd);
                    }
                } else {
                    fullContent = fs.readFileSync(logPath, 'utf8');
                }

                const lines = fullContent.split('\n');
                const tailLines = lines.slice(-this._config.thinkingTailLines);

                // Apply search filter
                let filteredLines = tailLines;
                if (this._searchFilter) {
                    const searchLower = this._searchFilter.toLowerCase();
                    filteredLines = tailLines.filter(line =>
                        line.toLowerCase().includes(searchLower)
                    );
                }

                logContent = escapeHtml(filteredLines.join('\n'));
            } catch (error) {
                logContent = 'No log file found. Run "CC HUD: Initialize" and start a Claude Code session.';
            }
        } else {
            logContent = 'No log file found. Run "CC HUD: Initialize" and start a Claude Code session.';
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        body {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 12px);
            color: var(--vscode-foreground);
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .toolbar {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.toggle.active {
            background: var(--vscode-button-secondaryBackground);
        }
        input[type="text"] {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            flex: 1;
            max-width: 200px;
        }
        .log-container {
            flex: 1;
            overflow: auto;
            padding: 8px;
        }
        .log-content {
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.4;
        }
        .empty-state {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <input type="text" id="searchInput" placeholder="Search..." value="${escapeHtml(this._searchFilter)}" onkeyup="handleSearch(event)">
        <button class="toggle ${this._autoFollow ? 'active' : ''}" onclick="toggleAutoFollow()">Auto-follow</button>
        <button onclick="clearView()">Clear View</button>
        <button onclick="openLogFile()">Open Log</button>
    </div>
    <div class="log-container" id="logContainer">
        <pre class="log-content ${!logContent ? 'empty-state' : ''}">${logContent || 'No log content'}</pre>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        let autoFollow = ${this._autoFollow};

        function handleSearch(event) {
            if (event.key === 'Enter') {
                vscode.postMessage({ type: 'search', value: event.target.value });
            }
        }

        function toggleAutoFollow() {
            autoFollow = !autoFollow;
            vscode.postMessage({ type: 'toggleAutoFollow', value: autoFollow });
            document.querySelector('.toggle').classList.toggle('active', autoFollow);
        }

        function clearView() {
            document.querySelector('.log-content').textContent = '';
            vscode.postMessage({ type: 'clearView' });
        }

        function openLogFile() {
            vscode.postMessage({ type: 'openLogFile' });
        }

        // Auto-scroll to bottom if auto-follow is enabled
        if (autoFollow) {
            const container = document.getElementById('logContainer');
            container.scrollTop = container.scrollHeight;
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'clear') {
                document.querySelector('.log-content').textContent = '';
            }
        });
    </script>
</body>
</html>`;
    }

}
