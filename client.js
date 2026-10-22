/**
 * dsh-plugin-env-doctor — Client half.
 *
 * Renders the `env_doctor` tool call as a status checklist instead of the plain
 * text report, by parsing the same text the model receives. It therefore needs
 * no private shape from the call node: the only contract is the report format
 * the Host half writes.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-env-doctor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** One row per check, e.g. `[MISS] pnpm  command not found on PATH  → npm i -g pnpm`. */
    const ROW = /^\[( OK |MISS|FAIL|INFO)\] (.+?)\s{2,}(.*)$/u
    const SUMMARY = /^\d+\/\d+ ok\b/u
    const HINT = /\s{2,}→\s+/u

    const STATUS = {
      ok: { key: 'ok', color: 'var(--dsw-alias-state-success-primary)' },
      missing: { key: 'missing', color: 'var(--dsw-alias-state-warn-primary)' },
      failed: { key: 'failed', color: 'var(--dsw-alias-state-error-primary)' },
      info: { key: 'info', color: 'var(--dsw-alias-state-idle-primary)' },
    }

    const LABEL_TO_STATUS = { OK: 'ok', MISS: 'missing', FAIL: 'failed', INFO: 'info' }

    const STRINGS = {
      en: { title: 'Environment check', checking: 'checking…', empty: 'no report', cwd: 'host cwd' },
      zh: { title: '环境体检', checking: '正在检查…', empty: '没有报告', cwd: '宿主目录' },
    }

    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

    /**
     * Depth-first search for the first ContentBlock[] anywhere in the call
     * node. The card only needs the rendered text, so the exact nesting the
     * Conversation layer uses does not matter.
     */
    function findContentBlocks(value, depth) {
      if (depth > 6 || value === null || typeof value !== 'object') return null
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every((item) => item && typeof item === 'object' && typeof item.type === 'string')) {
          return value
        }
        for (const item of value) {
          const found = findContentBlocks(item, depth + 1)
          if (found) return found
        }
        return null
      }
      for (const item of Object.values(value)) {
        const found = findContentBlocks(item, depth + 1)
        if (found) return found
      }
      return null
    }

    /** Text of a block's text content, joined for parsing. */
    function contentText(block) {
      const blocks = findContentBlocks(block, 0)
      if (!blocks) return ''
      return blocks
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
    }

    /** Turn the rendered report back into rows the card can lay out. */
    function parseReport(text) {
      const rows = []
      let meta = ''
      let cwd = ''
      let summary = ''

      for (const line of text.split(/\r?\n/u)) {
        const match = ROW.exec(line)
        if (match) {
          const status = LABEL_TO_STATUS[match[1].trim()] ?? 'info'
          let detail = match[3]
          let hint = ''
          const hintAt = detail.search(HINT)
          if (hintAt >= 0) {
            hint = detail.slice(hintAt).replace(HINT, '').trim()
            detail = detail.slice(0, hintAt).trim()
          } else {
            detail = detail.trim()
          }
          rows.push({ label: match[2].trim(), status, detail, hint })
          continue
        }
        if (line.startsWith('env_doctor')) {
          meta = line.replace(/^env_doctor\s*—\s*/u, '').trim()
          continue
        }
        if (line.startsWith('host cwd:')) {
          cwd = line.slice('host cwd:'.length).trim()
          continue
        }
        if (SUMMARY.test(line)) summary = line.trim()
      }

      if (rows.length === 0) return null
      return { rows, meta, cwd, summary }
    }

    /** Active locale id, sniffed from the locale snapshot without assuming its fields. */
    function useLanguage(ctx) {
      const subscribe = React.useCallback(
        (notify) => (ctx.locale ? ctx.locale.subscribe(notify) : () => {}),
        [ctx],
      )
      const read = React.useCallback(() => {
        if (!ctx.locale) return 'en'
        try {
          const snapshot = ctx.locale.getSnapshot() ?? {}
          for (const key of ['locale', 'id', 'current', 'language', 'preferred']) {
            const value = snapshot[key]
            if (typeof value === 'string' && value !== '') return value.toLowerCase().startsWith('zh') ? 'zh' : 'en'
          }
        } catch {
          /* fall through to the default */
        }
        return 'en'
      }, [ctx])
      return React.useSyncExternalStore(subscribe, read, read)
    }

    const card = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-layer-1)',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-primary)',
      maxWidth: 720,
    }

    const headerRow = {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10,
      flexWrap: 'wrap',
      paddingBottom: 6,
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    }

    const titleStyle = { fontWeight: 600, fontSize: 13 }
    const metaStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontFamily: MONO }
    const summaryStyle = {
      marginLeft: 'auto',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 12,
      fontVariantNumeric: 'tabular-nums',
    }

    const list = { display: 'flex', flexDirection: 'column', gap: 4 }

    const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: 8, minHeight: 20 }

    const dot = { width: 8, height: 8, borderRadius: 4, marginTop: 6, flex: '0 0 auto' }

    const labelStyle = {
      flex: '0 0 auto',
      minWidth: 116,
      color: 'var(--dsw-alias-label-primary)',
    }

    const detailStyle = { flex: '1 1 auto', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontFamily: MONO, fontSize: 12, opacity: 0.9 }
    const cwdStyle = {
      fontFamily: MONO,
      fontSize: 11,
      color: 'var(--dsw-alias-label-secondary)',
      opacity: 0.8,
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      paddingTop: 6,
      wordBreak: 'break-all',
    }

    function ReportRow({ row }) {
      const status = STATUS[row.status] ?? STATUS.info
      return h(
        'div',
        { style: rowStyle },
        h('span', { style: { ...dot, background: status.color }, 'aria-hidden': true }),
        h('span', { style: labelStyle, title: row.label }, row.label),
        h(
          'div',
          { style: detailStyle },
          row.detail ? h('span', { style: row.status === 'ok' ? { fontFamily: MONO } : undefined }, row.detail) : null,
          row.hint ? h('div', null, h('span', { style: hintStyle }, `→ ${row.hint}`)) : null,
        ),
      )
    }

    function EnvDoctorCard(props) {
      const language = useLanguage(props.ctx)
      const t = STRINGS[language] ?? STRINGS.en
      const text = React.useMemo(
        () => (props.phase === 'result' ? contentText(props.block) : ''),
        [props.phase, props.block],
      )
      const report = React.useMemo(() => parseReport(text), [text])

      if (!report) {
        return h(
          'div',
          { style: { ...card, flexDirection: 'row', alignItems: 'center', gap: 8 } },
          h('span', { style: { ...dot, marginTop: 0, background: 'var(--dsw-alias-state-idle-primary)' }, 'aria-hidden': true }),
          h('span', { style: titleStyle }, t.title),
          h('span', { style: metaStyle }, props.phase === 'result' ? t.empty : t.checking),
        )
      }

      return h(
        'div',
        { style: card },
        h(
          'div',
          { style: headerRow },
          h('span', { style: titleStyle }, t.title),
          report.meta ? h('span', { style: metaStyle }, report.meta) : null,
          report.summary ? h('span', { style: summaryStyle }, report.summary) : null,
        ),
        h('div', { style: list }, report.rows.map((row, index) => h(ReportRow, { key: `${row.label}-${index}`, row }))),
        report.cwd ? h('div', { style: cwdStyle }, `${t.cwd}: ${report.cwd}`) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const Card = (props) => h(EnvDoctorCard, { ...props, ctx })
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register({ name: 'tool.call.toolview', key: 'env_doctor' }, Card),
        )
      },
    }
  },
})
