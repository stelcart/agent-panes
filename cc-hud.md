# CC HUD — MVP VS Code Extension (Internal Plan in .cc/)

## Role
You are implementing a VS Code extension called `cc-hud`.  
This extension provides a HUD for working with Claude Code (CC) via the terminal, using files as the integration surface.  
Do NOT attempt deep or undocumented CC integration. Treat CC as an external process.

The internal plan used by the HUD lives at `.cc/plan.md`. This file is owned and maintained by you (CC), not manually by the user.

---

## High-level goals
1) One single VS Code extension (not a pack)
2) Easy install via VSIX from GitHub
3) One command to initialize the extension in an existing repo
4) Four HUD panes:
   - Todo (derived from `.cc/plan.md`)
   - Plan (renders and lightly edits `.cc/plan.md`)
   - Thinking (tails `.cc/cc.log`)
   - Context (shows pinned items and estimated context usage)

Keep the MVP simple, robust, and file-based.

---

## Files created in the workspace (on init)

Create these if missing. Never overwrite existing ones.

.cc/
- plan.md            # internal CC-managed plan
- cc.log             # stdout/stderr from CC session
- context.json       # pinned context items

.vscode/
- cc-hud.json        # config
- tasks.json         # merged to include CC logging task

---

## Initialization command

Implement command: `CC HUD: Initialize in This Workspace`

Behavior:
1) Ensure `.cc/` exists
2) Ensure `.cc/context.json` exists with:
   { "items": [] }
3) Ensure `.cc/cc.log` exists (empty file)
4) Ensure `.cc/plan.md` exists
   - If missing, create a starter internal plan template (see below)
5) Create or merge `.vscode/cc-hud.json` with defaults:
   - planPath: ".cc/plan.md"
   - logPath: ".cc/cc.log"
   - contextPath: ".cc/context.json"
   - contextTokenLimit: 200000
   - thinkingTailLines: 500
6) Create or merge `.vscode/tasks.json` adding a task:
   Label: "Claude Code (logged)"
   - mac/linux:
     bash -lc 'claude 2>&1 | tee -a .cc/cc.log'
   - windows:
     powershell -NoProfile -Command "claude 2>&1 | Tee-Object -FilePath .cc\\cc.log -Append"

Never delete or overwrite existing tasks.

---

## Starter template for `.cc/plan.md`

Create exactly this structure if the file does not exist:

# Plan

## Objective
- [ ] (fill in objective)

## Steps
- [ ] Understand the existing codebase
- [ ] Implement required changes
  - [ ] Subtask A
  - [ ] Subtask B
- [ ] Add or update tests
- [ ] Run tests and fix failures
- [ ] Cleanup and finalize

## Notes
- (short notes only)

You will update this file continuously as work progresses.

---

## Parsing rules for `.cc/plan.md`

Checkbox semantics:
- [ ] = not started
- [x] = done
- [~] or [>] = in progress
- [!] = blocked (optional support)

Indentation implies hierarchy.

This file is the single source of truth for:
- Todo pane
- Progress counts

---

## VS Code UI surfaces

Create a custom Activity Bar container: "CC HUD"

Views inside it:

1) Todo (TreeView)
   - Derived from `.cc/plan.md`
   - Shows hierarchy, status icons, done/total counts
   - Clicking a task opens `.cc/plan.md` at the correct line
   - instruction to add to CC system prompt / runbook: “Use TodoWrite/TodoRead to manage the todo list internally, and after each todo update, rewrite .cc/plan.md to match (checkboxes and hierarchy).”

2) Plan (WebviewView)
   - Renders `.cc/plan.md` as markdown
   - Checkboxes are clickable and toggle the underlying file
   - Buttons:
     - "Open plan file"
     - "Copy plan update instruction" (copies a short instruction telling CC to update `.cc/plan.md`)

3) Thinking (WebviewView)
   - Tails `.cc/cc.log`
   - Shows last N lines (default 500)
   - Auto-follow toggle
   - Search filter
   - Buttons:
     - Clear view (does not delete file)
     - Open log file

4) Context (WebviewView)
   - Shows estimated context usage
   - Lists pinned context items
   - Toggles include/exclude

Status Bar:
- Show "CC HUD: Context XX%"

---

## Context handling

Pinned context lives in `.cc/context.json`.

Context item fields:
- type: file | snippet | note
- path or label
- included: boolean
- sizeChars
- updatedAt

Context size estimate:
- chars / 4 = tokens (approx)
- Sum included items + `.cc/plan.md`
- Divide by `contextTokenLimit` to get percent

Provide command:
- "CC HUD: Pin Current File"

---

## Non-goals for MVP

Do NOT implement:
- Interactive CC execution inside the extension
- Token-accurate counting
- Patch review UI
- Multi-agent support
- Persistent memory beyond files listed above

---

## Packaging and distribution

- Single GitHub repo
- TypeScript VS Code extension
- Build VSIX via `vsce package`
- Release VSIX via GitHub Releases
- Installation via:
  - VS Code: Install from VSIX
  - or `code --install-extension cc-hud-<version>.vsix`

---

## Implementation order

1) Extension scaffold + init command
2) Config loading + file creation
3) Plan parser + Todo TreeView
4) Plan Webview with checkbox toggling
5) Thinking pane tailing `.cc/cc.log`
6) Context store + context meter + status bar

---

## Definition of Done (MVP)

- Init command works in an existing repo without breaking it
- `.cc/plan.md` drives Todo and Plan panes
- `.cc/cc.log` streams into Thinking pane
- Context meter updates when files are pinned
- Extension installs cleanly via VSIX
- README explains:
  - install
  - init
  - how CC should maintain `.cc/plan.md`