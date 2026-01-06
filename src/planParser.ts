/** Valid status characters for checkbox markers in plan files */
export type StatusChar = ' ' | 'x' | '>' | '!';

export interface TodoItem {
    text: string;
    status: 'pending' | 'done' | 'in_progress' | 'blocked';
    line: number;
    indent: number;
    children: TodoItem[];
}

export interface ParsedPlan {
    items: TodoItem[];
    totalCount: number;
    doneCount: number;
    inProgressCount: number;
}

export function parsePlan(content: string): ParsedPlan {
    const lines = content.split('\n');
    const rootItems: TodoItem[] = [];
    const stack: { item: TodoItem; indent: number }[] = [];

    let totalCount = 0;
    let doneCount = 0;
    let inProgressCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {
            continue;
        }
        const match = line.match(/^(\s*)-\s*\[([ x~>!])\]\s*(.+)$/);

        if (match) {
            const indent = (match[1] ?? '').length;
            const statusChar = (match[2] ?? ' ') as StatusChar | '~';
            const text = match[3] ?? '';

            let status: TodoItem['status'];
            switch (statusChar) {
                case 'x':
                    status = 'done';
                    doneCount++;
                    break;
                case '~':
                case '>':
                    status = 'in_progress';
                    inProgressCount++;
                    break;
                case '!':
                    status = 'blocked';
                    break;
                default:
                    status = 'pending';
            }
            totalCount++;

            const item: TodoItem = {
                text,
                status,
                line: i + 1, // 1-indexed for VS Code
                indent,
                children: []
            };

            // Find parent based on indentation
            while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
                stack.pop();
            }

            if (stack.length === 0) {
                rootItems.push(item);
            } else {
                const parent = stack[stack.length - 1];
                if (parent) {
                    parent.item.children.push(item);
                }
            }

            stack.push({ item, indent });
        }
    }

    return {
        items: rootItems,
        totalCount,
        doneCount,
        inProgressCount
    };
}

/**
 * Toggles the checkbox status at the given line number.
 * Cycle: pending -> in_progress -> done -> pending
 * Blocked items are reset to pending when toggled.
 *
 * @param content - The full content of the plan file
 * @param line - 1-indexed line number to toggle
 * @returns The modified content, or original content if toggle failed
 */
export function toggleCheckbox(content: string, line: number): string {
    // Validate line number
    if (!Number.isInteger(line) || line < 1) {
        console.warn(`[planParser] toggleCheckbox: Invalid line number ${line}, must be a positive integer`);
        return content;
    }

    const lines = content.split('\n');
    const lineIndex = line - 1; // Convert to 0-indexed

    // Check if line exists
    if (lineIndex >= lines.length) {
        console.warn(`[planParser] toggleCheckbox: Line ${line} is out of bounds (file has ${lines.length} lines)`);
        return content;
    }

    const targetLine = lines[lineIndex];

    // Handle empty or undefined lines
    if (targetLine === undefined || targetLine === '') {
        console.debug(`[planParser] toggleCheckbox: Line ${line} is empty`);
        return content;
    }

    const match = targetLine.match(/^(\s*-\s*\[)([ x~>!])(\].*)$/);
    if (!match) {
        console.debug(`[planParser] toggleCheckbox: Line ${line} does not contain a valid checkbox: "${targetLine.substring(0, 50)}..."`);
        return content;
    }

    const currentStatus = match[2] as StatusChar | '~';
    let newStatus: StatusChar;

    // Toggle: pending -> in_progress -> done -> pending
    // Blocked items are reset to pending when toggled
    switch (currentStatus) {
        case ' ':
            newStatus = '>';
            break;
        case '>':
        case '~':
            newStatus = 'x';
            break;
        case 'x':
            newStatus = ' ';
            break;
        case '!':
            // Blocked items toggle to pending
            newStatus = ' ';
            break;
        default:
            // This should never happen due to regex, but handle gracefully
            console.warn(`[planParser] toggleCheckbox: Unexpected status character '${currentStatus}' at line ${line}`);
            newStatus = ' ';
    }

    console.debug(`[planParser] toggleCheckbox: Line ${line} status changed from '${currentStatus}' to '${newStatus}'`);
    lines[lineIndex] = match[1] + newStatus + match[3];
    return lines.join('\n');
}
