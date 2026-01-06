import * as vscode from 'vscode';
import { initialize } from './initialize';
import { TodoTreeProvider } from './providers/todoTreeProvider';
import { PlanViewProvider } from './providers/planViewProvider';
import { ThinkingViewProvider } from './providers/thinkingViewProvider';
import { ContextViewProvider } from './providers/contextViewProvider';
import { loadConfig } from './config';
import { pinCurrentFile } from './context';
import { invalidateCache } from './utils/fileCache';

export function activate(context: vscode.ExtensionContext) {
    const config = loadConfig();

    // Register initialization command
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.initialize', () => initialize(context))
    );

    // Register pin file command
    context.subscriptions.push(
        vscode.commands.registerCommand('cc-hud.pinCurrentFile', () => pinCurrentFile())
    );

    // Create providers
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

    // Watch for file changes to update views with debouncing
    const DEBOUNCE_DELAY = 100;
    let planDebounceTimer: NodeJS.Timeout | undefined;
    let contextDebounceTimer: NodeJS.Timeout | undefined;

    const planWatcher = vscode.workspace.createFileSystemWatcher('**/.cc/plan.md');
    const handlePlanChange = (uri: vscode.Uri) => {
        if (planDebounceTimer) {
            clearTimeout(planDebounceTimer);
        }
        planDebounceTimer = setTimeout(() => {
            try {
                invalidateCache(uri.fsPath);
                todoProvider.refresh();
                planProvider.refresh();
            } catch (error) {
                console.error('CC HUD: Error handling plan file change:', error);
            }
        }, DEBOUNCE_DELAY);
    };
    planWatcher.onDidChange(handlePlanChange);
    planWatcher.onDidCreate(handlePlanChange);
    context.subscriptions.push(planWatcher);

    const contextWatcher = vscode.workspace.createFileSystemWatcher('**/.cc/context.json');
    const handleContextChange = (uri: vscode.Uri) => {
        if (contextDebounceTimer) {
            clearTimeout(contextDebounceTimer);
        }
        contextDebounceTimer = setTimeout(() => {
            try {
                invalidateCache(uri.fsPath);
                contextProvider.refresh();
                updateStatusBar(statusBarItem, contextProvider);
            } catch (error) {
                console.error('CC HUD: Error handling context file change:', error);
            }
        }, DEBOUNCE_DELAY);
    };
    contextWatcher.onDidChange(handleContextChange);
    context.subscriptions.push(contextWatcher);

    // Initial status bar update
    updateStatusBar(statusBarItem, contextProvider);
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem, contextProvider: ContextViewProvider) {
    try {
        const percent = await contextProvider.getContextPercent();
        statusBarItem.text = `$(hubot) CC HUD: Context ${percent}%`;
    } catch (error) {
        statusBarItem.text = '$(hubot) CC HUD: Context --%';
        console.error('CC HUD: Error updating status bar:', error);
    }
}

export function deactivate() {}
