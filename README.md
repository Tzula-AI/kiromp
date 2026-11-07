<p align="center"><img src="assets/tzula-header-dark.png" alt="Tzula" width="100%"></p>

# Kiromp

Kiro Crew on the outside, Oh My Pi on the inside.

Kiromp is everything needed to run [Oh My Pi](https://github.com/can1357/oh-my-pi) (`omp`) as the agent harness behind [Kiro Crew](https://github.com/kirodotdev/KiroCrew), plus a Kiro Crew app that makes omp visible in the dashboard.

## Why two harnesses

Kiro Crew and omp are good at different layers, and neither wants to become the other.

Kiro Crew is the operating layer around agents. It has the dashboard, persistent memory and lessons, scheduled jobs, Slack and other channels, background sessions, artifacts, the app store and a tool gate that asks a human before risky calls. It runs whatever harness you plug into its Pi backend.

omp is the harness itself, the loop that actually reads code and edits files. Its tooling is noticeably better for real coding work: hash-anchored edits that don't drift, LSP and AST tools, a persistent eval kernel, TTSR rules that stop a bad tool call before it runs, native subagents with their own models, and one config for every model provider. Its auth gateway can also pool several provider subscriptions and load-balance across them, so we aren't locked to one vendor or one account.

Using both means we keep Crew's memory, scheduling and approvals without being stuck with a weaker inner loop, and we can swap or upgrade the inner loop without losing any of that. The cost is a protocol gap: Crew expects `pi`, and out of the box omp's subagents, steering and gate approvals don't show up in Crew. The bridge closes that gap.

```mermaid
flowchart LR
  User --> Crew[Kiro Crew dashboard / Slack / crons]
  Crew -- ACP --> Bridge[bridge: wrapper + shim]
  Bridge -- pi RPC --> Omp[omp harness]
  Omp -. reporter / gate-relay .-> Bridge
  Omp --> Providers[(Claude / OpenAI / OpenRouter ...)]
  Crew --> Apps[app: omp-dashboard]
  Apps -. read .-> OmpData[(~/.omp sessions, stats.db, omp usage)]
```

## What's in here

| Path | What it is |
|---|---|
| [`bridge/`](bridge/) | The omp to Kiro Crew bridge. Puts omp behind Crew's `pi-acp` interface, streams omp subagents into Crew's Subagents tab, routes subagent tool calls through Crew's gate and supports mid-turn steering. Also includes TTSR rules and `cron-medic`, a service that starts an omp session to fix failing Crew crons. See [bridge/README.md](bridge/README.md). |
| [`apps/omp-dashboard/`](apps/omp-dashboard/) | Kiro Crew app, one sidebar page with four tabs. Overview: API-equivalent spend over 24h to 30d, a 14-day strip, the limits closest to their cap and what the agents are doing now. Spend: breakdowns by provider, model and agent type from `~/.omp/stats.db`. Limits: `omp usage` per provider and account, with a bell notification when a limit hits 90% or runs out. Agents: a tally of omp subagent runs with charts and a live transcript inspector. Adds a composer chip that opens the limits. See [apps/omp-dashboard/README.md](apps/omp-dashboard/README.md). |

## Setup

### Prerequisites

- [Kiro Crew](https://github.com/kirodotdev/KiroCrew) installed, with the gateway running (`kirocrew status`).
- [Oh My Pi](https://github.com/can1357/oh-my-pi) installed and logged in to at least one provider. Check with `omp --version` and `omp usage`.
- Node 20+, plus Bun for cron-medic.
- `~/.local/bin` on your PATH, ahead of any other `pi` or `pi-acp`.

### 1. Clone

```sh
git clone git@github.com:Tzula-AI/kiromp.git ~/kiromp
cd ~/kiromp
```

The rest of this guide assumes `~/kiromp`. If you clone somewhere else, use that path instead.

### 2. Install the real pi-acp adapter

The bridge wraps the real `pi-acp`, so it has to be installed where the wrapper expects it:

```sh
mkdir -p ~/.kiro/crew/pi-acp
cd ~/.kiro/crew/pi-acp && npm install pi-acp@0.0.34 && cd -
```

If you put it somewhere else, set `PI_ACP_REAL` to its `dist/index.js`.

### 3. Put the bridge in front of pi and pi-acp

Kiro Crew's Pi backend looks up `pi` and `pi-acp` on PATH. Point both names at the bridge:

```sh
chmod +x ~/kiromp/bridge/pi-shim.mjs ~/kiromp/bridge/pi-acp-wrapper.mjs
ln -sf ~/kiromp/bridge/pi-shim.mjs       ~/.local/bin/pi
ln -sf ~/kiromp/bridge/pi-acp-wrapper.mjs ~/.local/bin/pi-acp
```

Check that `which pi` points at the shim and `pi --version` prints omp's version.

The shim runs `~/.bun/bin/omp` by default. If omp is installed elsewhere, set `OMP_BIN`, for example in the environment the gateway starts with.

### 4. Switch Kiro Crew to the Pi backend

```sh
kirocrew config set agent.acp_backend pi
```

Restart the gateway, then open a new chat. Replies now come from omp. When omp spawns subagents they show up in the Subagents tab, and their tool calls ask for approval through Crew's gate. `kirocrew doctor` reports any missing piece.

### 5. Optional: TTSR rules

The rules stop tool calls that Crew's gate would deny before they run, because a single denied call fails the whole Crew run. They only load for sessions under Crew's workspace. Link them into the workspace your Crew agents run in:

```sh
mkdir -p <crew-workspace>/.agents
ln -sfn ~/kiromp/bridge/rules <crew-workspace>/.agents/rules
```

To check that they load, run `omp ttsr list` from a folder inside that workspace.

### 6. Optional: cron-medic

cron-medic watches Crew's cron history and starts an omp session to fix jobs that keep failing:

```sh
cd ~/kiromp/bridge/cron-medic && bun install
mkdir -p ~/.config/systemd/user
cp kirocrew-cron-medic.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kirocrew-cron-medic
```

The unit file assumes the repo is at `~/kiromp`, so change `WorkingDirectory` if you cloned it somewhere else. Set `CRON_MEDIC_DRY_RUN=1` in the unit to try it out without letting it make changes. See [bridge/cron-medic/README.md](bridge/cron-medic/README.md).

### 7. Dashboard app

```sh
kirocrew app install ~/kiromp/apps/omp-dashboard
```

Then open **Apps → Library** in the dashboard and enable **OMP Dashboard**. It's a third-party app, so Crew asks you to trust it first. That prompt is expected, and `kirocrew app enable` is refused from the CLI until you've trusted it. Once it's enabled, an **OMP Dashboard** entry appears in the sidebar and a usage chip appears next to the message box.

The app works without the bridge. It only needs `omp` and `~/.omp`. If you installed the older `omp-usage` or `omp-agents` apps, uninstall them, or both will poll `omp usage` and send the same alerts:

```sh
kirocrew app uninstall omp-usage
kirocrew app uninstall omp-agents
```

### Undo

Remove the two symlinks in `~/.local/bin`, run `kirocrew config set agent.acp_backend ""` and restart the gateway. Disable the app from the Library page.

## Tests

```sh
node --test bridge/test/
(cd bridge/cron-medic && bun install && bun test)
(cd apps/omp-dashboard && python -m pytest -q)
(cd apps/omp-dashboard/ui && npm install && bun test)
```

Four bridge tests fail when they run inside a live Crew session, because the session's env vars leak into them. They pass in a clean shell.

## Known limits

- Crew apps can't add buttons to the top bar, so the usage monitor is a tab on the dashboard page plus a composer chip instead of a navbar button. The chip can only turn amber, not red, and Crew shows at most two chips across all apps.
- Spend is API-equivalent, the list-price value of the tokens from omp's own stats database. Subscription accounts aren't billed that. The cost views are hidden when `~/.omp/stats.db` is missing.
- The subagent-card fixes inside Crew's chat (stable card IDs across turns, one card per run) are changes to Crew's own code and aren't included here. The bridge works without them, but cards are less tidy.
- The dashboard app has not been run in a real Crew dashboard yet. It was checked against a local harness that signs requests the way the gateway does, with stub host modules, so the real page mounting is unverified.

## License

MIT
