import { escapeHtml } from './html';

/**
 * Options for rendering markdown to HTML
 */
export interface RenderOptions {
    /** JavaScript function name to call when a checkbox is clicked, receives line number */
    onCheckboxClick?: string;
}

/**
 * Pattern for safe URL protocols (https, http, vscode, or anchor links)
 */
const SAFE_URL_PATTERN = /^(https?:|vscode:|#)/i;

/**
 * Format inline markdown elements (bold, italic, code, links, strikethrough)
 * @param text - The text to format
 * @returns HTML string with inline formatting applied
 */
export function formatInlineMarkdown(text: string): string {
    // First escape HTML
    let result = escapeHtml(text);

    // Bold: **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_ (but not inside words)
    result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    result = result.replace(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/g, '<em>$1</em>');

    // Inline code: `text`
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links: [text](url) - with URL protocol validation
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
        const escapedText = linkText; // Already escaped above
        const trimmedUrl = url.trim();

        // Only allow safe protocols
        if (SAFE_URL_PATTERN.test(trimmedUrl)) {
            return `<a href="${escapeHtml(trimmedUrl)}" title="${escapeHtml(trimmedUrl)}">${escapedText}</a>`;
        }
        // Don't render unsafe URLs as links - just show the text
        return escapedText;
    });

    // Strikethrough: ~~text~~
    result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return result;
}

/**
 * Close nested list elements
 * @param stack - The list indentation stack
 * @returns HTML closing tags for the lists
 */
function closeList(stack: number[]): string {
    let html = '';
    for (let i = 0; i < stack.length; i++) {
        html += '</li></ul>';
    }
    return html;
}

/**
 * Parse table cells from a line
 * @param line - Table row line with | separators
 * @returns Array of cell contents
 */
function parseTableCells(line: string): string[] {
    return line.split('|')
        .slice(1, -1) // Remove empty first/last from | at start/end
        .map(cell => cell.trim());
}

/**
 * Render a markdown table to HTML
 * @param lines - Array of table row lines
 * @returns HTML table string
 */
function renderTable(lines: string[]): string {
    if (lines.length < 2) {
        // Not a valid table (need at least header + separator)
        return lines.map(l => `<p>${formatInlineMarkdown(l)}</p>`).join('');
    }

    const headerLine = lines[0];
    const separatorLineRaw = lines[1];
    if (headerLine === undefined || separatorLineRaw === undefined) {
        return lines.map(l => `<p>${formatInlineMarkdown(l)}</p>`).join('');
    }

    // Check if second line is a separator (contains only -, :, |, and spaces)
    const separatorLine = separatorLineRaw.trim();
    const isSeparator = /^\|[\s\-:|]+\|$/.test(separatorLine);

    if (!isSeparator) {
        // Not a valid table
        return lines.map(l => `<p>${formatInlineMarkdown(l)}</p>`).join('');
    }

    const headerCells = parseTableCells(headerLine);
    const dataRows = lines.slice(2).map(parseTableCells);

    let tableHtml = '<table><thead><tr>';
    for (const cell of headerCells) {
        tableHtml += `<th>${formatInlineMarkdown(cell)}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';

    for (const row of dataRows) {
        tableHtml += '<tr>';
        for (let i = 0; i < headerCells.length; i++) {
            const cellContent = row[i] ?? '';
            tableHtml += `<td>${formatInlineMarkdown(cellContent)}</td>`;
        }
        tableHtml += '</tr>';
    }

    tableHtml += '</tbody></table>';
    return tableHtml;
}

/**
 * Render a code block to HTML
 * @param content - The code block content (without backticks)
 * @returns HTML pre/code element
 */
function renderCodeBlock(content: string): string {
    return `<pre><code>${escapeHtml(content.trim())}</code></pre>`;
}

/**
 * Get checkbox display character based on status
 * @param status - Checkbox status character (space, x, >, ~, !)
 * @returns HTML entity for the checkbox
 */
function getCheckboxChar(status: string): string {
    switch (status) {
        case 'x': return '&#9745;';  // Checked box
        case '>':
        case '~': return '&#9655;';  // Right triangle (in progress)
        case '!': return '&#9888;';  // Warning (blocked)
        default:  return '&#9744;';  // Empty box
    }
}

/**
 * Get CSS class for checkbox status
 * @param status - Checkbox status character
 * @returns CSS class name
 */
function getCheckboxClass(status: string): string {
    switch (status) {
        case 'x': return 'done';
        case '>':
        case '~': return 'in-progress';
        case '!': return 'blocked';
        default:  return '';
    }
}

/**
 * Render markdown content to HTML
 * @param content - Markdown string to render
 * @param options - Optional rendering options
 * @returns HTML string
 */
export function renderMarkdownToHtml(content: string, options?: RenderOptions): string {
    const lines = content.split('\n');
    let html = '';
    let inList = false;
    let listStack: number[] = [];
    let inCodeBlock = false;
    let codeBlockContent = '';
    let inTable = false;
    let tableLines: string[] = [];

    const checkboxClickHandler = options?.onCheckboxClick ?? 'toggleCheckbox';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {
            continue;
        }
        const lineNum = i + 1;

        // Code blocks
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                html += renderCodeBlock(codeBlockContent);
                codeBlockContent = '';
                inCodeBlock = false;
            } else {
                if (inList) { html += closeList(listStack); inList = false; listStack = []; }
                inCodeBlock = true;
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent += line + '\n';
            continue;
        }

        // Table rows (lines with | that aren't in code blocks)
        const isTableRow = line.includes('|') && line.trim().startsWith('|');
        if (isTableRow) {
            if (!inTable) {
                if (inList) { html += closeList(listStack); inList = false; listStack = []; }
                inTable = true;
                tableLines = [];
            }
            tableLines.push(line);
            continue;
        } else if (inTable) {
            // End of table - render it
            html += renderTable(tableLines);
            inTable = false;
            tableLines = [];
        }

        // Horizontal rule
        if (line.match(/^(-{3,}|_{3,}|\*{3,})$/)) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += '<hr>';
            continue;
        }

        // Headers
        if (line.startsWith('# ')) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += `<h1>${formatInlineMarkdown(line.slice(2))}</h1>`;
            continue;
        }
        if (line.startsWith('## ')) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += `<h2>${formatInlineMarkdown(line.slice(3))}</h2>`;
            continue;
        }
        if (line.startsWith('### ')) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += `<h3>${formatInlineMarkdown(line.slice(4))}</h3>`;
            continue;
        }
        if (line.startsWith('#### ')) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += `<h4>${formatInlineMarkdown(line.slice(5))}</h4>`;
            continue;
        }

        // Blockquotes
        if (line.startsWith('> ')) {
            if (inList) { html += closeList(listStack); inList = false; listStack = []; }
            html += `<blockquote>${formatInlineMarkdown(line.slice(2))}</blockquote>`;
            continue;
        }

        // Checkbox items
        const checkboxMatch = line.match(/^(\s*)-\s*\[([ x~>!])\]\s*(.+)$/);
        if (checkboxMatch) {
            const indentStr = checkboxMatch[1] ?? '';
            const status = checkboxMatch[2] ?? ' ';
            const text = checkboxMatch[3] ?? '';
            const indent = indentStr.length;

            if (!inList) {
                html += '<ul>';
                inList = true;
                listStack.push(indent);
            } else {
                while (listStack.length > 0 && (listStack[listStack.length - 1] ?? 0) > indent) {
                    html += '</ul></li>';
                    listStack.pop();
                }
                if (listStack.length === 0 || (listStack[listStack.length - 1] ?? 0) < indent) {
                    html += '<ul>';
                    listStack.push(indent);
                }
            }

            const statusClass = getCheckboxClass(status);
            const checkboxChar = getCheckboxChar(status);

            html += `<li class="${statusClass}"><span class="checkbox" onclick="${checkboxClickHandler}(${lineNum})">${checkboxChar}</span> ${formatInlineMarkdown(text)}`;
            continue;
        }

        // Regular list items
        const listMatch = line.match(/^(\s*)-\s+(.+)$/);
        if (listMatch) {
            const indentStr = listMatch[1] ?? '';
            const text = listMatch[2] ?? '';
            const indent = indentStr.length;

            if (!inList) {
                html += '<ul>';
                inList = true;
                listStack.push(indent);
            }

            html += `<li>${formatInlineMarkdown(text)}</li>`;
            continue;
        }

        // Numbered list items
        const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (numberedMatch) {
            const text = numberedMatch[2] ?? '';
            if (!inList) {
                html += '<ol>';
                inList = true;
                listStack.push(0);
            }
            html += `<li>${formatInlineMarkdown(text)}</li>`;
            continue;
        }

        // Empty lines close lists
        if (line.trim() === '') {
            if (inList) {
                html += closeList(listStack);
                inList = false;
                listStack = [];
            }
            html += '<br>';
            continue;
        }

        // Regular paragraphs
        if (inList) {
            html += closeList(listStack);
            inList = false;
            listStack = [];
        }
        html += `<p>${formatInlineMarkdown(line)}</p>`;
    }

    // Clean up any remaining open elements
    if (inList) {
        html += closeList(listStack);
    }

    if (inTable) {
        html += renderTable(tableLines);
    }

    if (inCodeBlock) {
        html += renderCodeBlock(codeBlockContent);
    }

    return html;
}
