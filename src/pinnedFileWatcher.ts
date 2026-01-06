import * as vscode from 'vscode';
import * as path from 'path';
import { getAbsolutePath } from './config';
import { getPinnedFilePaths, updateSingleFileSizeByPath } from './context';

/**
 * Manages file watchers for pinned files.
 * Creates watchers dynamically when files are pinned and removes them when unpinned.
 * Uses debouncing to avoid excessive updates when files change rapidly.
 */
export class PinnedFileWatcher implements vscode.Disposable {
    private readonly DEBOUNCE_DELAY = 300; // ms
    private watchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private onFileUpdatedEmitter = new vscode.EventEmitter<string>();
    private disposables: vscode.Disposable[] = [];

    /**
     * Event fired when a pinned file's size has been updated.
     * The payload is the relative path of the file that was updated.
     */
    public readonly onFileUpdated = this.onFileUpdatedEmitter.event;

    constructor() {
        this.disposables.push(this.onFileUpdatedEmitter);
    }

    /**
     * Synchronizes watchers with the current list of pinned files.
     * Call this when the context.json changes (files pinned/unpinned).
     */
    public syncWatchers(): void {
        const pinnedPaths = getPinnedFilePaths();
        const pinnedSet = new Set(pinnedPaths);

        // Remove watchers for files that are no longer pinned
        // Collect keys first to avoid modifying map during iteration
        const watchedPaths = Array.from(this.watchers.keys());
        for (const watchedPath of watchedPaths) {
            if (!pinnedSet.has(watchedPath)) {
                this.removeWatcher(watchedPath);
            }
        }

        // Add watchers for newly pinned files
        for (const filePath of pinnedPaths) {
            if (!this.watchers.has(filePath)) {
                this.addWatcher(filePath);
            }
        }
    }

    /**
     * Adds a file watcher for a specific pinned file.
     */
    private addWatcher(relativePath: string): void {
        const absolutePath = getAbsolutePath(relativePath);
        if (!absolutePath) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Create a glob pattern that matches this specific file
        // We use a RelativePattern to scope the watcher to the workspace
        const pattern = new vscode.RelativePattern(workspaceFolder, relativePath);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Handle file changes with debouncing
        const handleFileEvent = () => {
            this.debouncedUpdate(relativePath);
        };

        watcher.onDidChange(handleFileEvent);
        watcher.onDidDelete(handleFileEvent);
        watcher.onDidCreate(handleFileEvent); // Handle recreated files

        this.watchers.set(relativePath, watcher);
    }

    /**
     * Removes a file watcher for a specific path.
     */
    private removeWatcher(relativePath: string): void {
        const watcher = this.watchers.get(relativePath);
        if (watcher) {
            watcher.dispose();
            this.watchers.delete(relativePath);
        }

        // Clear any pending debounce timer
        const timer = this.debounceTimers.get(relativePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(relativePath);
        }
    }

    /**
     * Updates a file's size with debouncing to prevent rapid updates.
     */
    private debouncedUpdate(relativePath: string): void {
        // Clear existing timer if any
        const existingTimer = this.debounceTimers.get(relativePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new debounced timer
        const timer = setTimeout(() => {
            this.debounceTimers.delete(relativePath);
            const updated = updateSingleFileSizeByPath(relativePath);
            if (updated) {
                this.onFileUpdatedEmitter.fire(relativePath);
            }
        }, this.DEBOUNCE_DELAY);

        this.debounceTimers.set(relativePath, timer);
    }

    /**
     * Disposes all watchers and clears timers.
     */
    public dispose(): void {
        // Clear all debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Dispose all watchers
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();

        // Dispose other disposables
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
