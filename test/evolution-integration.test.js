import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
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
    llm: {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash' }],
    },
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
})

test('settings route /smart-subagent/projects groups agents by project with model info', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smart-sub-projbase-'))
  const agentsDir = join(base, 'proj-x', 'agents')
  await mkdir(agentsDir, { recursive: true })
  await writeFile(
    join(agentsDir, 'writer.md'),
    '---\nprovider: deepseek-official\nmodel: deepseek-v4-flash\n---\n\n# Writer\n\nrole text\n',
    'utf8',
  )
  const routes = new Map()
  const webServer = { register(route) { routes.set(route.path, route) } }
  const settings = { register() {} }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => cb({ webServer, settings }),
    llm: {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [
        { provider: 'deepseek-official', id: 'deepseek-v4-flash' },
        { provider: 'deepseek-official', id: 'deepseek-v3' },
      ],
    },
  }
  createApply(v => v)(ctx, {
    bindingsDir: agentsDir, templatesDir, evolution: true, projectsBaseDir: base, maxDepth: 3,
  })
  const route = routes.get('/smart-subagent/projects')
  assert.ok(route, 'projects route registered')
  let captured
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { captured = JSON.parse(body) },
  }
  await route.handler({}, res)
  assert.equal(res.status, 200)
  assert.equal(captured.projects.length, 1)
  const project = captured.projects[0]
  assert.equal(project.projectName, 'proj-x')
  // 3 built-in templates + the project binding
  assert.equal(project.agents.length, 4)
  const writer = project.agents.find((a) => a.agentKey === 'writer')
  assert.ok(writer, 'binding agent present')
  assert.equal(writer.source, 'binding')
  assert.equal(writer.provider, 'deepseek-official')
  assert.equal(writer.model, 'deepseek-v4-flash')
  assert.equal(writer.editable, true)
  const reviewer = project.agents.find((a) => a.agentKey === 'code-reviewer')
  assert.ok(reviewer, 'template agent present')
  assert.equal(reviewer.source, 'template')
  assert.equal(reviewer.editable, false)
  assert.deepEqual(captured.modelsByProvider['deepseek-official'], ['deepseek-v4-flash', 'deepseek-v3'])
  // built-in templates come back as their own always-visible group
  assert.ok(Array.isArray(captured.builtin), 'builtin present')
  assert.equal(captured.builtin.length, 3)
  const builtinReviewer = captured.builtin.find((a) => a.agentKey === 'code-reviewer')
  assert.ok(builtinReviewer)
  assert.equal(builtinReviewer.editable, false)
  assert.equal(typeof builtinReviewer.model, 'string')
  assert.equal(captured.scope.projectsBaseDir, base)
  // No workspace registry in this harness: the configured dir is the fallback.
  assert.equal(captured.scope.scanSource, 'manual')
})

test('settings route /smart-subagent/projects scans registered workspaces', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smart-sub-ws-'))
  // ws-1 IS the project itself (agents/ directly under the workspace root).
  await mkdir(join(base, 'ws-project', 'agents'), { recursive: true })
  // ws-2 is a plain folder whose first-level subdir owns agents/.
  await mkdir(join(base, 'ws-parent', 'nested-project', 'agents'), { recursive: true })
  // A second-level subdir must NOT be found from a workspace.
  await mkdir(join(base, 'ws-parent', 'skip', 'deep', 'agents'), { recursive: true })
  await writeFile(
    join(base, 'ws-project', 'agents', 'writer.md'),
    '---\nprovider: deepseek-official\nmodel: deepseek-v4-flash\n---\n\n# Writer\n\nrole text\n',
    'utf8',
  )
  const routes = new Map()
  const webServer = { register(route) { routes.set(route.path, route) } }
  const settings = { register() {} }
  const registry = {
    list: () => [
      { path: join(base, 'ws-project'), title: 'ws-project' },
      { path: join(base, 'ws-parent'), title: 'ws-parent' },
      { path: join(base, 'missing-dir'), title: 'missing-dir' },
    ],
  }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => {
      if (services.includes('workspaceRegistry')) cb({ workspaceRegistry: registry })
      else cb({ webServer, settings })
    },
    llm: { listProviders: () => [], listModels: async () => [] },
  }
  createApply(v => v)(ctx, {
    bindingsDir: join(base, 'ws-project', 'agents'), templatesDir, evolution: true, maxDepth: 3,
  })
  const route = routes.get('/smart-subagent/projects')
  assert.ok(route, 'projects route registered')
  let captured
  const res = {
    writeHead(status) { this.status = status },
    end(body) { captured = JSON.parse(body) },
  }
  await route.handler({}, res)
  assert.equal(res.status, 200)
  assert.equal(captured.scope.scanSource, 'workspaces')
  assert.deepEqual(
    captured.scope.workspaces.map((w) => w.path),
    [join(base, 'ws-project'), join(base, 'ws-parent'), join(base, 'missing-dir')],
  )
  const names = captured.projects.map((p) => p.projectName).sort()
  // ws-project found directly, nested-project via ws-parent's first level;
  // the second-level "deep" dir and the missing workspace are not found.
  assert.deepEqual(names, ['nested-project', 'ws-project'])
  // The workspaces override the configured projectsBaseDir when present.
  assert.equal(captured.projects.length, 2)
})

test('settings route /smart-subagent/projects reports none when nothing is configured', async () => {
  const routes = new Map()
  const webServer = { register(route) { routes.set(route.path, route) } }
  const settings = { register() {} }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => cb({ webServer, settings }),
    llm: { listProviders: () => [], listModels: async () => [] },
  }
  createApply(v => v)(ctx, {
    bindingsDir: join(tmpdir(), 'smart-sub-none-'), templatesDir, evolution: true, maxDepth: 3,
  })
  const route = routes.get('/smart-subagent/projects')
  let captured
  const res = {
    writeHead(status) { this.status = status },
    end(body) { captured = JSON.parse(body) },
  }
  await route.handler({}, res)
  assert.equal(res.status, 200)
  assert.equal(captured.scope.scanSource, 'none')
  assert.deepEqual(captured.projects, [])
  assert.equal(captured.scope.projectsBaseDir, undefined)
  // Built-in templates remain visible even with no scan source.
  assert.equal(captured.builtin.length, 3)
})

test('settings route /smart-subagent/config updates the project scan dir and /projects rescans', async () => {
  const baseA = await mkdtemp(join(tmpdir(), 'smart-sub-cfgA-'))
  const baseB = await mkdtemp(join(tmpdir(), 'smart-sub-cfgB-'))
  await mkdir(join(baseA, 'proj-a', 'agents'), { recursive: true })
  await mkdir(join(baseB, 'proj-b', 'agents'), { recursive: true })
  const routes = new Map()
  const webServer = { register(route) { routes.set(route.path, route) } }
  const settings = { register() {} }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => cb({ webServer, settings }),
    llm: { listProviders: () => [], listModels: async () => [] },
  }
  createApply(v => v)(ctx, {
    bindingsDir: baseA, templatesDir, evolution: true, projectsBaseDir: baseA, maxDepth: 3,
  })
  const post = (path, payload) => {
    const req = {
      method: 'POST',
      [Symbol.asyncIterator]() {
        const body = JSON.stringify(payload)
        let sent = false
        return { next: async () => (sent ? { done: true } : ((sent = true), { done: false, value: Buffer.from(body) })) }
      },
    }
    let captured
    const res = { writeHead(status) { this.status = status }, end(body) { captured = JSON.parse(body) } }
    return routes.get(path).handler(req, res).then(() => captured)
  }
  const before = await post('/smart-subagent/projects', {})
  assert.deepEqual(before.projects.map((p) => p.projectName), ['proj-a'])
  const cfg = await post('/smart-subagent/config', { projectsBaseDir: baseB })
  assert.equal(cfg.projectsBaseDir, baseB)
  const after = await post('/smart-subagent/projects', {})
  assert.deepEqual(after.projects.map((p) => p.projectName), ['proj-b'])
  assert.equal(after.scope.projectsBaseDir, baseB)
})

test('settings route /smart-subagent/model rewrites the binding front matter', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smart-sub-modelbase-'))
  const agentsDir = join(base, 'proj-m', 'agents')
  await mkdir(agentsDir, { recursive: true })
  const bindingFile = join(agentsDir, 'writer.md')
  await writeFile(
    bindingFile,
    '---\nprovider: deepseek-official\nmodel: deepseek-v4-flash\n---\n\n# Writer\n\nrole text\n',
    'utf8',
  )
  const routes = new Map()
  const webServer = { register(route) { routes.set(route.path, route) } }
  const settings = { register() {} }
  const ctx = {
    tools: { register() {} },
    inject: (services, cb) => cb({ webServer, settings }),
    llm: { listProviders: () => [], listModels: async () => [] },
  }
  createApply(v => v)(ctx, {
    bindingsDir: agentsDir, templatesDir, evolution: true, projectsBaseDir: base, maxDepth: 3,
  })
  const route = routes.get('/smart-subagent/model')
  assert.ok(route, 'model route registered')
  let captured
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { captured = JSON.parse(body) },
  }
  const req = {
    method: 'POST',
    [Symbol.asyncIterator]() {
      const body = JSON.stringify({ projectRoot: join(base, 'proj-m'), agentKey: 'writer', model: 'deepseek-v3' })
      let sent = false
      return {
        next: async () => (sent ? { done: true } : ((sent = true), { done: false, value: Buffer.from(body) })),
      }
    },
  }
  await route.handler(req, res)
  assert.equal(res.status, 200)
  assert.equal(captured.ok, true)
  assert.equal(captured.model, 'deepseek-v3')
  const after = await readFile(bindingFile, 'utf8')
  assert.match(after, /^model: deepseek-v3$/m)
  assert.match(after, /role text/)
})

test('execute uses the conversation workspace scope for bindings + evolution', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smart-sub-sesbase-'))
  const agentsDir = join(base, 'proj-s', 'agents')
  await mkdir(agentsDir, { recursive: true })
  await writeFile(
    join(agentsDir, 'writer.md'),
    '---\nprovider: deepseek-official\nmodel: deepseek-v4-flash\n---\n\n# Writer\n\nrole text\n',
    'utf8',
  )
  // A DIFFERENT bindings dir configured on the plugin — the session workspace
  // must win over it.
  const fallbackBindings = await mkdtemp(join(tmpdir(), 'smart-sub-fb-'))
  const starts = []
  const ctx = {
    tools: { register() {} },
    llm: {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash' }],
    },
    subagents: {
      async start(provider, request) {
        starts.push(request)
        return {
          id: 'r-1',
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }),
          async dispose() {},
        }
      },
      async startContinuable(spec) {
        starts.push(spec)
        return { childId: 'bg-1', messageId: 'm-1' }
      },
    },
  }
  let definition
  ctx.tools = { register(value) { definition = value } }
  createApply(v => v)(ctx, {
    bindingsDir: fallbackBindings, templatesDir, evolution: true, maxDepth: 3,
  })
  const sessionExec = {
    agent: { session: { header: { cwd: join(base, 'proj-s') } } },
    signal: new AbortController().signal,
  }
  await definition.execute({
    agent_key: 'writer', description: 'write', prompt: 'write the chapter', run_in_background: false,
  }, sessionExec)
  assert.equal(starts.length, 1)
  // routed with the project binding's model
  assert.equal(starts[0].agentOptions.model, 'deepseek-v4-flash')
})
