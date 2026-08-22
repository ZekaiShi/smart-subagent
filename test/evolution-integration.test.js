import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createApply } from '../plugin.js'
import { recordEvolution, readEvolution } from '../evolution.js'

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const exec = { agent: { options: { provider: 'p', model: 'm' } }, signal: new AbortController().signal }

async function buildHarness({ evolution = true, foregroundOutput = 'done' } = {}) {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'smart-sub-ei-bind-'))
  const evolutionDir = await mkdtemp(join(tmpdir(), 'smart-sub-ei-evo-'))
  const starts = []
  let callIdx = 0
  let definition
  const ctx = {
    tools: { register(value) { definition = value } },
    llm: {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash' }],
    },
    subagents: {
      async start(provider, request) {
        const idx = callIdx++
        starts.push({ provider, request, idx })
        const blocks = Array.isArray(foregroundOutput)
          ? foregroundOutput
          : [{ type: 'text', text: foregroundOutput }]
        return {
          id: `r-${idx}`,
          result: Promise.resolve({ stopReason: 'completed', output: blocks }),
          async dispose() {},
        }
      },
      async startContinuable(spec) {
        starts.push(spec)
        return { childId: 'bg-1', messageId: 'm-1' }
      },
    },
  }
  createApply(v => v)(ctx, {
    bindingsDir,
    templatesDir,
    provider: 'spawn',
    toolName: 'smart_subagent',
    maxDepth: 3,
    evolution,
    evolutionDir,
  })
  return { definition, starts, bindingsDir, evolutionDir }
}

test('evolution enabled: foreground prompt gets injection block when files exist', async () => {
  const h = await buildHarness({ evolution: true })
  await recordEvolution(h.evolutionDir, 'code-reviewer', {
    prefercmd: ['ls -la  # show hidden'],
    memory: ['run lint first'],
  })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'review this', run_in_background: false,
  }, exec)
  const text = h.starts[0].request.prompt[0].text
  assert.match(text, /review this/)
  assert.match(text, /smart-subagent evolution/)
  assert.match(text, /ls -la/)
  assert.match(text, /run lint first/)
})

test('evolution enabled: no injection when both files are empty', async () => {
  const h = await buildHarness({ evolution: true })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'review this', run_in_background: false,
  }, exec)
  const text = h.starts[0].request.prompt[0].text
  assert.equal(text.includes('smart-subagent evolution'), false)
  assert.equal(text, 'review this')
})

test('evolution disabled: no injection even when files exist', async () => {
  const h = await buildHarness({ evolution: false })
  await recordEvolution(h.evolutionDir, 'code-reviewer', {
    prefercmd: ['should not appear'],
  })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'review this', run_in_background: false,
  }, exec)
  const text = h.starts[0].request.prompt[0].text
  assert.equal(text.includes('smart-subagent evolution'), false)
  assert.equal(text, 'review this')
})

test('evolution enabled: foreground records [[EVOLUTION]] block to files', async () => {
  const h = await buildHarness({
    evolution: true,
    foregroundOutput: `Great, task done.

[[EVOLUTION]]
prefercmd:
- node --test  # faster test runner
memory:
- avoid --watch in CI
[[/EVOLUTION]]

bye`,
  })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'task', run_in_background: false,
  }, exec)
  const { prefercmd, memory } = await readEvolution(h.evolutionDir, 'code-reviewer')
  assert.deepEqual(prefercmd, ['node --test  # faster test runner'])
  assert.deepEqual(memory, ['avoid --watch in CI'])
})

test('evolution enabled: no record when output has no evolution block', async () => {
  const h = await buildHarness({ evolution: true, foregroundOutput: 'just plain text done' })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'task', run_in_background: false,
  }, exec)
  // Files should not be created when there's nothing to record.
  const dirContents = await readdir(join(h.evolutionDir, 'code-reviewer')).catch(e => {
    if (e.code === 'ENOENT') return []
    throw e
  })
  assert.deepEqual(dirContents, [])
})

test('evolution disabled: no recording even when output has [[EVOLUTION]]', async () => {
  const h = await buildHarness({
    evolution: false,
    foregroundOutput: `[[EVOLUTION]]
prefercmd:
- should not be saved
[[/EVOLUTION]]`,
  })
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'task', run_in_background: false,
  }, exec)
  const dirContents = await readdir(join(h.evolutionDir, 'code-reviewer')).catch(e => {
    if (e.code === 'ENOENT') return []
    throw e
  })
  assert.deepEqual(dirContents, [])
})

test('evolution works for unbound keys (parent inheritance path) too', async () => {
  const h = await buildHarness({
    evolution: true,
    foregroundOutput: `[[EVOLUTION]]
memory:
- inherited agent can use pnpm
[[/EVOLUTION]]`,
  })
  await h.definition.execute({
    agent_key: 'custom-worker', description: 'work', prompt: 'do custom thing', run_in_background: false,
  }, exec)
  // No agentOptions means it's the inheritance path.
  assert.equal(Object.hasOwn(h.starts[0].request, 'agentOptions'), false)
  const { memory } = await readEvolution(h.evolutionDir, 'custom-worker')
  assert.deepEqual(memory, ['inherited agent can use pnpm'])
})

test('settings route /smart-subagent/agents returns project scope', async () => {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'smart-sub-scope-bind-'))
  const evolutionDir = await mkdtemp(join(tmpdir(), 'smart-sub-scope-evo-'))
  const routes = new Map()
  const webServer = {
    register(route) { routes.set(route.path, route) },
  }
  const settings = { register() {} }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => cb({ webServer, settings }),
  }
  createApply(v => v)(ctx, {
    bindingsDir, templatesDir, evolution: true, evolutionDir, maxDepth: 3,
  })
  const route = routes.get('/smart-subagent/agents')
  assert.ok(route, 'agents route registered')
  let captured
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { captured = JSON.parse(body) },
  }
  await route.handler({}, res)
  assert.equal(res.status, 200)
  assert.ok(captured.scope, 'scope present in response')
  assert.equal(captured.scope.bindingsDir, bindingsDir)
  assert.equal(captured.scope.evolutionDir, evolutionDir)
  assert.equal(typeof captured.scope.projectName, 'string')
  assert.ok(captured.scope.projectName.length > 0)
  assert.equal(captured.scope.cwd, process.cwd())
})
