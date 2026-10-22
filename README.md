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
- **Host-only bundle.** No Client module: the capability is the tool, and it is useful to the agent as well as to a person reading the transcript. A custom tool card is a possible follow-up, not a requirement.

## Layout

```text
package.json        bundle manifest → dsh.bundle.patch, locale + icon exports
cordis.patch.yml    inserts the env-doctor row
index.js            the Host plugin: CHECKS table + env_doctor tool
locale/en.json      Plugin Manager title and description
locale/zh.json      same, in Chinese
icon.svg            bundle icon
```

## License

MIT
