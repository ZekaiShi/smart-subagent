import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  parseEvolutionBlock,
  buildInjection,
  readEvolution,
  recordEvolution,
  detectAgents,
  defaultEvolutionDir,
  readEvolutionFilesRaw,
  writeEvolutionFiles,
  MAX_PREFERCMD,
  MAX_MEMORY,
  MAX_INJECT_CHARS,
  EVOLUTION_OPEN,
  EVOLUTION_CLOSE,
  MAIN_AGENT_BLOCK_OPEN,
  MAIN_AGENT_BLOCK_CLOSE,
  addMainAgentBlock,
  removeMainAgentBlock,
  readMainAgentConfig,
  setMainAgentConfig,
} from '../evolution.js'

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, '..', 'templates')

test('defaultEvolutionDir is project-scoped under <cwd>/.smart_subagent/evolution', () => {
  const d = defaultEvolutionDir()
  // Relative to the launch working directory, so each project is isolated.
  assert.equal(d.startsWith(process.cwd()), true)
  assert.match(d, /\.smart_subagent[/\\]evolution$/)
})

test('new evolution storage reads legacy files and migrates them on first save', async () => {
  const root = await makeEvoDir()
  const current = join(root, '.smart_subagent', 'evolution')
  const legacy = join(root, '.dsh', 'smart-subagent', 'evolution')
  await writeEvolutionFiles(legacy, 'reviewer', {
    prefercmd: '- legacy command\n',
    memory: '- legacy lesson\n',
  })
  const fallback = await readEvolutionFilesRaw(current, 'reviewer', legacy)
  assert.equal(fallback.prefercmd, '- legacy command\n')
  assert.equal(fallback.memory, '- legacy lesson\n')

  await writeEvolutionFiles(current, 'reviewer', { memory: '- updated lesson\n' }, legacy)
  const migrated = await readEvolutionFilesRaw(current, 'reviewer')
  assert.equal(migrated.prefercmd, '- legacy command\n')
  assert.equal(migrated.memory, '- updated lesson\n')
})

test('main agent evolution block is idempotent and removable', () => {
  const original = '# Project instructions\n\nKeep existing rules.\n'
  const injected = addMainAgentBlock(original)
  assert.equal(injected.includes(MAIN_AGENT_BLOCK_OPEN), true)
  assert.equal(injected.includes(MAIN_AGENT_BLOCK_CLOSE), true)
  assert.equal(addMainAgentBlock(injected), injected)
  assert.equal(removeMainAgentBlock(injected), original)
})

test('one workspace main agent binding updates AGENTS.md and config reversibly', async () => {
  const root = await makeEvoDir()
  const filename = join(root, 'AGENTS.md')
  const original = '# Workspace agent\n\nProject rules.\n'
  await writeFile(filename, original, 'utf8')
  const before = await readMainAgentConfig(root)
  assert.deepEqual(before, { filename: '', available: true, candidates: ['AGENTS.md'] })

  const bound = await setMainAgentConfig(root, 'AGENTS.md')
  assert.equal(bound.filename, 'AGENTS.md')
  assert.match(await readFile(filename, 'utf8'), /\.smart_subagent\/evolution\/main\/memory\.md/)
  assert.deepEqual(JSON.parse(await readFile(join(root, '.smart_subagent', 'config.json'), 'utf8')), {
    mainAgentFile: 'AGENTS.md',
  })
  assert.equal(await readFile(join(root, '.smart_subagent', 'evolution', 'main', 'prefercmd.md'), 'utf8'), '')
  assert.equal(await readFile(join(root, '.smart_subagent', 'evolution', 'main', 'memory.md'), 'utf8'), '')

  const unbound = await setMainAgentConfig(root, '')
  assert.equal(unbound.filename, '')
  assert.equal(await readFile(filename, 'utf8'), original)
})

test('parseEvolutionBlock returns empty for missing / malformed markers', () => {
  assert.deepEqual(parseEvolutionBlock(''), { prefercmd: [], memory: [] })
  assert.deepEqual(parseEvolutionBlock(undefined), { prefercmd: [], memory: [] })
  assert.deepEqual(parseEvolutionBlock('[[EVOLUTION]]'), { prefercmd: [], memory: [] })
  assert.deepEqual(parseEvolutionBlock('nope [[/EVOLUTION]]'), { prefercmd: [], memory: [] })
})

test('parseEvolutionBlock extracts prefercmd and memory sections', () => {
  const text = `done with task

[[EVOLUTION]]
prefercmd:
- ls -la    # list all files including hidden
- npm run test
memory:
- don't use --force unless sure
[[/EVOLUTION]]

footer`
  const { prefercmd, memory } = parseEvolutionBlock(text)
  assert.deepEqual(prefercmd, [
    'ls -la    # list all files including hidden',
    'npm run test',
  ])
  assert.deepEqual(memory, [
    "don't use --force unless sure",
  ])
})

test('parseEvolutionBlock handles missing sections and blank lines', () => {
  const text = `[[EVOLUTION]]

memory:

- lesson one
- lesson two

[[/EVOLUTION]]`
  const { prefercmd, memory } = parseEvolutionBlock(text)
  assert.deepEqual(prefercmd, [])
  assert.deepEqual(memory, ['lesson one', 'lesson two'])
})

test('buildInjection returns empty string when both lists are empty', () => {
  assert.equal(buildInjection([], []), '')
})

test('buildInjection produces a bounded block with both sections', () => {
  const out = buildInjection(['cmd1', 'cmd2'], ['lesson1'])
  assert.match(out, /Known working commands/)
  assert.match(out, /Lessons learned/)
  assert.match(out, /smart-subagent evolution/)
  assert.match(out, /- cmd1/)
  assert.match(out, /- cmd2/)
  assert.match(out, /- lesson1/)
})

test('buildInjection trims tail when content exceeds maxChars', () => {
  const long = Array.from({ length: 100 }, (_, i) => `item-${i}-${'x'.repeat(50)}`)
  const out = buildInjection(long, [], 500)
  assert.ok(out.length <= 500 + 200, 'injection roughly bounded') // 200 for markers+header
  assert.ok(out.includes('item-'), 'some items remain')
})

async function makeEvoDir() {
  return await mkdtemp(join(tmpdir(), 'smart-sub-evo-'))
}

test('recordEvolution + readEvolution round-trips and dedups', async () => {
  const dir = await makeEvoDir()
  await recordEvolution(dir, 'my-agent', {
    prefercmd: ['first cmd', 'second cmd'],
    memory: ['note one'],
  })
  const first = await readEvolution(dir, 'my-agent')
  assert.deepEqual(first.prefercmd, ['first cmd', 'second cmd'])
  assert.deepEqual(first.memory, ['note one'])

  // Append again with a duplicate + a new one.
  await recordEvolution(dir, 'my-agent', {
    prefercmd: ['second cmd', 'third cmd'],
    memory: ['note two'],
  })
  const second = await readEvolution(dir, 'my-agent')
  assert.deepEqual(second.prefercmd, ['first cmd', 'second cmd', 'third cmd'])
  assert.deepEqual(second.memory, ['note one', 'note two'])
})

test('recordEvolution enforces max entries by dropping oldest', async () => {
  const dir = await makeEvoDir()
  const items = Array.from({ length: MAX_PREFERCMD + 5 }, (_, i) => `cmd-${i}`)
  await recordEvolution(dir, 'full', { prefercmd: items })
  const { prefercmd } = await readEvolution(dir, 'full')
  assert.equal(prefercmd.length, MAX_PREFERCMD)
  assert.equal(prefercmd[0], `cmd-${5}`)  // oldest dropped
  assert.equal(prefercmd.at(-1), `cmd-${MAX_PREFERCMD + 4}`)
})

test('recordEvolution rejects invalid agent key with a clear error', async () => {
  const dir = await makeEvoDir()
  await assert.rejects(
    recordEvolution(dir, '../escape', { prefercmd: ['nope'] }),
    /agent_key must match/,
  )
})

test('detectAgents merges bindings and templates, sorted', async () => {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'smart-sub-bind-'))
  await writeFile(join(bindingsDir, 'custom-role.md'), '---\nprovider: p\nmodel: m\n---\n', 'utf8')
  await writeFile(join(bindingsDir, 'code-reviewer.md'), '---\nprovider: p\nmodel: m\n---\n', 'utf8')
  const agents = await detectAgents(bindingsDir, templatesDir)
  const map = Object.fromEntries(agents.map(a => [a.agentKey, a.source]))
  assert.equal(map['code-reviewer'], 'both')
  assert.equal(map['researcher'], 'template')
  assert.equal(map['wps-worker'], 'template')
  assert.equal(map['custom-role'], 'binding')
  assert.equal(agents[0].agentKey < agents[1].agentKey, true, 'sorted alphabetically')
})

test('detectAgents returns empty for missing directories', async () => {
  const agents = await detectAgents('/no/such/dir', '/no/templates/either')
  assert.deepEqual(agents, [])
})

test('readEvolutionFilesRaw returns empty strings when absent', async () => {
  const dir = await makeEvoDir()
  const files = await readEvolutionFilesRaw(dir, 'none')
  assert.equal(files.prefercmd, '')
  assert.equal(files.memory, '')
})

test('writeEvolutionFiles + readEvolutionFilesRaw round-trips raw markdown', async () => {
  const dir = await makeEvoDir()
  const prefercmd = '# prefercmd\n\n- pnpm test\n- node --test\n'
  const memory = '# memory\n\n- 不要用 --force\n'
  await writeEvolutionFiles(dir, 'my-agent', { prefercmd, memory })
  const files = await readEvolutionFilesRaw(dir, 'my-agent')
  assert.equal(files.prefercmd, prefercmd)
  assert.equal(files.memory, memory)
})

test('writeEvolutionFiles writes only provided files and keeps the other', async () => {
  const dir = await makeEvoDir()
  await writeEvolutionFiles(dir, 'partial', { prefercmd: '- only cmd\n' })
  let files = await readEvolutionFilesRaw(dir, 'partial')
  assert.equal(files.prefercmd, '- only cmd\n')
  assert.equal(files.memory, '')
  await writeEvolutionFiles(dir, 'partial', { memory: '- only note\n' })
  files = await readEvolutionFilesRaw(dir, 'partial')
  assert.equal(files.prefercmd, '- only cmd\n')
  assert.equal(files.memory, '- only note\n')
})
