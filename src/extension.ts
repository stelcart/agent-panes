import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { initialize, updateHooksIfNeeded } from './initialize';
import { TodoTreeProvider } from './providers/todoTreeProvider';
import { PlanViewProvider } from './providers/planViewProvider';
import { ThinkingViewProvider } from './providers/thinkingViewProvider';
import { ContextViewProvider } from './providers/contextViewProvider';
import { loadConfig } from './config';
import { pinCurrentFile, updatePinnedFileSizes } from './context';
import { invalidateCache } from './utils/fileCache';
import { PinnedFileWatcher } from './pinnedFileWatcher';
import { log, error, disposeLogger } from './utils/logger';

/**
 * Check if the project has the required CC HUD hooks configured
 */
function hasRequiredHooks(rootPath: string): boolean {
    const settingsPath = path.join(rootPath, '.claude', 'settings.local.json');

    try {
        if (!fs.existsSync(settingsPath)) {
            return false;
        }

        const content = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(content) as {
            hooks?: {
                PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }>;
                SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
            };
        };

        // Check for sync-context hook in PostToolUse
        const hasPostToolUseHook = settings.hooks?.PostToolUse?.some(
            h => h.hooks?.some(hook => hook.command?.includes('sync-context.js') === true) === true
        ) === true;

        // Check for sync-context hook in SessionStart
        const hasSessionStartHook = settings.hooks?.SessionStart?.some(
            h => h.hooks?.some(hook => hook.command?.includes('sync-context.js') === true) === true
        ) === true;

        return hasPostToolUseHook && hasSessionStartHook;
    } catch {
        return false;
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = loadConfig();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        // Auto-update hooks if they exist but are outdated (silent upgrade)
        if (updateHooksIfNeeded(workspaceFolder.uri.fsPath)) {
            log('CC HUD: Hook scripts updated to latest version');
        }

        // Auto-initialize if hooks are missing entirely
        if (!hasRequiredHooks(workspaceFolder.uri.fsPath)) {
            log('CC HUD: Required hooks not found, auto-initializing...');
            try {
                await initialize(context);
                log('CC HUD: Auto-initialization complete');
            } catch (err) {
                error('CC HUD: Auto-initialization failed:', err);
            }
        }
    }

    // Move HUD to Secondary Side Bar on first activation
    const hasMovedToSecondarySidebar = context.globalState.get<boolean>('hasMovedToSecondarySidebar');
    if (hasMovedToSecondarySidebar !== true) {
        // Delay to ensure views are registered before moving
        setTimeout((): void => {
            void (async (): Promise<void> => {
                try {
                    // Focus our view container first
                    await vscode.commands.executeCommand('workbench.view.extension.cc-hud');
                    // Small delay to ensure focus is established
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Move the focused view to secondary sidebar
                    await vscode.commands.executeCommand('workbench.action.moveViewToSecondarySideBar');
                    // Remember that we've done this
                    await context.globalState.update('hasMovedToSecondarySidebar', true);
                } catch (err) {
                    log('CC HUD: Could not auto-move to secondary sidebar:', err);
                }
            })();
        }, 500);
    }

    // Register initialization command
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.initialize', () => initialize(context))
    );

    // Create providers (before registering commands so we can reference them)
    const todoProvider = new TodoTreeProvider(config);
    const planProvider = new PlanViewProvider(context.extensionUri, config);
    const thinkingProvider = new ThinkingViewProvider(context.extensionUri, config);
    const contextProvider = new ContextViewProvider(context.extensionUri, config);

    // Register Todo TreeView
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('cc-hud.todo', todoProvider)
    );

    // Register WebviewView providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cc-hud.plan', planProvider)
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cc-hud.thinking', thinkingProvider)
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cc-hud.context', contextProvider)
    );

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(hubot) CC HUD: Context 0%';
    statusBarItem.tooltip = 'Claude Code HUD - Context Usage';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register pin file command - explicitly refresh after pinning
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.pinCurrentFile', async () => {
            await pinCurrentFile();
            // Explicitly refresh after pinning to avoid race conditions with file watcher
            contextProvider.refresh();
            void updateStatusBar(statusBarItem, contextProvider);
        })
    );

    // Register reset command - clears state, reinitializes, and refreshes all views
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.reset', async () => {
            try {
                // Clear all global state
                await context.globalState.update('hasMovedToSecondarySidebar', undefined);

                // Re-initialize the workspace (sets up hooks, creates files if missing)
                await initialize(context);

                // Invalidate all caches and refresh views
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const ccDir = workspaceFolder.uri.fsPath + '/.cc';
                    invalidateCache(ccDir + '/plan.md');
                    invalidateCache(ccDir + '/context.json');
                }

                // Refresh all providers
                todoProvider.refresh();
                planProvider.refresh();
                thinkingProvider.refresh();
                contextProvider.refresh();
                void updateStatusBar(statusBarItem, contextProvider);

                // Move to secondary sidebar again
                setTimeout((): void => {
                    void (async (): Promise<void> => {
                        try {
                            await vscode.commands.executeCommand('workbench.view.extension.cc-hud');
                            await new Promise(resolve => setTimeout(resolve, 100));
                            await vscode.commands.executeCommand('workbench.action.moveViewToSecondarySideBar');
                            await context.globalState.update('hasMovedToSecondarySidebar', true);
                        } catch {
                            // Ignore
                        }
                    })();
                }, 500);

                vscode.window.showInformationMessage('CC HUD: Reset complete. Ask Claude Code to update its todo list to sync.');
            } catch (error) {
                vscode.window.showErrorMessage(`CC HUD: Reset failed - ${error}`);
            }
        })
    );

    // Register refresh command - just refreshes views from current files
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.refresh', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const ccDir = workspaceFolder.uri.fsPath + '/.cc';
                invalidateCache(ccDir + '/plan.md');
                invalidateCache(ccDir + '/context.json');
            }
            todoProvider.refresh();
            planProvider.refresh();
            thinkingProvider.refresh();
            contextProvider.refresh();
            void updateStatusBar(statusBarItem, contextProvider);
            vscode.window.showInformationMessage('CC HUD: Views refreshed');
        })
    );

    // Register sync command - asks user to trigger sync from Claude Code
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.syncFromCC', async () => {
            const action = await vscode.window.showInformationMessage(
                'To sync with Claude Code, ask it to "update your todo list" or use TodoWrite. The HUD will update automatically.',
                'Copy Prompt'
            );
            if (action === 'Copy Prompt') {
                await vscode.env.clipboard.writeText('Please update your todo list with your current tasks.');
                vscode.window.showInformationMessage('Prompt copied! Paste it into Claude Code.');
            }
        })
    );

    // Watch for file changes to update views with debouncing
    const DEBOUNCE_DELAY = 100;
    let planDebounceTimer: NodeJS.Timeout | undefined;
    let contextDebounceTimer: NodeJS.Timeout | undefined;

    const planWatcher = vscode.workspace.createFileSystemWatcher('**/.cc/plan.md');
    const handlePlanChange = (uri: vscode.Uri): void => {
        if (planDebounceTimer) {
            clearTimeout(planDebounceTimer);
        }
        planDebounceTimer = setTimeout(() => {
            try {
                invalidateCache(uri.fsPath);
                todoProvider.refresh();
                planProvider.refresh();
                // Also refresh context pane since it includes plan.md in token calculation
                contextProvider.refresh();
                void updateStatusBar(statusBarItem, contextProvider);
            } catch (err) {
                error('CC HUD: Error handling plan file change:', err);
            }
        }, DEBOUNCE_DELAY);
    };
    planWatcher.onDidChange(handlePlanChange);
    planWatcher.onDidCreate(handlePlanChange);
    context.subscriptions.push(planWatcher);

    // Create pinned file watcher for automatic size updates
    const pinnedFileWatcher = new PinnedFileWatcher();
    context.subscriptions.push(pinnedFileWatcher);

    // When a pinned file is updated, refresh the context view and status bar
    const fileUpdateSubscription = pinnedFileWatcher.onFileUpdated(() => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            invalidateCache(workspaceFolder.uri.fsPath + '/.cc/context.json');
        }
        contextProvider.refresh();
        void updateStatusBar(statusBarItem, contextProvider);
    });
    context.subscriptions.push(fileUpdateSubscription);

    // Initial sync of pinned file watchers
    pinnedFileWatcher.syncWatchers();

    // Update all pinned file sizes on activation (in case files changed while extension was inactive)
    updatePinnedFileSizes();

    const contextWatcher = vscode.workspace.createFileSystemWatcher('**/.cc/context.json');
    const handleContextChange = (uri: vscode.Uri): void => {
        if (contextDebounceTimer) {
            clearTimeout(contextDebounceTimer);
        }
        contextDebounceTimer = setTimeout(() => {
            try {
                invalidateCache(uri.fsPath);
                contextProvider.refresh();
                void updateStatusBar(statusBarItem, contextProvider);
                // Sync watchers when context.json changes (files may have been pinned/unpinned)
                pinnedFileWatcher.syncWatchers();
            } catch (err) {
                error('CC HUD: Error handling context file change:', err);
            }
        }, DEBOUNCE_DELAY);
    };
    contextWatcher.onDidChange(handleContextChange);
    contextWatcher.onDidCreate(handleContextChange);
    context.subscriptions.push(contextWatcher);

    // Watch for stats.json changes (session context tracking from sync-context hook)
    let statsDebounceTimer: NodeJS.Timeout | undefined;
    const statsWatcher = vscode.workspace.createFileSystemWatcher('**/.cc/stats.json');
    const handleStatsChange = (_uri: vscode.Uri): void => {
        if (statsDebounceTimer) {
            clearTimeout(statsDebounceTimer);
        }
        statsDebounceTimer = setTimeout(() => {
            try {
                contextProvider.refresh();
                void updateStatusBar(statusBarItem, contextProvider);
            } catch (err) {
                error('CC HUD: Error handling stats file change:', err);
            }
        }, DEBOUNCE_DELAY);
    };
    statsWatcher.onDidChange(handleStatsChange);
    statsWatcher.onDidCreate(handleStatsChange);
    context.subscriptions.push(statsWatcher);

    // Initial status bar update
    void updateStatusBar(statusBarItem, contextProvider);
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem, contextProvider: ContextViewProvider): Promise<void> {
    try {
        const percent = await contextProvider.getContextPercent();
        statusBarItem.text = `$(hubot) CC HUD: Context ${percent}%`;
    } catch (err) {
        statusBarItem.text = '$(hubot) CC HUD: Context --%';
        error('CC HUD: Error updating status bar:', err);
    }
}

export function deactivate(): void {
    disposeLogger();
}
