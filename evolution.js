import { readdir, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { assertAgentKey } from './binding.js'

export const EVOLUTION_OPEN = '[[EVOLUTION]]'
export const EVOLUTION_CLOSE = '[[/EVOLUTION]]'
export const MAIN_AGENT_KEY = 'main'
export const MAIN_AGENT_FILENAME = 'AGENTS.md'
export const MAIN_AGENT_BLOCK_OPEN = '<!-- smart-subagent:main-evolution:start -->'
export const MAIN_AGENT_BLOCK_CLOSE = '<!-- smart-subagent:main-evolution:end -->'
export const MAX_PREFERCMD = 40
export const MAX_MEMORY = 25
export const MAX_INJECT_CHARS = 6000
/** Informational per-file guidance (prefercmd.md / memory.md). The stored
 * files are NOT hard-capped: entries are kept whole and deduplicated, and the
 * bounded guarantee lives at injection time (MAX_INJECT_CHARS). */
export const MAX_FILE_CHARS = 4000

/** Default project-scoped evolution directory, derived from the DSH launch
 * working directory (the same base the bindings directory resolves from).
 * Each project/conversation keeps its own evolution files, isolated from the
 * others. Override with SMART_SUBAGENT_EVOLUTION_DIR or `evolutionDir`. */
export function defaultEvolutionDir() {
  return join(process.cwd(), '.smart_subagent', 'evolution')
}

export function projectEvolutionDir(projectRoot) {
  return join(resolve(projectRoot), '.smart_subagent', 'evolution')
}

export function legacyProjectEvolutionDir(projectRoot) {
  return join(resolve(projectRoot), '.dsh', 'smart-subagent', 'evolution')
}

function mainAgentBlock(newline = '\n') {
  return [
    MAIN_AGENT_BLOCK_OPEN,
    '',
    '## Workspace evolution',
    '',
    'At the beginning of relevant work, read (create them if missing):',
    '',
    '- `.smart_subagent/evolution/main/prefercmd.md`',
    '- `.smart_subagent/evolution/main/memory.md`',
    '',
    'Reuse verified commands and lessons when applicable. After completing verified work,',
    'update these files with concise project-specific commands and lessons. Do not record',
    'secrets, personal data, unverified assumptions, or transient errors.',
    '',
    MAIN_AGENT_BLOCK_CLOSE,
  ].join(newline)
}

export function removeMainAgentBlock(text) {
  const open = text.indexOf(MAIN_AGENT_BLOCK_OPEN)
  const close = text.indexOf(MAIN_AGENT_BLOCK_CLOSE)
  if (open === -1 && close === -1) return text
  if (open === -1 || close < open) {
    throw new Error('smart-subagent: malformed main-agent evolution block')
  }
  const end = close + MAIN_AGENT_BLOCK_CLOSE.length
  return (text.slice(0, open).trimEnd() + text.slice(end)).trimEnd() + (text.endsWith('\n') ? '\n' : '')
}

export function addMainAgentBlock(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const clean = removeMainAgentBlock(text).trimEnd()
  return clean + newline + newline + mainAgentBlock(newline) + newline
}

export const EVOLUTION_REPORT_OPEN = '<!-- smart-subagent:evolution-report:start -->'
export const EVOLUTION_REPORT_CLOSE = '<!-- smart-subagent:evolution-report:end -->'

function evolutionReportBlock(newline = '\n') {
  return [
    EVOLUTION_REPORT_OPEN,
    '',
    '## Evolution reporting (auto-maintained)',
    '',
    'At the end of your run, if you verified a new command or learned a lesson that will',
    'help future runs, append a `[[EVOLUTION]]` block at the very end of your final',
    'output so it can be recorded for the next time:',
    '',
    '```markdown',
    '[[EVOLUTION]]',
    'prefercmd:',
    '- <verified command>',
    'memory:',
    '- <lesson learned>',
    '[[/EVOLUTION]]',
    '```',
    '',
    'Only report verified, reusable knowledge (no secrets, no unverified assumptions,',
    'no transient errors). If there is nothing new, omit the block entirely.',
    '',
    EVOLUTION_REPORT_CLOSE,
  ].join(newline)
}

export function hasEvolutionReportBlock(text) {
  return typeof text === 'string' && text.includes(EVOLUTION_REPORT_OPEN)
}

/** Append the evolution-report instruction block to a binding file body.
 * Idempotent: re-adding when already present is a no-op. */
export function addEvolutionReportBlock(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const clean = removeEvolutionReportBlock(text).trimEnd()
  return clean + newline + newline + evolutionReportBlock(newline) + newline
}

/** Remove the evolution-report instruction block from a binding file body.
 * Returns the original text when no block is present. */
export function removeEvolutionReportBlock(text) {
  const open = text.indexOf(EVOLUTION_REPORT_OPEN)
  const close = text.indexOf(EVOLUTION_REPORT_CLOSE)
  if (open === -1 && close === -1) return text
  if (open === -1 || close < open) {
    throw new Error('smart-subagent: malformed evolution-report block')
  }
  const end = close + EVOLUTION_REPORT_CLOSE.length
  return (text.slice(0, open).trimEnd() + text.slice(end)).trimEnd() + (text.endsWith('\n') ? '\n' : '')
}

/**
 * Ensure every `<agent_key>.md` binding file in a workspace's `agents/`
 * directory carries the evolution-report instruction block (idempotent,
 * reversible). Returns the agent keys whose files were modified.
 *
 * @param {string} agentsDir - the workspace bindings directory
 * @returns {Promise<string[]>}
 */
export async function ensureAgentReportBlocks(agentsDir) {
  const injected = []
  let entries
  try {
    entries = await readdir(agentsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return injected
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.md$/.exec(entry.name)
    if (!match) continue
    // Doc files commonly live next to bindings; never treat them as agents.
    if (match[1].toUpperCase() === 'README' || match[1].toUpperCase() === 'INDEX') continue
    const filename = join(agentsDir, entry.name)
    const text = await readFile(filename, 'utf8')
    if (hasEvolutionReportBlock(text)) continue
    await writeFile(filename, addEvolutionReportBlock(text), 'utf8')
    injected.push(match[1])
  }
  return injected
}

/**
 * One-shot workspace provisioning so evolution "just works" out of the box:
 *   1. Auto-bind the workspace-root `AGENTS.md` as the main agent when it
 *      exists and is not yet bound (adds the reversible main-evolution block).
 *   2. Auto-inject the `[[EVOLUTION]]` reporting instruction into every
 *      binding file under `agents/` (idempotent, reversible).
 * Both steps are best-effort and never throw into the caller.
 *
 * @param {string} projectRoot - workspace root
 * @param {string} agentsDir - workspace bindings directory
 * @returns {Promise<{ projectRoot: string, mainAgentBound: boolean, injected: string[] }>}
 */
export async function ensureWorkspaceProvisioned(projectRoot, agentsDir) {
  const result = { projectRoot, mainAgentBound: false, injected: [] }
  try {
    const cfg = await readMainAgentConfig(projectRoot)
    if (cfg.available && cfg.filename === '') {
      await setMainAgentConfig(projectRoot, MAIN_AGENT_FILENAME)
      result.mainAgentBound = true
    }
  } catch (error) {
    console.error(`[smart-subagent] auto-bind main agent skipped: ${error}`)
  }
  try {
    result.injected = await ensureAgentReportBlocks(agentsDir)
  } catch (error) {
    console.error(`[smart-subagent] auto-inject evolution reporting skipped: ${error}`)
  }
  return result
}

export async function readMainAgentConfig(projectRoot) {
  const root = resolve(projectRoot)
  let available = false
  try {
    available = (await stat(join(root, MAIN_AGENT_FILENAME))).isFile()
  } catch {
    available = false
  }
  let configured = ''
  try {
    const config = JSON.parse(await readFile(join(root, '.smart_subagent', 'config.json'), 'utf8'))
    if (config?.mainAgentFile === MAIN_AGENT_FILENAME) configured = MAIN_AGENT_FILENAME
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  return {
    filename: configured,
    available,
    candidates: available ? [MAIN_AGENT_FILENAME] : [],
  }
}

export async function setMainAgentConfig(projectRoot, filename) {
  const root = resolve(projectRoot)
  const next = filename === '' ? '' : String(filename)
  if (next !== '' && next !== MAIN_AGENT_FILENAME) {
    throw new Error(`smart-subagent: main agent must be the workspace-root ${MAIN_AGENT_FILENAME}`)
  }
  const previous = await readMainAgentConfig(root)
  if (previous.filename !== '') {
    const previousFile = join(root, previous.filename)
    const text = await readFile(previousFile, 'utf8')
    await writeFile(previousFile, removeMainAgentBlock(text), 'utf8')
  }
  if (next !== '') {
    const target = join(root, next)
    const text = await readFile(target, 'utf8')
    await writeFile(target, addMainAgentBlock(text), 'utf8')
    const currentEvolutionDir = projectEvolutionDir(root)
    const legacyEvolutionDir = legacyProjectEvolutionDir(root)
    const existing = await readEvolutionFilesRaw(currentEvolutionDir, MAIN_AGENT_KEY, legacyEvolutionDir)
    await writeEvolutionFiles(currentEvolutionDir, MAIN_AGENT_KEY, {
      prefercmd: existing.prefercmd,
      memory: existing.memory,
    }, legacyEvolutionDir)
  }
  const configDir = join(root, '.smart_subagent')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ mainAgentFile: next }, null, 2) + '\n', 'utf8')
  return readMainAgentConfig(root)
}

function agentKeyDir(evolutionDir, agentKey) {
  return join(evolutionDir, assertAgentKey(agentKey))
}

function parseItemList(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('<!--'))
}

async function readListFile(filename) {
  try {
    return parseItemList(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new Error(`smart-subagent: failed to read ${filename}`, { cause: error })
  }
}

async function hasEvolutionFiles(evolutionDir, agentKey) {
  const dir = agentKeyDir(evolutionDir, agentKey)
  for (const name of ['prefercmd.md', 'memory.md']) {
    try {
      await readFile(join(dir, name), 'utf8')
      return true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return false
}

/**
 * Keep the newest `maxEntries` entries (the list is oldest -> newest) and
 * write them whole. There is deliberately no per-file character truncation
 * here: stored entries are never cut, so a long command or lesson is kept in
 * full even when a file occasionally grows beyond MAX_FILE_CHARS. The bounded
 * size guarantee lives at injection time (buildInjection caps the context at
 * MAX_INJECT_CHARS), not at storage.
 */
async function appendListFile(filename, newItems, maxEntries, label) {
  const existing = await readListFile(filename)
  const merged = [...existing]
  for (const item of newItems) {
    if (!merged.includes(item)) merged.push(item)
  }
  const kept = merged.slice(-maxEntries)
  const body = kept.length > 0
    ? kept.map(i => `- ${i}`).join('\n') + '\n'
    : ''
  const header = `# ${label} — auto-maintained by smart-subagent evolution mode\n`
    + `# Edit via the smart-subagent settings UI; manual edits are preserved\n\n`
  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, header + body, 'utf8')
}

/**
 * Read evolution files for an agent key. Returns empty arrays if no files exist.
 *
 * @returns {Promise<{ agentKey: string, prefercmd: string[], memory: string[] }>}
 */
export async function readEvolution(evolutionDir, agentKey, fallbackEvolutionDir) {
  const primaryHasFiles = await hasEvolutionFiles(evolutionDir, agentKey)
  const selectedDir = !primaryHasFiles && typeof fallbackEvolutionDir === 'string'
    ? fallbackEvolutionDir
    : evolutionDir
  const dir = agentKeyDir(selectedDir, agentKey)
  const [prefercmd, memory] = await Promise.all([
    readListFile(join(dir, 'prefercmd.md')),
    readListFile(join(dir, 'memory.md')),
  ])
  return { agentKey, prefercmd, memory }
}

/**
 * Priority markers for evolution entries. Entries are prefixed in the stored
 * Markdown files and stripped from the injected text.
 *   - `!` P0 permanent: always injected in full, never compressed or dropped.
 *   - `?` P2 compressible: injected last, first to be summarized or dropped
 *     when the budget is tight (still kept in the file).
 *   - no marker: P1 normal.
 */
export const PRIO_PINNED = '!'
export const PRIO_SOFT = '?'
export const GROUP_MIN = 3
export const BIG_ENTRY_CHARS = 300

/** Classify an entry string into a priority tier, returning the stripped text
 * and the tier. The marker is a single leading character. */
export function splitPriority(entry) {
  const text = String(entry)
  if (text.startsWith(PRIO_PINNED)) return { tier: 0, text: text.slice(1).trim() }
  if (text.startsWith(PRIO_SOFT)) return { tier: 2, text: text.slice(1).trim() }
  return { tier: 1, text: text.trim() }
}

/** Leading token of a command entry, used to detect "similar commands". */
function commandGroupOf(text) {
  const m = /^([A-Za-z0-9_.@/-]+)/.exec(text)
  return m ? m[1] : ''
}

/**
 * Deterministic heuristic summarizer. For prefercmd, groups same-prefix
 * commands that appear >= GROUP_MIN times into one summary line instead of
 * listing every concrete command; for both lists, condenses entries longer
 * than BIG_ENTRY_CHARS into a short head + ellipsis. Returns the `- ` lines.
 */
function heuristicLines(section, texts) {
  const condense = t => t.length > BIG_ENTRY_CHARS ? t.slice(0, BIG_ENTRY_CHARS - 1) + '…' : t
  if (section !== 'prefercmd') {
    return texts.map(t => `- ${condense(t)}`)
  }
  const groups = new Map()
  const singles = []
  for (const t of texts) {
    const g = commandGroupOf(t)
    if (g) {
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(t)
    } else {
      singles.push(t)
    }
  }
  const lines = []
  for (const [g, items] of groups) {
    if (items.length >= GROUP_MIN) {
      const shown = items.slice(0, 2).map(i => i.length > 40 ? i.slice(0, 40) + '…' : i)
      lines.push(`- ${g} …（${items.length} 条相关命令：${shown.join(' / ')}）`)
    } else {
      singles.push(...items)
    }
  }
  for (const item of singles) lines.push(`- ${condense(item)}`)
  return lines
}

/** Assemble ordered section entries into the final bounded block. Pinned lines
 * are never dropped; when they alone exceed the budget they win over the cap. */
function renderInjection(sections, maxChars) {
  if (sections.length === 0) return ''
  const entries = []
  for (const s of sections) {
    entries.push({ kind: 'header', text: s.header, section: s })
    for (const l of s.lines) entries.push({ kind: 'entry', text: l.text, pinned: l.pinned, section: s })
  }
  const countOf = new Map(sections.map(s => [s, s.lines.length]))
  let length = entries.reduce((n, e) => n + e.text.length + 1, 0) // +1 newline each
  let finalEntries = entries
  if (length > maxChars) {
    // Drop from the end (P2/P1 of the later section first), never a pinned
    // line, and drop a section header only once its section is empty.
    const kept = []
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (length <= maxChars) { kept.unshift(e); continue }
      if (e.kind === 'entry' && !e.pinned) {
        length -= e.text.length + 1
        countOf.set(e.section, countOf.get(e.section) - 1)
        continue
      }
      if (e.kind === 'header' && countOf.get(e.section) === 0) {
        length -= e.text.length + 1
        continue
      }
      kept.unshift(e)
    }
    finalEntries = kept
  }
  let body = ''
  for (const e of finalEntries) {
    if (e.kind === 'header') body += (body ? '\n' : '') + e.text + '\n'
    else body += e.text + '\n'
  }
  body = body.trimEnd()
  return '\n\n<!-- smart-subagent evolution: auto-maintained context (bounded) -->\n'
    + body
    + '\n<!-- /smart-subagent evolution -->'
}

/**
 * Build a bounded evolution injection block, capped at `maxChars` (default
 * MAX_INJECT_CHARS = 6000). Budget allocation by priority tier:
 *   1. P0 (`!`) entries — injected in full, never compressed or dropped.
 *   2. P1 (default) entries — newest first, filling the remaining budget.
 *   3. P2 (`?`) entries — last; summarized or dropped when the budget is tight
 *      (they stay in the stored file).
 * Compression: prefercmd entries with the same command prefix and >= GROUP_MIN
 * occurrences are merged into one summary line, and entries longer than
 * BIG_ENTRY_CHARS are condensed to a short head + ellipsis. Pass an optional
 * `options.summarize(section, texts)` (sync) to override the heuristic; for an
 * async summarizer use buildInjectionAsync. Returns '' when there is nothing
 * to inject.
 *
 * @param {string[]} prefercmd
 * @param {string[]} memory
 * @param {{ maxChars?: number, summarize?: (section: 'prefercmd'|'memory', texts: string[]) => string | string[] }} [options]
 * @returns {string}
 */
export function buildInjection(prefercmd, memory, options = {}) {
  const opts = typeof options === 'number' ? { maxChars: options } : options
  const maxChars = opts.maxChars ?? MAX_INJECT_CHARS
  const summarize = opts.summarize ?? null
  const sections = []
  for (const [key, src] of [['prefercmd', prefercmd], ['memory', memory]]) {
    if (src.length === 0) continue
    const pinned = []
    const normal = []
    const soft = []
    for (const raw of src) {
      const { tier, text } = splitPriority(raw)
      if (tier === 0) pinned.push(text)
      else if (tier === 2) soft.push(text)
      else normal.push(text)
    }
    const lines = []
    for (const t of pinned) lines.push({ text: `- ${t}`, pinned: true })
    const flexible = [...normal.reverse(), ...soft.reverse()] // newest first, soft last
    if (flexible.length > 0) {
      const rendered = summarize
        ? [].concat(summarize(key, flexible)).map(s => `- ${s}`)
        : heuristicLines(key, flexible)
      for (const l of rendered) lines.push({ text: l, pinned: false })
    }
    if (lines.length > 0) {
      sections.push({
        header: key === 'prefercmd'
          ? '## Known working commands (prefercmd)'
          : '## Lessons learned (memory)',
        lines,
      })
    }
  }
  return renderInjection(sections, maxChars)
}

/**
 * Async variant of buildInjection: accepts an async `options.summarize`
 * (e.g. an LLM-backed semantic summarizer via ctx.llm). Falls back to the
 * deterministic heuristic when no summarizer is given.
 *
 * @param {string[]} prefercmd
 * @param {string[]} memory
 * @param {{ maxChars?: number, summarize?: (section: 'prefercmd'|'memory', texts: string[]) => Promise<string | string[]> | string | string[] }} [options]
 * @returns {Promise<string>}
 */
export async function buildInjectionAsync(prefercmd, memory, options = {}) {
  const opts = typeof options === 'number' ? { maxChars: options } : options
  const maxChars = opts.maxChars ?? MAX_INJECT_CHARS
  const summarize = opts.summarize ?? null
  const sections = []
  for (const [key, src] of [['prefercmd', prefercmd], ['memory', memory]]) {
    if (src.length === 0) continue
    const pinned = []
    const normal = []
    const soft = []
    for (const raw of src) {
      const { tier, text } = splitPriority(raw)
      if (tier === 0) pinned.push(text)
      else if (tier === 2) soft.push(text)
      else normal.push(text)
    }
    const lines = []
    for (const t of pinned) lines.push({ text: `- ${t}`, pinned: true })
    const flexible = [...normal.reverse(), ...soft.reverse()]
    if (flexible.length > 0) {
      let rendered
      if (summarize) {
        rendered = [].concat(await summarize(key, flexible)).map(s => `- ${s}`)
      } else {
        rendered = heuristicLines(key, flexible)
      }
      for (const l of rendered) lines.push({ text: l, pinned: false })
    }
    if (lines.length > 0) {
      sections.push({
        header: key === 'prefercmd'
          ? '## Known working commands (prefercmd)'
          : '## Lessons learned (memory)',
        lines,
      })
    }
  }
  return renderInjection(sections, maxChars)
}

/**
 * Parse the `[[EVOLUTION]] ... [[/EVOLUTION]]` block from a text output.
 * Tolerates missing sections and unknown lines.
 *
 * @param {string} text
 * @returns {{ prefercmd: string[], memory: string[] }}
 */
export function parseEvolutionBlock(text) {
  const out = { prefercmd: [], memory: [] }
  if (typeof text !== 'string') return out
  const open = text.indexOf(EVOLUTION_OPEN)
  if (open === -1) return out
  const close = text.indexOf(EVOLUTION_CLOSE, open + EVOLUTION_OPEN.length)
  if (close === -1) return out
  const inner = text.slice(open + EVOLUTION_OPEN.length, close)
  let section = null
  for (const raw of inner.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const header = /^(prefercmd|memory)\s*:$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(line)
    if (item && section) out[section].push(item[1].trim())
  }
  return out
}

/**
 * Merge new evolution records into the hidden storage for an agent key.
 * Creates directories/files on demand; silently no-ops if both sections are empty.
 *
 * @param {string} evolutionDir
 * @param {string} agentKey
 * @param {{ prefercmd?: string[], memory?: string[] }} updates
 */
export async function recordEvolution(evolutionDir, agentKey, updates, fallbackEvolutionDir) {
  const parsed = { prefercmd: [], memory: [], ...(updates ?? {}) }
  const dir = agentKeyDir(evolutionDir, agentKey)
  if (typeof fallbackEvolutionDir === 'string' && !(await hasEvolutionFiles(evolutionDir, agentKey))) {
    const legacy = await readEvolution(fallbackEvolutionDir, agentKey)
    if (legacy.prefercmd.length > 0) {
      await appendListFile(join(dir, 'prefercmd.md'), legacy.prefercmd, MAX_PREFERCMD, 'prefercmd')
    }
    if (legacy.memory.length > 0) {
      await appendListFile(join(dir, 'memory.md'), legacy.memory, MAX_MEMORY, 'memory')
    }
  }
  await mkdir(dir, { recursive: true })
  if (parsed.prefercmd.length > 0) {
    await appendListFile(join(dir, 'prefercmd.md'), parsed.prefercmd, MAX_PREFERCMD, 'prefercmd')
  }
  if (parsed.memory.length > 0) {
    await appendListFile(join(dir, 'memory.md'), parsed.memory, MAX_MEMORY, 'memory')
  }
}

async function readRawFile(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw new Error(`smart-subagent: failed to read ${filename}`, { cause: error })
  }
}

/**
 * Read the raw markdown text of both evolution files ('' when absent).
 * Used by the settings UI editor.
 *
 * @returns {Promise<{ agentKey: string, prefercmd: string, memory: string }>}
 */
export async function readEvolutionFilesRaw(evolutionDir, agentKey, fallbackEvolutionDir) {
  const primaryHasFiles = await hasEvolutionFiles(evolutionDir, agentKey)
  const selectedDir = !primaryHasFiles && typeof fallbackEvolutionDir === 'string'
    ? fallbackEvolutionDir
    : evolutionDir
  const dir = agentKeyDir(selectedDir, agentKey)
  const [prefercmd, memory] = await Promise.all([
    readRawFile(join(dir, 'prefercmd.md')),
    readRawFile(join(dir, 'memory.md')),
  ])
  return { agentKey, prefercmd, memory }
}

/**
 * Overwrite both evolution files with raw markdown text (empty string writes
 * an empty file). The settings UI editor saves through this.
 *
 * @param {string} evolutionDir
 * @param {string} agentKey
 * @param {{ prefercmd?: string, memory?: string }} files
 */
export async function writeEvolutionFiles(evolutionDir, agentKey, files, fallbackEvolutionDir) {
  const dir = agentKeyDir(evolutionDir, agentKey)
  if (typeof fallbackEvolutionDir === 'string' && !(await hasEvolutionFiles(evolutionDir, agentKey))) {
    const legacy = await readEvolutionFilesRaw(fallbackEvolutionDir, agentKey)
    await mkdir(dir, { recursive: true })
    if (legacy.prefercmd !== '') await writeFile(join(dir, 'prefercmd.md'), legacy.prefercmd, 'utf8')
    if (legacy.memory !== '') await writeFile(join(dir, 'memory.md'), legacy.memory, 'utf8')
  }
  await mkdir(dir, { recursive: true })
  const writes = []
  if (typeof files?.prefercmd === 'string') {
    writes.push(writeFile(join(dir, 'prefercmd.md'), files.prefercmd, 'utf8'))
  }
  if (typeof files?.memory === 'string') {
    writes.push(writeFile(join(dir, 'memory.md'), files.memory, 'utf8'))
  }
  await Promise.all(writes)
}

/**
 * Detect available agent keys across the bindings directory and the bundled
 * templates. Returns sorted list with `agentKey` and `source` (binding / template / both).
 *
 * @param {string} bindingsDir
 * @param {string} templatesDir
 * @returns {Promise<{ agentKey: string, source: 'binding' | 'template' | 'both' }[]>}
 */
export async function detectAgents(bindingsDir, templatesDir) {
  const keys = new Map()
  const candidates = [
    { dir: templatesDir, source: 'template' },
    { dir: bindingsDir, source: 'binding' },
  ]
  for (const { dir, source } of candidates) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw new Error(`smart-subagent: failed to list agents in ${dir}`, { cause: error })
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.md$/.exec(entry.name)
      if (!match) continue
      const key = match[1]
      const existing = keys.get(key)
      if (existing === undefined) keys.set(key, source)
      else if (existing !== source) keys.set(key, 'both')
    }
  }
  return [...keys.entries()]
    .map(([agentKey, source]) => ({ agentKey, source }))
    .sort((a, b) => a.agentKey.localeCompare(b.agentKey))
}
