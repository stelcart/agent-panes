import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getAbsolutePath } from './config';

export interface ContextItem {
    type: 'file' | 'snippet' | 'note';
    path?: string;
    label?: string;
    included: boolean;
    sizeChars: number;
    updatedAt: string;
}

export interface ContextData {
    items: ContextItem[];
}

export function loadContext(): ContextData {
    const contextPath = getAbsolutePath('.cc/context.json');
    if (!contextPath) {
        return { items: [] };
    }

    try {
        const content = fs.readFileSync(contextPath, 'utf8');
        const parsed = JSON.parse(content);
        // Validate that result has items array
        if (!parsed || !Array.isArray(parsed.items)) {
            return { items: [] };
        }
        return parsed;
    } catch (error) {
        // File doesn't exist or can't be read/parsed, return default
        return { items: [] };
    }
}

export function saveContext(data: ContextData): void {
    const contextPath = getAbsolutePath('.cc/context.json');
    if (!contextPath) {
        return;
    }

    try {
        fs.writeFileSync(contextPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Failed to save context:', error);
    }
}

export async function pinCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('CC HUD: No active file to pin.');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('CC HUD: No workspace folder found.');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

    // Don't pin files from .cc/ directory
    if (relativePath.startsWith('.cc')) {
        vscode.window.showWarningMessage('CC HUD: Cannot pin internal .cc files.');
        return;
    }

    const context = loadContext();

    // Check if already pinned
    const existingIndex = context.items.findIndex(
        item => item.type === 'file' && item.path === relativePath
    );

    if (existingIndex >= 0) {
        vscode.window.showInformationMessage(`CC HUD: ${relativePath} is already pinned.`);
        return;
    }

    const content = editor.document.getText();
    const newItem: ContextItem = {
        type: 'file',
        path: relativePath,
        included: true,
        sizeChars: content.length,
        updatedAt: new Date().toISOString()
    };

    context.items.push(newItem);
    saveContext(context);

    vscode.window.showInformationMessage(`CC HUD: Pinned ${relativePath}`);
}

export function calculateContextPercent(contextTokenLimit: number): number {
    const context = loadContext();
    const planPath = getAbsolutePath('.cc/plan.md');

    let totalChars = 0;

    // Sum included items
    for (const item of context.items) {
        if (item.included) {
            totalChars += item.sizeChars;
        }
    }

    // Add plan.md size
    if (planPath) {
        try {
            const planContent = fs.readFileSync(planPath, 'utf8');
            totalChars += planContent.length;
        } catch (error) {
            // File doesn't exist or can't be read, ignore
        }
    }

    // chars / 4 = tokens (approx)
    const estimatedTokens = totalChars / 4;
    const percent = Math.round((estimatedTokens / contextTokenLimit) * 100);

    return Math.min(percent, 100);
}
