import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { CCHudConfig, getAbsolutePath } from '../config';
import { loadContext, saveContext, ContextItem } from '../context';
import { escapeHtml } from '../utils/html';
import { error } from '../utils/logger';

interface SessionStats {
    sessionTokens: number;
    isStale: boolean;
    hasData: boolean;
    tokenSource: 'api' | 'estimated' | 'none';
    wasCompacted: boolean;
}

export class ContextViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cc-hud.context';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _config: CCHudConfig;

    constructor(extensionUri: vscode.Uri, config: CCHudConfig) {
        this._extensionUri = extensionUri;
        this._config = config;
    }

    /**
     * Get session stats from stats.json, with fallback to direct transcript reading
     */
    private _getSessionStats(): SessionStats {
        const statsPath = getAbsolutePath(this._config.statsPath);
        if (statsPath === undefined || statsPath === '') {
            return { sessionTokens: 0, isStale: true, hasData: false, tokenSource: 'none', wasCompacted: false };
        }

        try {
            const statsContent = fs.readFileSync(statsPath, 'utf8');
            const stats = JSON.parse(statsContent) as {
                updatedAt?: string;
                estimatedTokens?: number;
                actualTokens?: number | null;
                tokenSource?: 'api' | 'estimated';
                transcriptPath?: string;
                compactedAt?: string | null;
                compactionType?: string | null;
                compactedSessionId?: string | null;
                sessionId?: string | null;
            };

            // Check if data is stale (>5 min old)
            const updatedAt = new Date(stats.updatedAt ?? 0);
            const ageMs = Date.now() - updatedAt.getTime();
            const isStale = ageMs > 5 * 60 * 1000;

            // Check if context was compacted for the current session
            // Show warning if compactedSessionId matches the current sessionId (not time-based)
            let wasCompacted = false;
            if (typeof stats.compactedAt === 'string' && stats.compactedAt !== '' &&
                typeof stats.compactedSessionId === 'string' && stats.compactedSessionId !== '' &&
                typeof stats.sessionId === 'string' && stats.sessionId !== '') {
                // Show compaction warning if it occurred in the current session
                wasCompacted = stats.compactedSessionId === stats.sessionId;
            }

            // Prefer actual tokens from API if available, otherwise use estimated
            let sessionTokens = 0;
            let tokenSource: 'api' | 'estimated' | 'none' = 'none';

            if (typeof stats.actualTokens === 'number' && stats.actualTokens > 0) {
                sessionTokens = stats.actualTokens;
                tokenSource = 'api';
            } else if (typeof stats.estimatedTokens === 'number' && stats.estimatedTokens > 0) {
                sessionTokens = stats.estimatedTokens;
                tokenSource = 'estimated';
            }

            // If stale but we have transcript path, try direct read for fresh data
            if (isStale && typeof stats.transcriptPath === 'string' && stats.transcriptPath !== '') {
                try {
                    const transcriptStats = fs.statSync(stats.transcriptPath);
                    sessionTokens = Math.round(transcriptStats.size / 4);
                    tokenSource = 'estimated';
                    // Got fresh data from direct read
                    return { sessionTokens, isStale: false, hasData: true, tokenSource, wasCompacted };
                } catch {
                    // Transcript file not accessible, use cached value
                }
            }

            return { sessionTokens, isStale, hasData: sessionTokens > 0, tokenSource, wasCompacted };
        } catch {
            // File doesn't exist or can't be read
            return { sessionTokens: 0, isStale: true, hasData: false, tokenSource: 'none', wasCompacted: false };
        }
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
                case 'toggleItem':
                    // Validate that index is a non-negative integer
                    if (typeof message.index === 'number' && Number.isInteger(message.index) && message.index >= 0) {
                        try {
                            this._toggleItem(message.index);
                        } catch (err) {
                            error('CC HUD: Error toggling item:', err);
                            vscode.window.showErrorMessage('CC HUD: Failed to toggle item. Check the output channel for details.');
                        }
                    }
                    break;
                case 'removeItem':
                    // Validate that index is a non-negative integer
                    if (typeof message.index === 'number' && Number.isInteger(message.index) && message.index >= 0) {
                        try {
                            this._removeItem(message.index);
                        } catch (err) {
                            error('CC HUD: Error removing item:', err);
                            vscode.window.showErrorMessage('CC HUD: Failed to remove item. Check the output channel for details.');
                        }
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

    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    public async getContextPercent(): Promise<number> {
        // Calculate pinned items size
        const context = loadContext();
        let includedChars = 0;
        for (const item of context.items) {
            if (item.included) {
                includedChars += item.sizeChars;
            }
        }

        // Get plan size
        const planPath = getAbsolutePath(this._config.planPath);
        let planSize = 0;
        if (planPath !== undefined && planPath !== '') {
            try {
                planSize = fs.readFileSync(planPath, 'utf8').length;
            } catch {
                // ignore
            }
        }

        // Get session stats (with direct transcript fallback)
        const { sessionTokens } = this._getSessionStats();

        const totalTokens = sessionTokens + Math.round(planSize / 4) + Math.round(includedChars / 4);
        return Math.min(100, Math.round((totalTokens / this._config.contextTokenLimit) * 100));
    }

    private _toggleItem(index: number): void {
        const context = loadContext();
        const item = context.items[index];
        if (index >= 0 && index < context.items.length && item) {
            item.included = !item.included;
            saveContext(context);
            this.refresh();
        }
    }

    private _removeItem(index: number): void {
        const context = loadContext();
        if (index >= 0 && index < context.items.length) {
            context.items.splice(index, 1);
            saveContext(context);
            this.refresh();
        }
    }

    private async _openFile(filePath: string): Promise<void> {
        const absolutePath = getAbsolutePath(filePath);
        if (absolutePath === undefined || absolutePath === '') {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(absolutePath);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage(`CC HUD: File not found: ${filePath}`);
        }
    }

    private _getHtmlContent(): string {
        // Generate nonce for CSP
        const nonce = crypto.randomBytes(16).toString('base64');

        // Load context with error detection
        let context: { items: import('../context').ContextItem[] };
        let loadError = false;
        try {
            context = loadContext();
        } catch (err) {
            error('CC HUD: Unexpected error loading context:', err);
            context = { items: [] };
            loadError = true;
        }

        // Check if context.json exists to differentiate between "no items" and "error loading"
        const contextPath = getAbsolutePath('.cc/context.json');
        let contextFileExists = false;
        if (contextPath !== undefined && contextPath !== '') {
            try {
                fs.accessSync(contextPath, fs.constants.R_OK);
                contextFileExists = true;
            } catch {
                // File doesn't exist or isn't readable
            }
        }

        // Calculate pinned items size
        let includedChars = 0;
        for (const item of context.items) {
            if (item.included) {
                includedChars += item.sizeChars;
            }
        }

        // Get plan.md size
        const planPathForSize = getAbsolutePath(this._config.planPath);
        let planSize = 0;
        if (planPathForSize !== undefined && planPathForSize !== '') {
            try {
                const planContent = fs.readFileSync(planPathForSize, 'utf8');
                planSize = planContent.length;
            } catch {
                // File doesn't exist or can't be read, use default size
            }
        }

        // Get session stats from stats.json (with direct transcript fallback)
        const { sessionTokens, hasData: hasSessionData, tokenSource, wasCompacted } = this._getSessionStats();

        // Total = session context + plan + pinned files
        const pinnedTokens = Math.round(includedChars / 4);
        const planTokens = Math.round(planSize / 4);
        const totalTokens = sessionTokens + planTokens + pinnedTokens;
        const percent = Math.min(100, Math.round((totalTokens / this._config.contextTokenLimit) * 100));

        // Determine the appropriate empty state message
        let emptyStateMessage: string;
        if (loadError) {
            emptyStateMessage = '<div class="empty-state error">Error loading context. Check the console for details.</div>';
        } else if (contextFileExists && context.items.length === 0) {
            emptyStateMessage = '<div class="empty-state">No pinned items. Use "CC HUD: Pin Current File" to add files.</div>';
        } else if (!contextFileExists) {
            emptyStateMessage = '<div class="empty-state">No pinned items. Use "CC HUD: Pin Current File" to add files.</div>';
        } else {
            emptyStateMessage = '<div class="empty-state">No pinned items. Use "CC HUD: Pin Current File" to add files.</div>';
        }

        const itemsHtml = context.items.length === 0
            ? emptyStateMessage
            : context.items.map((item, index) => this._renderItem(item, index)).join('');

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
        .item.missing {
            border-left: 3px solid var(--vscode-editorWarning-foreground, #ff9800);
        }
        .item.missing .item-name {
            text-decoration: line-through;
            opacity: 0.7;
        }
        .missing-indicator {
            color: var(--vscode-editorWarning-foreground, #ff9800);
            font-size: 0.85em;
            margin-left: 4px;
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
        .empty-state.error {
            color: var(--vscode-errorForeground, #f44336);
            font-style: normal;
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
            ~${totalTokens.toLocaleString()} tokens / ${this._config.contextTokenLimit.toLocaleString()} limit
            ${wasCompacted ? '<br><span style="color: var(--vscode-editorWarning-foreground, #ff9800);">&#9888; Context was compacted</span>' : ''}
            ${hasSessionData
                ? `<br>Session: ~${sessionTokens.toLocaleString()} tokens${tokenSource === 'estimated' ? ' <span style="opacity:0.6">(est.)</span>' : ''}`
                : '<br><span style="opacity:0.6">Session: waiting for CC activity...</span>'}
            <br>Plan: ~${planTokens.toLocaleString()} tokens
            ${pinnedTokens > 0 ? `<br>Pinned: ~${pinnedTokens.toLocaleString()} tokens` : ''}
        </div>
    </div>
    <h3>Pinned Items</h3>
    <div class="items">
        ${itemsHtml}
    </div>
    <script nonce="${nonce}">
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
        const name = item.path ?? item.label ?? 'Unknown';
        const sizeTokens = Math.round(item.sizeChars / 4);
        const typeLabel = item.type === 'file' ? 'FILE' : item.type === 'snippet' ? 'SNIP' : 'NOTE';
        const isMissing = item.type === 'file' && item.sizeChars === 0;
        const includedClass = item.included ? '' : 'excluded';
        const missingClass = isMissing ? 'missing' : '';
        const checkboxIcon = item.included ? '&#9745;' : '&#9744;';
        const missingIndicator = isMissing ? '<span class="missing-indicator" title="File not found">&#9888;</span>' : '';
        const sizeDisplay = isMissing ? 'File not found' : `~${sizeTokens.toLocaleString()} tokens`;
        const itemPath = item.path ?? '';

        return `
        <div class="item ${includedClass} ${missingClass}">
            <span class="item-checkbox" onclick="toggleItem(${index})">${checkboxIcon}</span>
            <span class="item-type">${typeLabel}</span>
            <div class="item-info">
                <div class="item-name" onclick="openFile('${escapeHtml(itemPath, { escapeSingleQuotes: true })}')">${escapeHtml(name)}${missingIndicator}</div>
                <div class="item-size">${sizeDisplay}</div>
            </div>
            <span class="item-remove" onclick="removeItem(${index})">&#10005;</span>
        </div>`;
    }

}
