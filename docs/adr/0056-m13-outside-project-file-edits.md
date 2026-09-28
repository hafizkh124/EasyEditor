# ADR 0056 — Agent edits to files outside the project: per-write approval + sibling `.bak`

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0016](./0016-m8-agentic-loop-supersedes-fixed-tasks.md), [ADR-0018](./0018-m8-folder-projects-and-sync.md), [ADR-0019](./0019-m8-context-rules-and-checkpoints.md), [ADR-0026](./0026-m9-studio-shell-and-governance-modes.md)

## Context

Until M13 every agent write was confined to the open project folder, where two
safety nets already exist: `backupChapter` (a per-write copy under
`.easyeditor/backups/`) and task checkpoints ("Undo this task"). The M13
blueprint asks for the agent to work on the scholar's **own** documents anywhere
on the machine ("open my test Word file and add a table"). Those files have
neither net, and plan-level approval (ADR-0026) was never meant to cover them —
once a plan is approved, or in Auto mode, individual writes are not confirmed.

## Decision

1. **A document tool targets `chapter` (in-project) OR `path` (absolute).**
   `dispatch.ts` `resolveEditTarget` routes: a chapter → the existing
   checkpoint + `backupChapter`; a path inside the open project → treated as
   an in-project write; a path outside it → steps 2–4.
2. **Validation** (`electron/agent/externalFiles.ts` `resolveExternalTarget`):
   absolute path, existing file, `.docx`/`.rtf` only, not a system directory
   (reuses `paths.ts`), not under `%APPDATA%` / `%LOCALAPPDATA%` / `~\AppData`,
   and not open in Word (a `~$…` owner file beside it — editing underneath
   Word would be silently overwritten on Word's next save).
3. **Per-write approval, in every mode** (`electron/agent/fileApproval.ts`):
   the run blocks on a `file-approval-pending` progress event; the renderer
   shows "مجوزہ اقدامات برائے منظوری" with the path, the backup name and one
   line per operation; Approve / Cancel reply via `approveFileWrite`. A
   10-minute timeout, a closed window, or no approval channel at all (headless,
   eval, web) resolves to **reject**. A decline returns `{error}` so the model
   is told nothing changed and does not retry.
4. **A sibling backup first**: `<name>.<yyyyMMdd_HHmmss>.bak` next to the
   original (never overwriting an earlier one — same-second backups get
   `_2`, `_3`). It is visible in Explorer, so the scholar can recover without
   the app. The run result carries `externalEdits: [{path, backup, ops}]`;
   the result card offers **"ورڈ میں کھولیں"** (`openDocument`, document
   extensions only — never an executable) and **"اصل حالت بحال کریں"**
   (`restoreFromBackup`, which accepts only a backup this module made for that
   exact file, and refuses while the file is open in Word).
5. **Content changes still land as tracked changes** (ADR-0016 control 2).
6. **Plan/Auto no longer require an open project on desktop.** With none open,
   the system prompt says so, and every project-bound write tool returns
   "open a project first" instead of dereferencing a null root
   (`WRITES_WITHOUT_PROJECT` lists the path-based exceptions).

## Consequences

- External edits are **not** part of task checkpoints: "Undo this task" covers
  the project; "Restore original" covers each outside file. Two buttons, two
  scopes — deliberately, since a checkpoint lives inside a project that may
  not exist.
- The `.bak` files accumulate beside the scholar's documents; they are never
  deleted automatically.
- **Not done:** detecting an un-hydrated OneDrive placeholder (Node exposes no
  file-attribute API for it); a failed read there surfaces as a Word open
  error instead.
