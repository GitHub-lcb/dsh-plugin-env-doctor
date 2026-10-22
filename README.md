# dsh-plugin-env-doctor

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that answers one question before a build, an install, or a publish: **is the local toolchain actually there?**

It registers a single agent-callable tool, `env_doctor`, which probes the machine and reports each runtime and CLI with its exact version, marks what is missing, and prints the command that fixes it.

```text
env_doctor — win32-x64 · host node v24.21.0
host cwd: C:\Users\you\.dsh\profiles\desktop

[ OK ] Node.js          v24.11.1
[ OK ] npm              11.12.1
[MISS] pnpm             command not found on PATH  → npm install -g pnpm
[ OK ] git              git version 2.50.1.windows.1
[MISS] GitHub CLI       command not found on PATH  → install the GitHub CLI to create and push repositories from a shell
[ OK ] Python           Python 3.13.3
[MISS] Docker           command not found on PATH  → install Docker Desktop to build and run containers
[INFO] Harness profile  not launched with a profile

4/8 ok · 3 missing · 0 failed
```

## What it checks

| id | Tool | Required | Why it matters |
| --- | --- | --- | --- |
| `node` | Node.js | yes | every JavaScript plugin and skill runs on it |
| `npm` | npm | yes | package installation |
| `pnpm` | pnpm | no | workspace builds in many repositories |
| `git` | git | yes | version control and worktrees |
| `gh` | GitHub CLI | no | creating and pushing repositories from a shell |
| `python` | Python (`python`, then `py -3`) | no | Office, document, and data skills |
| `docker` | Docker | no | building and running containers |
| `profile` | Harness profile variables | no | `DSH_PROFILE` / `DSH_PROFILE_DIR` of the running Host |

`ok` in the tool result is `false` only when a **required** check is not `ok`; optional tooling never fails the run.

## Install

### From a local checkout

Point the plugin manager at this directory. It links the checkout and adds the bundle row to the profile:

```text
plugin_manager  action: install_bundle  target: <absolute path to this directory>
```

### From npm

```text
plugin_manager  action: install_bundle  target: dsh-plugin-env-doctor
```

### From the market index

This repository publishes a [plugin market index](https://github.com/deepseek-ai/deepseek-harness) at `index.json`, so the plugin is installable without a checkout:

1. Add the index URL once in **Settings → Plugins** (Discover), for example
   `https://<owner>.github.io/dsh-plugin-env-doctor/index.json`.
2. Then find and install it through the market:

```text
plugin_market   action: list_plugins  target: https://<owner>.github.io/dsh-plugin-env-doctor/index.json
plugin_manager  action: install_bundle target: git+https://github.com/<owner>/dsh-plugin-env-doctor.git#<commit>
```

`index.json` pins an exact commit, so an install is reproducible; a stale index installs old code, which is why it is regenerated on every release.

Then call the tool from any session:

```text
env_doctor
env_doctor  checks: ["pnpm", "gh"]
env_doctor  timeoutMs: 10000
```

## Design notes

- **Read-only and offline.** It runs fixed `<tool> --version` commands with a timeout and never executes project code, installs anything, or touches the network.
- **No new session events.** Nothing is written to the session log; the tool returns a structured value and a rendered text report.
- **Failures are classified, not guessed.** A missing executable (`command not found` / `不是内部或外部命令`), a timeout, and a non-zero exit are reported as `missing`, `failed`, and `failed` with the exit code respectively, so a broken install is not silently mistaken for an absent one.
- **A Host tool plus a Client card.** The tool is useful to the agent on its own; the Client half renders the same report as a checklist, so a person reading the transcript gets the status at a glance. The card parses the report the Host already writes, so neither half depends on the other's internals.

## Layout

```text
package.json        bundle manifest → dsh.bundle.patch, locale + icon exports
cordis.patch.yml    inserts the env-doctor row
index.js            the Host plugin: CHECKS table + env_doctor tool
locale/en.json      Plugin Manager title and description
locale/zh.json      same, in Chinese
icon.svg            bundle icon
client.js           the Client card, registered for tool.call.toolview
index.json          generated plugin market index (format 1)
scripts/build-index.mjs  regenerates index.json, keeping released versions
AGENTS.md           the plugin development playbook
```

## Releasing

The market entry pins a commit, so rebuilding the index is part of every release:

```bash
git push
node scripts/build-index.mjs          # reads the origin remote and HEAD
git add index.json
git commit -m "chore: refresh market index"
git push
```

Pass `--repository https://github.com/<owner>/<repo>` when `origin` is not set yet.

## Updating

There is no in-place upgrade action: a market reports `update-available`, and the update itself is an install. A same-named package replaces itself in place, so removing first is optional:

```text
plugin_manager  action: install_bundle  target: <the install target the index returns>
```

Restart the app when the Host half changed; reload the page when the Client half changed. Every released version stays in `index.json`, so an older one remains installable by its own pinned commit:

```text
plugin_market  action: list_versions  target: <index URL>  name: dsh-plugin-env-doctor
```

Version status in Discover comes from comparing the index against the profile, and the index document is cached for up to ten minutes — a fresh release can take that long to show up.

## License

MIT
