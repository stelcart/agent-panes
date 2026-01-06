import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface CCHudConfig {
    planPath: string;
    logPath: string;
    contextPath: string;
    contextTokenLimit: number;
    thinkingTailLines: number;
}

export const defaultConfig: CCHudConfig = {
    planPath: '.cc/plan.md',
    logPath: '.cc/cc.log',
    contextPath: '.cc/context.json',
    contextTokenLimit: 200000,
    thinkingTailLines: 500
};

export function loadConfig(): CCHudConfig {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return defaultConfig;
    }

    const configPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'cc-hud.json');

    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const fileConfig = JSON.parse(content);
            return { ...defaultConfig, ...fileConfig };
        }
    } catch (error) {
        console.error('Failed to load cc-hud config:', error);
    }

    return defaultConfig;
}

export function getAbsolutePath(relativePath: string): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return undefined;
    }
    const workspacePath = workspaceFolder.uri.fsPath;
    const resolvedPath = path.resolve(workspacePath, relativePath);

    // Validate that the resolved path is within the workspace folder to prevent path traversal
    if (!resolvedPath.startsWith(workspacePath + path.sep) && resolvedPath !== workspacePath) {
        return undefined;
    }

    return resolvedPath;
}
