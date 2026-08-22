import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApply } from '../plugin.js'

async function harness(files = {}) {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'dsh-agent-model-binding-plugin-'))
  for (const [key, text] of Object.entries(files)) {
    await writeFile(join(bindingsDir, `${key}.md`), text, 'utf8')
  }
  let definition
  const starts = []
  const continuing = []
  const ctx = {
    tools: { register(value) { definition = value } },
    llm: {
      listProviders: () => [{ id: 'registered-provider', name: 'Registered' }],
      listModels: async () => [{ provider: 'registered-provider', id: 'registered-model', name: 'Registered model' }],
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
        continuing.push(spec)
        return { childId: 'child-1', messageId: 'message-1' }
      },
    },
  }
  createApply(value => value)(ctx, { bindingsDir, provider: 'spawn', toolName: 'agent_subagent', maxDepth: 3 })
  return { definition, starts, continuing }
}

const exec = { agent: { options: { provider: 'parent-provider', model: 'parent-model' } }, signal: new AbortController().signal }

test('a valid binding injects only its registered provider/model route', async () => {
  const h = await harness({ writer: 'provider: registered-provider\nmodel: registered-model\n' })
  const result = await h.definition.execute({
    agent_key: 'writer', description: 'write', prompt: 'draft', run_in_background: false,
  }, exec)
  assert.deepEqual(result, { kind: 'foreground', runId: 'run-1', output: [{ type: 'text', text: 'done' }] })
  assert.deepEqual(h.starts[0].request.agentOptions, {
    provider: 'registered-provider', model: 'registered-model',
  })
  assert.equal(h.starts[0].request.prompt[0].text, 'draft')
  assert.equal(JSON.stringify(h.starts[0].request).includes('writer'), false)
})

test('a missing binding omits agentOptions so official spawn inherits the parent route', async () => {
  const h = await harness()
  await h.definition.execute({
    agent_key: 'unbound', description: 'work', prompt: 'task', run_in_background: true,
  }, exec)
  assert.equal(Object.hasOwn(h.continuing[0].request, 'agentOptions'), false)
  assert.equal(h.continuing[0].provider, 'spawn')
})

test('an invalid model fails before any spawn provider is called', async () => {
  const h = await harness({ writer: 'provider: registered-provider\nmodel: missing-model\n' })
  await assert.rejects(h.definition.execute({
    agent_key: 'writer', description: 'write', prompt: 'draft', run_in_background: false,
  }, exec), /model "missing-model" is not registered/)
  assert.equal(h.starts.length, 0)
  assert.equal(h.continuing.length, 0)
})
