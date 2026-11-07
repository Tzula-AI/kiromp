<p align="center"><img src="../assets/tzula-header-dark.png" alt="Tzula" width="100%"></p>

# cron-medic

Long-running listener that watches Kiro Crew's cron run history and, when a
job fails, starts an in-process Oh My Pi SDK session (`@oh-my-pi/pi-coding-agent`,
pinned to the installed `omp` version) to find and fix the root cause.

- Watches `~/.kiro/crew/cron-history/<job_id>.jsonl` (fs.watch + periodic
  rescan; `_index.jsonl` is skipped). First start seeds at EOF: history is
  never acted on. Truncated/rotated files restart from offset 0; a partial
  trailing line waits until it is complete.
- A record with `status == "failure"` is an incident. Signature = job id +
  error text with numbers, hex/random ids, timestamps and temp/sandbox file
  names stripped (`src/signature.ts`).
- Throttle (`src/throttle.ts`): one active fix per job (failures arriving
  while it is queued/running fold into it), same signature not retried within
  6h, at most 3 attempts per job per rolling 24h (then `giving_up` is logged
  once), global concurrency 1.
- Fix session: cwd `~/.kiro/crew`, user's normal omp settings/auth/model,
  persisted under `~/.omp/agent/sessions/`, hard timeout 45 min. Prompt:
  `src/prompt.ts`.
- Output: `~/.local/state/kirocrew-cron-medic/runs/<UTC-ts>-<jobid>.md`
  (incident, final report, session file, prompt) and JSON log lines on
  stdout. State (cursors, throttle, queue): `…/state.json`, written atomically.
- SIGTERM/SIGINT aborts running sessions (their run file is still written)
  and persists state.

## Run

```sh
bun install
bun test
bun run src/main.ts            # foreground
systemctl --user enable --now kirocrew-cron-medic   # ~/.config/systemd/user/kirocrew-cron-medic.service
journalctl --user -u kirocrew-cron-medic -f
```

## Configuration (env)

| Variable | Default |
| --- | --- |
| `CRON_MEDIC_HISTORY_DIR` | `~/.kiro/crew/cron-history` |
| `CRON_MEDIC_CRONS_FILE` | `~/.kiro/crew/crons.json` |
| `CRON_MEDIC_STATE_DIR` | `~/.local/state/kirocrew-cron-medic` |
| `CRON_MEDIC_KIRO_HOME` (session cwd) | `~/.kiro/crew` |
| `CRON_MEDIC_OMP_SESSIONS_DIR` | `~/.omp/agent/sessions` |
| `CRON_MEDIC_BRIDGE_REPO` | `~/.local/lib/omp-kiro-bridge` |
| `CRON_MEDIC_CONCURRENCY` | `1` |
| `CRON_MEDIC_SIGNATURE_COOLDOWN_HOURS` | `6` |
| `CRON_MEDIC_MAX_ATTEMPTS` / `CRON_MEDIC_ATTEMPT_WINDOW_HOURS` | `3` / `24` |
| `CRON_MEDIC_TIMEOUT_MINUTES` | `45` |
| `CRON_MEDIC_RESCAN_SECONDS` | `60` |
| `CRON_MEDIC_DRY_RUN` | unset (`1` logs the prompt instead of spawning a session) |
| `CRON_MEDIC_MODEL` | unset (omp settings decide) |

Upgrading omp: bump `@oh-my-pi/pi-coding-agent` in `package.json` to the
installed `omp --version`, `bun install`, restart the unit.

Dry-run override (while the bridge is being edited):
`~/.config/systemd/user/kirocrew-cron-medic.service.d/dry-run.conf` sets
`CRON_MEDIC_DRY_RUN=1`. Dry runs count as attempts in `state.json`, so going
live also drops that state (the medic re-seeds at EOF):

```sh
systemctl --user stop kirocrew-cron-medic
rm ~/.config/systemd/user/kirocrew-cron-medic.service.d/dry-run.conf ~/.local/state/kirocrew-cron-medic/state.json
systemctl --user daemon-reload && systemctl --user start kirocrew-cron-medic
```
