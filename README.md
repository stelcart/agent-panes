# CC HUD

A VS Code extension that provides a heads-up display for working with [Claude Code](https://claude.ai/code) via the terminal. Uses files as the integration surface with automatic hook-based synchronization.

![CC HUD Screenshot](cc%20hud%20screenshot.png)

## Features

- **Real-time sync** with Claude Code via hooks—no manual piping required
- **Four panes**: Todo tree, Plan view, Activity log, Context tracker
- **Token tracking**: Shows actual API token usage from Claude Code sessions
- **Status bar**: Quick glance at context usage percentage
- **Auto-updating**: Hooks update silently when the extension upgrades

## Installation

### From VSIX (Recommended)

1. Download the latest `.vsix` from [Releases](https://github.com/stelcart/agent-panes/releases/latest)
2. In VS Code: `Cmd+Shift+P` → "Extensions: Install from VSIX..."
3. Select the downloaded file

Or via command line:
```bash
code --install-extension cc-hud-*.vsix
```

### From Source

```bash
git clone https://github.com/stelcart/agent-panes.git
cd agent-panes
npm install
npm run package
code --install-extension cc-hud-0.2.0.vsix
```

## Quick Start

1. Open a workspace in VS Code
2. Run `Cmd+Shift+P` → "CC HUD: Initialize in This Workspace"
3. This creates:
   - `.cc/plan.md` — Your task plan (synced from TodoWrite)
   - `.cc/cc.log` — Activity log (auto-populated by hooks)
   - `.cc/context.json` — Pinned context items
   - `.cc/stats.json` — Session token tracking
   - `.claude/hooks/` — Hook scripts for Claude Code integration
   - `.claude/settings.local.json` — Hook configuration

4. Open the **CC HUD** sidebar (robot icon in Activity Bar)
5. Start Claude Code in your terminal—the HUD updates automatically!

## The Four Panes

### Todo Pane
- Tree view of tasks parsed from `.cc/plan.md`
- Status icons: pending (circle), in-progress (sync), done (checkmark), blocked (warning)
- Progress counters for parent tasks (e.g., "3/5")
- Click any task to jump to that line in the plan file

### Plan Pane
- Rendered markdown with full formatting (headings, code blocks, tables)
- **Interactive checkboxes**: Click to cycle through pending → in-progress → done
- Toolbar: "Open File" and "Copy Prompt" buttons

### Thinking Pane
- Real-time activity log from Claude Code
- **Auto-follow**: Automatically scrolls to latest activity
- **Search**: Filter log entries by keyword
- Shows last 500 lines by default (configurable)

### Context Pane
- **Context meter**: Visual bar showing token usage with color coding
  - Green (<50%), Orange (50-80%), Red (>80%)
- **Token breakdown**: Session + Plan + Pinned files
- **Pinned items list**: Toggle inclusion, see file sizes, remove items
- **Compaction warning**: Notifies when Claude Code compacted context

## How It Works

CC HUD installs Claude Code hooks that automatically sync data:

| Hook | Trigger | Output |
|------|---------|--------|
| `sync-plan.js` | TodoWrite | Updates `.cc/plan.md` |
| `log-activity.js` | Any tool use | Appends to `.cc/cc.log` |
| `sync-context.js` | Any tool use, SessionStart | Updates `.cc/stats.json` |
| `pre-compact.js` | PreCompact | Records compaction event |

The extension watches these files and updates the UI in real-time (100-300ms debounce).

### Token Tracking

The Context pane shows token usage from multiple sources:
- **Session tokens**: Actual API usage parsed from Claude Code transcript (preferred)
- **Plan tokens**: Size of `.cc/plan.md`
- **Pinned tokens**: Sum of included pinned file sizes
- **Estimation**: ~4 characters = 1 token (fallback when API data unavailable)

## Commands

| Command | Description |
|---------|-------------|
| **CC HUD: Initialize in This Workspace** | Set up hooks and create `.cc/` directory |
| **CC HUD: Pin Current File** | Add current file to context tracking |
| **CC HUD: Refresh Views** | Force refresh all panes |
| **CC HUD: Reset & Reinitialize** | Clear state and reinitialize workspace |

## Plan File Format

The `.cc/plan.md` file uses checkbox markers:

```markdown
## Objective
- [ ] Build the feature

## Current Tasks
- [>] Currently working on this
- [x] Already completed
- [ ] Not started yet
  - [ ] Subtask (indented)
- [!] Blocked by something
```

**Status markers:** `[ ]` pending, `[x]` done, `[>]` in progress, `[!]` blocked

## Configuration

Edit `.vscode/cc-hud.json`:

```json
{
  "planPath": ".cc/plan.md",
  "logPath": ".cc/cc.log",
  "contextPath": ".cc/context.json",
  "statsPath": ".cc/stats.json",
  "contextTokenLimit": 200000,
  "thinkingTailLines": 500
}
```

## Development

### Running in Development Mode

1. Open this repo in VS Code
2. Press `F5` (or Run → Start Debugging)
3. A new **Extension Development Host** window opens with CC HUD loaded
4. Test the extension in that window

### Development Workflow

```
┌─────────────────────┐      F5       ┌─────────────────────┐
│   VS Code           │ ───────────►  │  Extension Dev Host │
│   (this repo)       │               │  (test window)      │
│                     │               │                     │
│   Edit code here    │               │   Use CC HUD here   │
└─────────────────────┘               └─────────────────────┘
```

1. Make changes to files in `src/`
2. Run `npm run compile` (or use `npm run watch` for auto-compile)
3. In the Extension Dev Host window: `Cmd+Shift+P` → "Developer: Reload Window"
4. Your changes are now active

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Build TypeScript to `out/` |
| `npm run watch` | Watch mode (auto-recompile on save) |
| `npm run lint` | Run ESLint on source files |
| `npm run package` | Create `.vsix` for distribution |

### Project Structure

```
src/
├── extension.ts          # Entry point, registers commands & providers
├── initialize.ts         # Workspace setup, hook scripts (source of truth)
├── planParser.ts         # Parses checkbox markdown into tree
├── config.ts             # Loads .vscode/cc-hud.json
├── context.ts            # Manages pinned context items
├── pinnedFileWatcher.ts  # Watches pinned files for size changes
├── providers/
│   ├── todoTreeProvider.ts      # Tree view for tasks
│   ├── planViewProvider.ts      # Webview with interactive markdown
│   ├── thinkingViewProvider.ts  # Real-time log viewer
│   └── contextViewProvider.ts   # Token meter and pinned files
└── utils/
    ├── fileCache.ts      # Cache invalidation helpers
    ├── html.ts           # HTML escaping utilities
    └── markdown.ts       # XSS-safe markdown rendering
```

### Hook Development

Hook scripts are embedded as string constants in `src/initialize.ts`. To modify hooks:

1. Edit the constant in `src/initialize.ts` (e.g., `SYNC_PLAN_HOOK`)
2. Run `npm run compile`
3. Re-run "CC HUD: Initialize in This Workspace" in your test project

The extension automatically updates hooks when users update the extension.
