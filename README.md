# CC HUD

A VS Code extension that provides a heads-up display for working with [Claude Code](https://claude.ai/code) via the terminal. Uses files as the integration surface—no deep CC integration required.

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
code --install-extension cc-hud-0.0.1.vsix
```

## Quick Start

1. Open a workspace in VS Code
2. Run `Cmd+Shift+P` → "CC HUD: Initialize in This Workspace"
3. This creates:
   - `.cc/plan.md` — Your task plan (managed by Claude Code)
   - `.cc/cc.log` — Log file for the Thinking pane
   - `.cc/context.json` — Pinned context items
   - `.vscode/tasks.json` — Adds a "Claude Code (logged)" task

4. Open the **CC HUD** sidebar (robot icon in Activity Bar)

## The Four Panes

| Pane | Purpose |
|------|---------|
| **Todo** | Tree view of tasks from `.cc/plan.md`. Click to jump to line. |
| **Plan** | Rendered markdown with clickable checkboxes. |
| **Thinking** | Tails `.cc/cc.log`. Has auto-follow and search. |
| **Context** | Shows pinned files and estimated token usage. |

## Using with Claude Code

### Running Claude Code with Logging

Use the included VS Code task to pipe output to the log file:

`Cmd+Shift+P` → "Tasks: Run Task" → "Claude Code (logged)"

Or run manually:
```bash
claude 2>&1 | tee -a .cc/cc.log
```

### Plan File Format

Claude Code should maintain `.cc/plan.md` using this checkbox format:

```markdown
## Objective
- [ ] Build the feature

## Steps
- [>] Currently working on this
- [x] Already completed
- [ ] Not started yet
  - [ ] Subtask (indented)
- [!] Blocked by something
```

**Status markers:** `[ ]` pending, `[x]` done, `[>]` in progress, `[!]` blocked

### Pinning Context

Pin files to track estimated context usage:

`Cmd+Shift+P` → "CC HUD: Pin Current File"

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

### Sharing Development Builds

To share your local build with another machine or teammate:

```bash
# Build the VSIX
npm run package

# Copy cc-hud-0.0.1.vsix to target machine, then:
code --install-extension cc-hud-0.0.1.vsix
```

Or commit and push, then on the other machine:
```bash
git pull
npm install
npm run package
code --install-extension cc-hud-0.0.1.vsix
```

### Project Structure

```
src/
├── extension.ts          # Entry point, registers commands & providers
├── initialize.ts         # Creates .cc/ directory structure
├── planParser.ts         # Parses checkbox markdown
├── config.ts             # Loads .vscode/cc-hud.json, path validation
├── context.ts            # Manages pinned context items
├── pinnedFileWatcher.ts  # Watches pinned files for size changes
├── providers/
│   ├── todoTreeProvider.ts
│   ├── planViewProvider.ts
│   ├── thinkingViewProvider.ts
│   └── contextViewProvider.ts
└── utils/
    ├── fileCache.ts      # Cache invalidation helpers
    ├── html.ts           # HTML escaping utilities
    └── markdown.ts       # XSS-safe markdown rendering
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Build TypeScript to `out/` |
| `npm run watch` | Watch mode (auto-recompile on save) |
| `npm run lint` | Run ESLint on source files |
| `npm run package` | Create `.vsix` for distribution |

## Configuration

After initialization, edit `.vscode/cc-hud.json`:

```json
{
  "planPath": ".cc/plan.md",
  "logPath": ".cc/cc.log",
  "contextPath": ".cc/context.json",
  "contextTokenLimit": 200000,
  "thinkingTailLines": 500
}
```

## License

MIT
