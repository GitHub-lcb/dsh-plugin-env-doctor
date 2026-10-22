#!/usr/bin/env node
/**
 * Regenerate the plugin market index (format 1) for this repository.
 *
 * The index pins an exact Git commit, so it must be rebuilt after every release
 * commit — a stale index installs old code. Run it after `git push`:
 *
 *   node scripts/build-index.mjs --repository https://github.com/<owner>/<repo>
 *
 * Without `--repository`, the URL is derived from `git remote get-url origin`.
 * The result is validated with the same rules a market reader applies.
 *
 * Released versions are kept, not replaced: the index is the only place a user
 * can find an older version to fall back to, so regenerating it must never drop
 * history. Re-running for an already published version is a no-op.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const INDEX_TITLE = {
  en: 'LCB DSH Plugins',
  zh: 'LCB DSH 插件',
}
const INDEX_DESCRIPTION = {
  en: 'DeepSeek Harness plugins maintained by LCB.',
  zh: 'LCB 维护的 DeepSeek Harness 插件。',
}
const CATEGORIES = {
  tooling: { title: { en: 'Tooling', zh: '工具链' } },
}
const CATEGORY = 'tooling'

/** Read one JSON file relative to the repository root. */
function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

/** Parse `--name value` arguments into a plain object. */
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const name = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      args[name] = true
      continue
    }
    args[name] = value
    index += 1
  }
  return args
}

/** Canonical https repository URL, from a remote URL or an explicit flag. */
function resolveRepository(args) {
  if (typeof args.repository === 'string') return args.repository.replace(/\.git$/u, '')

  let remote
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    throw new Error('no origin remote; pass --repository https://github.com/<owner>/<repo>')
  }

  const scp = /^git@([^:]+):(.+?)(?:\.git)?$/u.exec(remote)
  if (scp) return `https://${scp[1]}/${scp[2]}`
  return remote.replace(/^https:\/\/[^/]*@/u, 'https://').replace(/\.git$/u, '')
}

/** The exact commit a market reader would install. */
function resolveCommit(args) {
  if (typeof args.commit === 'string') return args.commit
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

const args = parseArgs(process.argv.slice(2))
const manifest = readJson('package.json')
const en = readJson('locale/en.json')
const zh = readJson('locale/zh.json')

const repository = resolveRepository(args)
const commit = resolveCommit(args)

if (!/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error(`commit must be a 40-hex-digit SHA, got ${JSON.stringify(commit)}`)
}

const keywords = (manifest.keywords ?? [])
  .filter((keyword) => keyword !== 'dsh' && keyword !== 'dsh-plugin')
  .map((keyword) => String(keyword))

const output = resolve(root, args.out ?? 'index.json')

/** The index as it stands, or nothing when this is the first build. */
function readPrevious() {
  try {
    return JSON.parse(readFileSync(output, 'utf8'))
  } catch {
    return undefined
  }
}

const previous = readPrevious()
const previousPlugins = Array.isArray(previous?.plugins) ? previous.plugins : []
const previousEntry = previousPlugins.find((entry) => entry?.name === manifest.name)
const previousVersions = Array.isArray(previousEntry?.versions) ? previousEntry.versions : []

// A version already published at this commit keeps its timestamp, so rebuilding
// the index for an unrelated change does not rewrite history.
const unchanged = previousVersions.find(
  (entry) => entry?.version === manifest.version && entry?.source?.commit === commit,
)
const currentVersion = unchanged ?? {
  version: manifest.version,
  publishTimestamp: Math.floor(Date.now() / 1000),
  source: { type: 'git', url: repository, commit },
}

// Newest first. Order is cosmetic: a reader sorts versions by SemVer precedence.
const versions = [
  currentVersion,
  ...previousVersions.filter((entry) => entry?.version !== manifest.version),
]

const index = {
  format: 1,
  title: INDEX_TITLE,
  description: INDEX_DESCRIPTION,
  metadata: { categories: CATEGORIES },
  plugins: [
    {
      name: manifest.name,
      title: { en: en.meta.title, zh: zh.meta.title },
      description: { en: en.meta.description, zh: zh.meta.description },
      icon: 'icon.svg',
      author: (manifest.author?.name ?? manifest.author ?? 'lcb').toString(),
      homepage: repository,
      repository: { url: repository },
      metadata: { category: CATEGORY, keywords },
      versions,
    },
    ...previousPlugins.filter((entry) => entry?.name !== manifest.name),
  ],
}

writeFileSync(output, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
process.stdout.write(
  `wrote ${output}\n` +
    `  ${manifest.name}@${manifest.version} @ ${commit}${unchanged ? ' (unchanged)' : ''}\n` +
    `  versions: ${versions.map((entry) => entry.version).join(', ')}\n` +
    `  source: git ${repository}\n`,
)
