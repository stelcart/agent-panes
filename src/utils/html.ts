export function escapeHtml(text: string, options?: { escapeSingleQuotes?: boolean }): string {
    let result = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    if (options?.escapeSingleQuotes) {
        result = result.replace(/'/g, '&#39;');
    }
    return result;
}
