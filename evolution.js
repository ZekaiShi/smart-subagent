import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertAgentKey } from './binding.js'

export const EVOLUTION_OPEN = '[[EVOLUTION]]'
export const EVOLUTION_CLOSE = '[[/EVOLUTION]]'
export const MAX_PREFERCMD = 40
export const MAX_MEMORY = 25
export const MAX_INJECT_CHARS = 6000

/** Default project-scoped evolution directory, derived from the DSH launch
 * working directory (the same base the bindings directory resolves from).
 * Each project/conversation keeps its own evolution files, isolated from the
 * others. Override with SMART_SUBAGENT_EVOLUTION_DIR or `evolutionDir`. */
export function defaultEvolutionDir() {
  return join(process.cwd(), '.dsh', 'smart-subagent', 'evolution')
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
export async function readEvolution(evolutionDir, agentKey) {
  const dir = agentKeyDir(evolutionDir, agentKey)
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
export async function recordEvolution(evolutionDir, agentKey, updates) {
  const parsed = { prefercmd: [], memory: [], ...(updates ?? {}) }
  const dir = agentKeyDir(evolutionDir, agentKey)
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
export async function readEvolutionFilesRaw(evolutionDir, agentKey) {
  const dir = agentKeyDir(evolutionDir, agentKey)
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
export async function writeEvolutionFiles(evolutionDir, agentKey, files) {
  const dir = agentKeyDir(evolutionDir, agentKey)
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
