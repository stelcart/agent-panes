export function escapeHtml(text: string, options?: { escapeSingleQuotes?: boolean }): string {
    if (typeof text !== 'string') {
        return '';
    }
    let result = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    if (options?.escapeSingleQuotes === true) {
        result = result.replace(/'/g, '&#39;');
    }
    return result;
}
