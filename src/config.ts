import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Configuration interface for CC HUD extension.
 * All paths are relative to the workspace root.
 */
export interface CCHudConfig {
    /** Relative path to the plan markdown file */
    planPath: string;
    /** Relative path to the Claude Code log file */
    logPath: string;
    /** Relative path to the context JSON file */
    contextPath: string;
    /** Maximum token limit for context (must be positive) */
    contextTokenLimit: number;
    /** Number of lines to tail from thinking log */
    thinkingTailLines: number;
}

/**
 * Raw config structure as read from the config file.
 * All fields are optional since users may only override specific values.
 */
interface RawFileConfig {
    planPath?: unknown;
    logPath?: unknown;
    contextPath?: unknown;
    contextTokenLimit?: unknown;
    thinkingTailLines?: unknown;
}

/**
 * Validation result for config values.
 */
interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export const defaultConfig: CCHudConfig = {
    planPath: '.cc/plan.md',
    logPath: '.cc/cc.log',
    contextPath: '.cc/context.json',
    contextTokenLimit: 200000,
    thinkingTailLines: 500
};

/**
 * Gets the workspace root path.
 * @returns The workspace root path, or undefined if no workspace is open.
 */
export function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Validates a path string.
 * @param value The value to validate
 * @param fieldName The name of the field (for error messages)
 * @returns Validation result
 */
function validatePath(value: unknown, fieldName: string): ValidationResult {
    const errors: string[] = [];

    if (value !== undefined) {
        if (typeof value !== 'string') {
            errors.push(`${fieldName} must be a string`);
        } else if (value.trim() === '') {
            errors.push(`${fieldName} must not be empty`);
        } else if (path.isAbsolute(value)) {
            errors.push(`${fieldName} must be a relative path, not absolute`);
        }
    }

    return { isValid: errors.length === 0, errors };
}

/**
 * Validates a positive number.
 * @param value The value to validate
 * @param fieldName The name of the field (for error messages)
 * @returns Validation result
 */
function validatePositiveNumber(value: unknown, fieldName: string): ValidationResult {
    const errors: string[] = [];

    if (value !== undefined) {
        if (typeof value !== 'number') {
            errors.push(`${fieldName} must be a number`);
        } else if (!Number.isFinite(value)) {
            errors.push(`${fieldName} must be a finite number`);
        } else if (value <= 0) {
            errors.push(`${fieldName} must be positive (got ${value})`);
        } else if (!Number.isInteger(value)) {
            errors.push(`${fieldName} must be an integer`);
        }
    }

    return { isValid: errors.length === 0, errors };
}

/**
 * Validates the raw config object and returns validated config.
 * Invalid values are replaced with defaults and warnings are logged.
 * @param rawConfig The raw config object from the file
 * @returns Validated config merged with defaults
 */
function validateConfig(rawConfig: RawFileConfig): CCHudConfig {
    const allErrors: string[] = [];
    const validatedConfig: Partial<CCHudConfig> = {};

    // Validate path fields
    const pathFields: (keyof Pick<CCHudConfig, 'planPath' | 'logPath' | 'contextPath'>)[] =
        ['planPath', 'logPath', 'contextPath'];

    for (const field of pathFields) {
        const result = validatePath(rawConfig[field], field);
        if (result.isValid && typeof rawConfig[field] === 'string') {
            validatedConfig[field] = rawConfig[field];
        } else {
            allErrors.push(...result.errors);
        }
    }

    // Validate numeric fields
    const numericFields: (keyof Pick<CCHudConfig, 'contextTokenLimit' | 'thinkingTailLines'>)[] =
        ['contextTokenLimit', 'thinkingTailLines'];

    for (const field of numericFields) {
        const result = validatePositiveNumber(rawConfig[field], field);
        if (result.isValid && typeof rawConfig[field] === 'number') {
            validatedConfig[field] = rawConfig[field];
        } else {
            allErrors.push(...result.errors);
        }
    }

    // Log validation errors
    if (allErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('CC HUD config validation errors (using defaults for invalid values):', allErrors);
    }

    return { ...defaultConfig, ...validatedConfig };
}

export function loadConfig(): CCHudConfig {
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot === undefined || workspaceRoot === '') {
        return defaultConfig;
    }

    const configPath = path.join(workspaceRoot, '.vscode', 'cc-hud.json');

    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const fileConfig: RawFileConfig = JSON.parse(content);
            return validateConfig(fileConfig);
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load cc-hud config:', error);
    }

    return defaultConfig;
}

export function getAbsolutePath(relativePath: string): string | undefined {
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot === undefined || workspaceRoot === '') {
        return undefined;
    }
    const resolvedPath = path.resolve(workspaceRoot, relativePath);

    // Validate that the resolved path is within the workspace folder to prevent path traversal
    const normalizedWorkspace = workspaceRoot + path.sep;
    if (!resolvedPath.startsWith(normalizedWorkspace) && resolvedPath !== workspaceRoot) {
        // eslint-disable-next-line no-console
        console.warn(
            `CC HUD: Path traversal detected. Relative path "${relativePath}" resolved to ` +
            `"${resolvedPath}" which is outside workspace root "${workspaceRoot}". Returning undefined.`
        );
        return undefined;
    }

    return resolvedPath;
}
