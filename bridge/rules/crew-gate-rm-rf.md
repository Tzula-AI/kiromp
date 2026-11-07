---
description: Kiro Crew's tool gate denies `rm -rf` of any absolute or home path, and a denied call fails the run
condition: "\\brm\\s+(?:\\\\?[\"'])?-[rR][fF](?:\\\\?[\"'])?\\s+(?:\\\\?[\"'])?[/~]"
scope: "tool:bash, tool:eval, tool:task"
interruptMode: always
---

Stop: this call contains `rm -rf /…` or `rm -rf ~…`. Kiro Crew's security gate denies that shape for every path (rule `local-destructive-rm-rf-root` / `-home`), including your own scratch, worktree and `/tmp` folders. The gate also reads `task` briefs and eval code as command text. One denied call marks the whole Kiro run as failed, even if the rest of the work succeeds.

Rewrite the call without it:
- Drop the cleanup. Scratch, worktree and `/tmp` leftovers can stay where they are. A cache you wanted to clear usually doesn't exist yet, or a re-run overwrites it.
- Clean up with the tool that owns the thing: `git worktree remove <path>`, `docker rm -f <name>`, the build tool's own clean script.
- If you really have to delete it, don't re-spell the command (other flags, a variable, or a script file) to get past the gate. Leave the files and say what's left in your report.
