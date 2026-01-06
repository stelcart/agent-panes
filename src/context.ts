import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getAbsolutePath, getWorkspaceRoot } from './config';
import { warn, error } from './utils/logger';

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

/**
 * Validates that an item has the required ContextItem fields.
 * @param item The item to validate
 * @returns True if the item is a valid ContextItem
 */
function isValidContextItem(item: unknown): item is ContextItem {
    if (item === null || item === undefined || typeof item !== 'object') {
        return false;
    }
    const obj = item as Record<string, unknown>;

    // Required fields: type, included, sizeChars
    if (!('type' in obj) || !['file', 'snippet', 'note'].includes(obj.type as string)) {
        return false;
    }
    if (!('included' in obj) || typeof obj.included !== 'boolean') {
        return false;
    }
    if (!('sizeChars' in obj) || typeof obj.sizeChars !== 'number') {
        return false;
    }

    return true;
}

export function loadContext(): ContextData {
    const contextPath = getAbsolutePath('.cc/context.json');
    if (contextPath === undefined || contextPath === '') {
        return { items: [] };
    }

    try {
        const content = fs.readFileSync(contextPath, 'utf8');
        const parsed = JSON.parse(content);
        // Validate that result has items array
        if (parsed === null || parsed === undefined || !Array.isArray(parsed.items)) {
            warn('CC HUD: context.json does not have a valid items array');
            return { items: [] };
        }

        // Filter out invalid items and log warnings
        const validItems: ContextItem[] = [];
        for (let i = 0; i < parsed.items.length; i++) {
            if (isValidContextItem(parsed.items[i])) {
                validItems.push(parsed.items[i]);
            } else {
                warn(`CC HUD: Invalid context item at index ${i}, skipping:`, parsed.items[i]);
            }
        }

        return { items: validItems };
    } catch (err) {
        // Only log if it's not a "file not found" error
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            error('CC HUD: Failed to load context.json:', err);
        }
        return { items: [] };
    }
}

export function saveContext(data: ContextData): boolean {
    const contextPath = getAbsolutePath('.cc/context.json');
    if (contextPath === undefined || contextPath === '') {
        warn('CC HUD: Cannot save context - no workspace folder found');
        return false;
    }

    try {
        fs.writeFileSync(contextPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        error('CC HUD: Failed to save context:', err);
        return false;
    }
}

export async function pinCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('CC HUD: No active file to pin.');
        return;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot === undefined || workspaceRoot === '') {
        vscode.window.showErrorMessage('CC HUD: No workspace folder found.');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    const relativePath = path.relative(workspaceRoot, filePath);

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

/**
 * Updates the sizeChars for all pinned files based on their current file contents.
 * Handles deleted files by marking them with sizeChars: 0.
 * Returns the list of file paths that were updated (for watcher management).
 */
export function updatePinnedFileSizes(): { updated: string[]; deleted: string[] } {
    const context = loadContext();
    const updated: string[] = [];
    const deleted: string[] = [];
    let hasChanges = false;

    for (const item of context.items) {
        if (item.type === 'file' && item.path !== undefined && item.path !== '') {
            const absolutePath = getAbsolutePath(item.path);
            if (absolutePath === undefined || absolutePath === '') {
                continue;
            }

            try {
                const content = fs.readFileSync(absolutePath, 'utf8');
                const newSize = content.length;

                if (item.sizeChars !== newSize) {
                    item.sizeChars = newSize;
                    item.updatedAt = new Date().toISOString();
                    hasChanges = true;
                    updated.push(item.path);
                }
            } catch {
                // File doesn't exist or can't be read
                if (item.sizeChars !== 0) {
                    item.sizeChars = 0;
                    item.updatedAt = new Date().toISOString();
                    hasChanges = true;
                    deleted.push(item.path);
                }
            }
        }
    }

    if (hasChanges) {
        saveContext(context);
    }

    return { updated, deleted };
}

/**
 * Updates the size of a single pinned file by its path.
 * Returns true if the size was updated, false otherwise.
 */
export function updateSingleFileSizeByPath(filePath: string): boolean {
    const context = loadContext();

    // Find the item with this path
    const item = context.items.find(
        i => i.type === 'file' && i.path === filePath
    );

    if (item?.path === undefined || item.path === '') {
        return false;
    }

    const absolutePath = getAbsolutePath(item.path);
    if (absolutePath === undefined || absolutePath === '') {
        return false;
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf8');
        const newSize = content.length;

        if (item.sizeChars !== newSize) {
            item.sizeChars = newSize;
            item.updatedAt = new Date().toISOString();
            saveContext(context);
            return true;
        }
    } catch {
        // File doesn't exist or can't be read - mark as 0 size
        if (item.sizeChars !== 0) {
            item.sizeChars = 0;
            item.updatedAt = new Date().toISOString();
            saveContext(context);
            return true;
        }
    }

    return false;
}

/**
 * Gets the list of all pinned file paths (relative paths).
 */
export function getPinnedFilePaths(): string[] {
    const context = loadContext();
    return context.items
        .filter(item => item.type === 'file' && item.path !== undefined && item.path !== '')
        .map(item => item.path!);
}

export function calculateContextPercent(contextTokenLimit: number): number {
    // Guard against division by zero or negative values
    if (!Number.isFinite(contextTokenLimit) || contextTokenLimit <= 0) {
        warn(`CC HUD: Invalid contextTokenLimit (${contextTokenLimit}), returning 0%`);
        return 0;
    }

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
    if (planPath !== undefined && planPath !== '') {
        try {
            const planContent = fs.readFileSync(planPath, 'utf8');
            totalChars += planContent.length;
        } catch (err) {
            // Only log if it's not a "file not found" error
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                error('CC HUD: Failed to read plan.md for context calculation:', err);
            }
        }
    }

    // Token estimation: ~4 characters per token is the industry standard for BPE tokenizers.
    // Note: Claude uses a proprietary tokenizer (not cl100k_base), so any estimation is approximate.
    // Using tiktoken would add ~22MB bundle size and still only be an approximation.
    // For a UI gauge (not billing), this simple heuristic is sufficient.
    const estimatedTokens = totalChars / 4;
    const percent = Math.round((estimatedTokens / contextTokenLimit) * 100);

    return Math.min(percent, 100);
}
