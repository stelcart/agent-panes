import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CCHudConfig, getAbsolutePath } from '../config';
import { escapeHtml } from '../utils/html';
import { error } from '../utils/logger';

function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

export class ThinkingViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cc-hud.thinking';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _config: CCHudConfig;
    private _watcher?: fs.FSWatcher;
    private _autoFollow: boolean = true;
    private _searchFilter: string = '';
    private _debounceTimer: NodeJS.Timeout | undefined;

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
            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
            }
        });
    }

    private _setupWatcher(): void {
        const logPath = getAbsolutePath(this._config.logPath);
        if (logPath === undefined || logPath === '') {
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
                this._watcher = fs.watch(dir, (_eventType, filename) => {
                    if (filename === 'cc.log') {
                        if (this._debounceTimer) {
                            clearTimeout(this._debounceTimer);
                        }
                        this._debounceTimer = setTimeout(() => {
                            this.refresh();
                        }, 150);
                    }
                });
                this._watcher.on('error', (err) => error('CC HUD: Log watcher error:', err));
            }
        } catch (err) {
            error('Failed to setup log watcher:', err);
        }
    }

    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    private _clearView(): void {
        // Just clear the view content, don't delete the file
        if (this._view) {
            this._view.webview.postMessage({ type: 'clear' });
        }
    }

    private async _openLogFile(): Promise<void> {
        const logPath = getAbsolutePath(this._config.logPath);
        if (logPath === undefined || logPath === '') {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(logPath);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage('CC HUD: Log file not found. Run initialize first.');
        }
    }

    private _getHtmlContent(): string {
        const logPath = getAbsolutePath(this._config.logPath);
        let logContent = '';

        if (logPath !== undefined && logPath !== '') {
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
            } catch {
                logContent = 'No log file found. Run "CC HUD: Initialize" and start a Claude Code session.';
            }
        } else {
            logContent = 'No log file found. Run "CC HUD: Initialize" and start a Claude Code session.';
        }

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
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
    <script nonce="${nonce}">
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
        // Use setTimeout to ensure content is fully rendered before scrolling
        if (autoFollow) {
            setTimeout(() => {
                const container = document.getElementById('logContainer');
                container.scrollTop = container.scrollHeight;
            }, 50);
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
