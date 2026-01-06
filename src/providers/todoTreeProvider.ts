import * as vscode from 'vscode';
import * as fs from 'fs';
import { CCHudConfig, getAbsolutePath } from '../config';
import { parsePlan, TodoItem } from '../planParser';

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TodoTreeItem | undefined | null | void> = new vscode.EventEmitter<TodoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TodoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private config: CCHudConfig;

    constructor(config: CCHudConfig) {
        this.config = config;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TodoTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TodoTreeItem): Thenable<TodoTreeItem[]> {
        if (element) {
            return Promise.resolve(
                element.todoItem.children.map(child => new TodoTreeItem(child, this.config))
            );
        }

        const planPath = getAbsolutePath(this.config.planPath);
        if (!planPath || !fs.existsSync(planPath)) {
            return Promise.resolve([]);
        }

        try {
            const content = fs.readFileSync(planPath, 'utf8');
            const parsed = parsePlan(content);

            return Promise.resolve(
                parsed.items.map(item => new TodoTreeItem(item, this.config))
            );
        } catch (error) {
            console.error('Failed to parse plan:', error);
            return Promise.resolve([]);
        }
    }
}

export class TodoTreeItem extends vscode.TreeItem {
    todoItem: TodoItem;

    constructor(todoItem: TodoItem, config: CCHudConfig) {
        const hasChildren = todoItem.children.length > 0;
        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        super(todoItem.text, collapsibleState);

        this.todoItem = todoItem;
        this.description = this.getStatusDescription(todoItem);
        this.tooltip = `${todoItem.text} (${todoItem.status})`;
        this.iconPath = this.getIcon(todoItem.status);

        // Command to open plan.md at the specific line
        const planPath = getAbsolutePath(config.planPath);
        if (planPath) {
            this.command = {
                command: 'vscode.open',
                title: 'Open Plan',
                arguments: [
                    vscode.Uri.file(planPath),
                    {
                        selection: new vscode.Range(
                            todoItem.line - 1, 0,
                            todoItem.line - 1, 0
                        )
                    }
                ]
            };
        }
    }

    private getStatusDescription(item: TodoItem): string {
        if (item.children.length > 0) {
            const doneCount = this.countDone(item);
            const totalCount = this.countTotal(item);
            return `${doneCount}/${totalCount}`;
        }
        return '';
    }

    private countDone(item: TodoItem): number {
        let count = item.status === 'done' ? 1 : 0;
        for (const child of item.children) {
            count += this.countDone(child);
        }
        return count;
    }

    private countTotal(item: TodoItem): number {
        let count = 1;
        for (const child of item.children) {
            count += this.countTotal(child);
        }
        return count;
    }

    private getIcon(status: TodoItem['status']): vscode.ThemeIcon {
        switch (status) {
            case 'done':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case 'in_progress':
                return new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
            case 'blocked':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}
