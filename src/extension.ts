import * as vscode from 'vscode';
import { initialize } from './initialize';
import { TodoTreeProvider } from './providers/todoTreeProvider';
import { PlanViewProvider } from './providers/planViewProvider';
import { ThinkingViewProvider } from './providers/thinkingViewProvider';
import { ContextViewProvider } from './providers/contextViewProvider';
import { loadConfig } from './config';
import { pinCurrentFile, updatePinnedFileSizes } from './context';
import { invalidateCache } from './utils/fileCache';
import { PinnedFileWatcher } from './pinnedFileWatcher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = loadConfig();

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
                } catch (error) {
                    console.log('CC HUD: Could not auto-move to secondary sidebar:', error);
                }
            })();
        }, 500);
    }

    // Register initialization command
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.initialize', () => initialize(context))
    );

    // Register pin file command
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.pinCurrentFile', () => pinCurrentFile())
    );

    // Create providers (before registering reset command so we can reference them)
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
            } catch (error) {
                console.error('CC HUD: Error handling plan file change:', error);
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
            } catch (error) {
                console.error('CC HUD: Error handling context file change:', error);
            }
        }, DEBOUNCE_DELAY);
    };
    contextWatcher.onDidChange(handleContextChange);
    contextWatcher.onDidCreate(handleContextChange);
    context.subscriptions.push(contextWatcher);

    // Initial status bar update
    void updateStatusBar(statusBarItem, contextProvider);
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem, contextProvider: ContextViewProvider): Promise<void> {
    try {
        const percent = await contextProvider.getContextPercent();
        statusBarItem.text = `$(hubot) CC HUD: Context ${percent}%`;
    } catch (error) {
        statusBarItem.text = '$(hubot) CC HUD: Context --%';
        console.error('CC HUD: Error updating status bar:', error);
    }
}

export function deactivate(): void {}
