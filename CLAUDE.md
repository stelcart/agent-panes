# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run compile` - Build TypeScript to out/
- `npm run watch` - Watch mode
- `npm run package` - Build VSIX

## What This Is

VS Code extension providing a HUD for Claude Code. Communicates via files in `.cc/` directory—treats CC as an external process.

Four sidebar panes: Todo, Plan, Thinking, Context. Entry point is `src/extension.ts`.

## Architecture

### Key Files
- `src/extension.ts` - Entry point, registers commands and providers
- `src/initialize.ts` - Workspace setup, creates hooks and config files
- `src/pinnedFileWatcher.ts` - Watches pinned files for size changes
- `src/context.ts` - Context data model and file size tracking
- `src/providers/` - WebviewView providers for each pane

### Claude Code Hooks
The extension installs hooks in `.claude/hooks/` that sync with Claude Code:
- `sync-plan.js` - Syncs TodoWrite output to `.cc/plan.md`
- `log-activity.js` - Logs tool usage to `.cc/cc.log`

Hook settings are in `.claude/settings.local.json`.

## Critical: Checkbox Format

The `.cc/plan.md` file uses these checkbox markers:
```
- [ ] pending
- [x] done
- [>] in progress
- [!] blocked
```
Indentation creates hierarchy. See `src/planParser.ts` for parsing logic.

## File Integration

Extension watches:
- `.cc/plan.md` - Plan/Todo panes (debounced 100ms)
- `.cc/cc.log` - Thinking pane (fs.watch, no debounce)
- `.cc/context.json` - Context pane (debounced 100ms)
- Pinned files - Individual watchers with 300ms debounce

Config lives at `.vscode/cc-hud.json`

## Context Pane Notes

- Pinned file sizes update automatically when files change
- Deleted files show warning indicator with `sizeChars: 0`
- Token estimation uses `chars / 4` (industry standard for BPE tokenizers)
- Claude uses proprietary tokenizer, so all estimates are approximate
