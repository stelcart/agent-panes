# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run compile` - Build TypeScript to out/
- `npm run watch` - Watch mode
- `npm run package` - Build VSIX

## What This Is

VS Code extension providing a HUD for Claude Code. Communicates via files in `.cc/` directory—treats CC as an external process.

Four sidebar panes: Todo, Plan, Thinking, Context. Entry point is `src/extension.ts`.

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

Extension watches: `.cc/plan.md`, `.cc/cc.log`, `.cc/context.json`
Config lives at `.vscode/cc-hud.json`
