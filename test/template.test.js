import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createApply } from '../plugin.js'
import { loadTemplate } from '../binding.js'

// Point the plugin at the repo's real bundled templates dir.
const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')

async function harness(files = {}, config = {}) {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'smart-subagent-template-'))
  for (const [key, text] of Object.entries(files)) {
    await writeFile(join(bindingsDir, `${key}.md`), text, 'utf8')
  }
  let definition
  const starts = []
  const ctx = {
    tools: { register(value) { definition = value } },
    llm: {
      listProviders: () => [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'registered-provider', name: 'Registered' },
      ],
      listModels: async provider => provider === 'deepseek-official'
        ? [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }]
        : [{ provider: 'registered-provider', id: 'registered-model', name: 'Registered model' }],
    },
    subagents: {
      async start(provider, request) {
        starts.push({ provider, request })
        return {
          id: 'run-1',
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }),
          async dispose() {},
        }
      },
      async startContinuable(spec) {
        starts.push(spec)
        return { childId: 'child-1', messageId: 'message-1' }
      },
    },
  }
  createApply(value => value)(ctx, { bindingsDir, templatesDir, provider: 'spawn', toolName: 'smart_subagent', maxDepth: 3, ...config })
  return { definition, starts }
}

const exec = { agent: { options: { provider: 'parent-provider', model: 'parent-model' } }, signal: new AbortController().signal }

test('loadTemplate parses provider/model and the role prompt body', async () => {
  const t = await loadTemplate(templatesDir, 'code-reviewer')
  assert.equal(t.provider, 'deepseek-official')
  assert.equal(t.model, 'deepseek-v4-flash')
  assert.match(t.rolePrompt, /Code reviewer/)
})

test('a missing user binding falls back to the bundled template route', async () => {
  const h = await harness()
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: '', run_in_background: false,
  }, exec)
  assert.equal(h.starts.length, 1)
  assert.deepEqual(h.starts[0].request.agentOptions, {
    provider: 'deepseek-official', model: 'deepseek-v4-flash',
  })
  // With an empty prompt the template's role prompt is injected.
  assert.match(h.starts[0].request.prompt[0].text, /Code reviewer/)
})

test('an explicit caller prompt overrides the template role prompt', async () => {
  const h = await harness()
  await h.definition.execute({
    agent_key: 'code-reviewer', description: 'review', prompt: 'review src/index.js', run_in_background: true,
  }, exec)
  assert.equal(h.starts[0].request.prompt[0].text, 'review src/index.js')
  assert.deepEqual(h.starts[0].request.agentOptions, {
    provider: 'deepseek-official', model: 'deepseek-v4-flash',
  })
})

test('an unknown key with no binding still inherits the parent (no error, no template)', async () => {
  const h = await harness()
  await h.definition.execute({
    agent_key: 'unbound', description: 'work', prompt: 'task', run_in_background: true,
  }, exec)
  assert.equal(Object.hasOwn(h.starts[0].request, 'agentOptions'), false)
})

test('a template with an unregistered model fails before any child is created', async () => {
  // llm mock in harness() lists only deepseek-v4-flash under deepseek-official.
  // wps-worker routes to that pair, so to trigger the failure we point at a
  // template dir where the file exists but its model is unregistered.
  const h = await harness({})
  const t = await loadTemplate(templatesDir, 'wps-worker')
  assert.equal(t.provider, 'deepseek-official')
  assert.equal(t.model, 'deepseek-v4-flash')
  // Remove deepseek-v4-flash from the mock to prove an unregistered model is
  // rejected before any child starts.
  let def2
  const h2 = {
    tools: { register(value) { def2 = value } },
    llm: {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [],
    },
    subagents: {
      async start() { throw new Error('should not be called') },
      async startContinuable() { throw new Error('should not be called') },
    },
  }
  createApply(value => value)(h2, { bindingsDir: h.bindingsDir, templatesDir, provider: 'spawn', toolName: 'smart_subagent', maxDepth: 3 })
  await assert.rejects(def2.execute({
    agent_key: 'wps-worker', description: 'doc', prompt: '', run_in_background: false,
  }, exec), /model "deepseek-v4-flash" is not registered/)
})
