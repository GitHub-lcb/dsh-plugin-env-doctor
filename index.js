/**
 * dsh-plugin-env-doctor — Host half of the bundle.
 *
 * Registers one agent-callable tool, `env_doctor`, that probes the local
 * toolchain (runtimes, CLIs, harness profile environment) and reports what is
 * installed, what is missing, and how to fix a missing entry.
 *
 * Everything runs locally. No network access, no data leaves the machine.
 */

import { exec } from 'node:child_process'

/** Per-command wall clock limit, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000

/** Longest single-line detail kept from a command's output. */
const DETAIL_LIMIT = 140

/** Plain text excerpt of a command's first line of output. */
function firstLine(text) {
  if (typeof text !== 'string') return ''
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '')
  return line ? line.trim().slice(0, DETAIL_LIMIT) : ''
}

/** True when a shell error means the executable itself is absent. */
function looksMissing(text) {
  return /not recognized|not found|command not found|no such file|无法将|不是内部或外部命令|未找到命令|找不到/i.test(
    text,
  )
}

/**
 * Decode a command's raw bytes. Windows shells emit their console code page
 * (GBK on zh-CN) far more often than UTF-8, so a pure UTF-8 decode turns the
 * "not recognized as a command" message into replacement characters and the
 * missing-executable classification silently becomes `failed`.
 */
function decodeOutput(bytes) {
  if (!bytes || bytes.length === 0) return ''
  const utf8 = bytes.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return utf8
  }
}

/**
 * Run one shell command and classify the outcome.
 *
 * @returns {{ state: 'ok'|'missing'|'failed', output: string, detail: string }}
 */
function runCommand(command, timeoutMs) {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'buffer' },
      (error, stdoutBytes, stderrBytes) => {
        const stdout = decodeOutput(stdoutBytes)
        const stderr = decodeOutput(stderrBytes)
        if (!error) {
          const output = firstLine(stdout) || firstLine(stderr)
          resolve({ state: 'ok', output, detail: output })
          return
        }
        const raw = `${stderr}\n${stdout}\n${error.message || ''}`
        const killed = error.killed === true || error.signal === 'SIGTERM'
        if (killed) {
          resolve({ state: 'failed', output: '', detail: `timed out after ${timeoutMs} ms` })
          return
        }
        if (looksMissing(raw)) {
          resolve({ state: 'missing', output: '', detail: 'command not found on PATH' })
          return
        }
        const detail = firstLine(stderr) || firstLine(stdout) || firstLine(error.message)
        resolve({
          state: 'failed',
          output: '',
          detail: `exit code ${typeof error.code === 'number' ? error.code : 'unknown'}${detail ? `: ${detail}` : ''}`,
        })
      },
    )
  })
}

/**
 * The check table. `command` is tried first, `fallback` only when the first
 * attempt reports the executable as missing (a second spelling of the same
 * tool, never a different tool).
 */
const CHECKS = [
  {
    id: 'node',
    label: 'Node.js',
    command: 'node --version',
    required: true,
    hint: 'install Node.js 20 or newer',
  },
  {
    id: 'npm',
    label: 'npm',
    command: 'npm --version',
    required: true,
    hint: 'ships with Node.js; reinstall Node.js if it is absent',
  },
  {
    id: 'pnpm',
    label: 'pnpm',
    command: 'pnpm --version',
    required: false,
    hint: 'npm install -g pnpm',
  },
  {
    id: 'git',
    label: 'git',
    command: 'git --version',
    required: true,
    hint: 'install Git and put it on PATH',
  },
  {
    id: 'gh',
    label: 'GitHub CLI',
    command: 'gh --version',
    required: false,
    hint: 'install the GitHub CLI to create and push repositories from a shell',
  },
  {
    id: 'python',
    label: 'Python',
    command: 'python --version',
    fallback: 'py -3 --version',
    required: false,
    hint: 'install Python 3 for the Office, document, and data skills',
  },
  {
    id: 'docker',
    label: 'Docker',
    command: 'docker --version',
    required: false,
    hint: 'install Docker Desktop to build and run containers',
  },
]

/** One non-command check: the harness profile this Host process runs under. */
const PROFILE_CHECK = {
  id: 'profile',
  label: 'Harness profile',
  required: false,
  hint: 'launch dsh with a profile name to set these variables',
  probe() {
    const profile = process.env.DSH_PROFILE
    const directory = process.env.DSH_PROFILE_DIR
    if (!profile && !directory) {
      return { status: 'info', detail: 'not launched with a profile' }
    }
    const parts = []
    if (profile) parts.push(`profile=${profile}`)
    if (directory) parts.push(`dir=${directory}`)
    return { status: 'ok', detail: parts.join(', ') }
  },
}

/**
 * @param {{ id: string, label: string, command?: string, fallback?: string,
 *           required: boolean, hint: string, probe?: () => { status: string, detail: string } }} check
 */
async function runCheck(check, timeoutMs) {
  const base = { id: check.id, label: check.label, required: check.required }

  if (check.probe) {
    const result = check.probe()
    const entry = { ...base, status: result.status }
    if (result.detail) entry.detail = result.detail
    return entry
  }

  const attempt = async (command) => runCommand(command, timeoutMs)
  let result = await attempt(check.command)
  if (result.state === 'missing' && check.fallback) {
    const retried = await attempt(check.fallback)
    if (retried.state !== 'missing') result = retried
  }

  if (result.state === 'ok') {
    const entry = { ...base, status: 'ok' }
    if (result.output) entry.version = result.output
    return entry
  }

  const entry = { ...base, status: result.state }
  if (result.detail) entry.detail = result.detail
  if (check.hint) entry.hint = check.hint
  return entry
}

/** JSON Schema for the tool's structured value. */
const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        ok: { type: 'integer' },
        missing: { type: 'integer' },
        failed: { type: 'integer' },
        info: { type: 'integer' },
      },
      required: ['total', 'ok', 'missing', 'failed', 'info'],
      additionalProperties: false,
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'missing', 'failed', 'info'] },
          required: { type: 'boolean' },
          version: { type: 'string' },
          detail: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['id', 'label', 'status', 'required'],
        additionalProperties: false,
      },
    },
    environment: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        node: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['platform', 'node', 'cwd'],
      additionalProperties: false,
    },
  },
  required: ['ok', 'summary', 'checks', 'environment'],
  additionalProperties: false,
}

const MARKS = { ok: ' OK ', missing: 'MISS', failed: 'FAIL', info: 'INFO' }

/** Render the structured value as an aligned plain-text report. */
function renderReport(value) {
  const checks = Array.isArray(value?.checks) ? value.checks : []
  const environment = value?.environment ?? {}
  const width = checks.reduce(
    (widest, check) => Math.max(widest, String(check.label ?? '').length),
    0,
  )

  const lines = [
    `env_doctor — ${environment.platform ?? process.platform} · host node ${environment.node ?? process.version}`,
  ]
  if (environment.cwd) lines.push(`host cwd: ${environment.cwd}`)
  lines.push('')

  for (const check of checks) {
    const mark = MARKS[check.status] ?? 'INFO'
    const detail = check.status === 'ok' ? (check.version ?? check.detail ?? '') : (check.detail ?? '')
    const hint = check.status === 'missing' && check.hint ? `  → ${check.hint}` : ''
    const label = String(check.label ?? check.id ?? '').padEnd(width)
    lines.push(`[${mark}] ${label}  ${detail}${hint}`.trimEnd())
  }

  const summary = value?.summary
  if (summary) {
    lines.push('')
    lines.push(
      `${summary.ok}/${summary.total} ok · ${summary.missing} missing · ${summary.failed} failed`,
    )
  }
  if (value?.ok === false) {
    lines.push('Required tooling is missing. Install or fix the entries marked MISS or FAIL.')
  }

  return lines.join('\n')
}

/** The agent-callable tool definition. */
const definition = {
  name: 'env_doctor',
  description:
    'Run a local environment health check: reports which runtimes and CLIs are installed (Node.js, npm, pnpm, Git, GitHub CLI, Python, Docker) with their versions, plus the harness profile variables, and says what is missing and how to install it. Use before a build, install, or publish, and whenever a command seems unavailable. Read-only; runs no project code and makes no network requests.',
  parameters: {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: { type: 'string', enum: [...CHECKS.map((check) => check.id), PROFILE_CHECK.id] },
        description:
          'Run only these check ids (node, npm, pnpm, git, gh, python, docker, profile). Omit to run every check.',
      },
      timeoutMs: {
        type: 'integer',
        minimum: 500,
        maximum: 30000,
        description: 'Per-command timeout in milliseconds. Defaults to 5000.',
      },
    },
    additionalProperties: false,
  },
  output: {
    schema: outputSchema,
    render(_args, value) {
      return [{ type: 'text', text: renderReport(value) }]
    },
  },
  isConcurrencySafe() {
    return true
  },
  timeoutMs: 60000,
  async execute(args) {
    const requested = Array.isArray(args?.checks) && args.checks.length > 0 ? new Set(args.checks) : null
    const timeoutMs = Math.min(
      Math.max(Number.isInteger(args?.timeoutMs) ? args.timeoutMs : DEFAULT_TIMEOUT_MS, 500),
      30000,
    )

    const selected = CHECKS.filter((check) => !requested || requested.has(check.id))
    if (!requested || requested.has(PROFILE_CHECK.id)) selected.push(PROFILE_CHECK)

    const checks = await Promise.all(selected.map((check) => runCheck(check, timeoutMs)))

    const summary = { total: checks.length, ok: 0, missing: 0, failed: 0, info: 0 }
    for (const check of checks) {
      if (check.status in summary && check.status !== 'total') summary[check.status] += 1
    }

    const ok = checks.every((check) => !check.required || check.status === 'ok')

    return {
      ok,
      summary,
      checks,
      environment: {
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        cwd: process.cwd(),
      },
    }
  },
}

export const name = 'env-doctor'

export const inject = ['tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(definition))
}
