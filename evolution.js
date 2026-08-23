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

async function appendListFile(filename, newItems, maxEntries, label) {
  const existing = await readListFile(filename)
  const merged = [...existing]
  for (const item of newItems) {
    if (!merged.includes(item)) merged.push(item)
  }
  const trimmed = merged.slice(-maxEntries)
  const body = trimmed.length > 0
    ? trimmed.map(i => `- ${i}`).join('\n') + '\n'
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
 * Build a bounded evolution injection block to prepend/append to the child prompt.
 * Returns an empty string when both lists are empty.
 *
 * @param {string[]} prefercmd
 * @param {string[]} memory
 * @param {number} [maxChars]
 * @returns {string}
 */
export function buildInjection(prefercmd, memory, maxChars = MAX_INJECT_CHARS) {
  const sections = []
  if (prefercmd.length > 0) {
    sections.push('## Known working commands (prefercmd)\n' + prefercmd.map(i => `- ${i}`).join('\n'))
  }
  if (memory.length > 0) {
    sections.push('## Lessons learned (memory)\n' + memory.map(i => `- ${i}`).join('\n'))
  }
  if (sections.length === 0) return ''
  let body = sections.join('\n\n')
  if (body.length > maxChars) {
    // Trim from the tail by removing last lines until we fit.
    const lines = body.split('\n')
    while (lines.length > 1 && body.length > maxChars) {
      lines.pop()
      body = lines.join('\n')
    }
  }
  return '\n\n<!-- smart-subagent evolution: auto-maintained context (bounded) -->\n'
    + body
    + '\n<!-- /smart-subagent evolution -->'
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
