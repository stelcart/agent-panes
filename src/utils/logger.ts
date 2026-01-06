import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Gets the shared output channel, creating it if necessary.
 * This is lazily initialized to avoid creating the channel before VS Code is ready.
 */
function getOutputChannel(): vscode.OutputChannel {
    outputChannel ??= vscode.window.createOutputChannel('CC HUD');
    return outputChannel;
}

/**
 * Logs an info message to the CC HUD output channel.
 * Equivalent to console.log.
 */
export function log(message: string, ...args: unknown[]): void {
    const channel = getOutputChannel();
    const formattedArgs = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    channel.appendLine(`${message}${formattedArgs}`);
}

/**
 * Logs a warning message to the CC HUD output channel.
 * Equivalent to console.warn.
 */
export function warn(message: string, ...args: unknown[]): void {
    const channel = getOutputChannel();
    const formattedArgs = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    channel.appendLine(`[WARN] ${message}${formattedArgs}`);
}

/**
 * Logs an error message to the CC HUD output channel.
 * Equivalent to console.error.
 */
export function error(message: string, ...args: unknown[]): void {
    const channel = getOutputChannel();
    const formattedArgs = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    channel.appendLine(`[ERROR] ${message}${formattedArgs}`);
}

/**
 * Logs a debug message to the CC HUD output channel.
 * Equivalent to console.debug.
 */
export function debug(message: string, ...args: unknown[]): void {
    const channel = getOutputChannel();
    const formattedArgs = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    channel.appendLine(`[DEBUG] ${message}${formattedArgs}`);
}

/**
 * Formats an argument for logging.
 */
function formatArg(arg: unknown): string {
    if (arg === null) {
        return 'null';
    }
    if (arg === undefined) {
        return 'undefined';
    }
    if (typeof arg === 'object') {
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }
    return String(arg);
}

/**
 * Disposes of the output channel.
 * Call this in the extension's deactivate function.
 */
export function disposeLogger(): void {
    if (outputChannel !== undefined) {
        outputChannel.dispose();
        outputChannel = undefined;
    }
}
