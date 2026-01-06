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
        const match = line.match(/^(\s*)-\s*\[([ x~>!])\]\s*(.+)$/);

        if (match) {
            const indent = match[1].length;
            const statusChar = match[2];
            const text = match[3];

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
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }

            if (stack.length === 0) {
                rootItems.push(item);
            } else {
                stack[stack.length - 1].item.children.push(item);
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

export function getStatusIcon(status: TodoItem['status']): string {
    switch (status) {
        case 'done':
            return '$(check)';
        case 'in_progress':
            return '$(sync~spin)';
        case 'blocked':
            return '$(warning)';
        default:
            return '$(circle-outline)';
    }
}

export function toggleCheckbox(content: string, line: number): string {
    const lines = content.split('\n');
    const targetLine = lines[line - 1]; // Convert to 0-indexed

    if (!targetLine) {
        return content;
    }

    const match = targetLine.match(/^(\s*-\s*\[)([ x~>!])(\].*)$/);
    if (!match) {
        return content;
    }

    const currentStatus = match[2];
    let newStatus: string;

    // Toggle: pending -> in_progress -> done -> pending
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
        default:
            newStatus = ' ';
    }

    lines[line - 1] = match[1] + newStatus + match[3];
    return lines.join('\n');
}
