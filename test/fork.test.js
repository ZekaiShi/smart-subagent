import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApply } from '../plugin.js'

async function harness(files = {}, config = {}) {
  const bindingsDir = await mkdtemp(join(tmpdir(), 'smart-subagent-fork-'))
  for (const [key, text] of Object.entries(files)) {
    await writeFile(join(bindingsDir, `${key}.md`), text, 'utf8')
  }
  let definition
  const forkStarts = []
  const forkContinuing = []
  const ctx = {
    tools: { register(value) { definition = value } },
    llm: {
      listProviders: () => [{ id: 'registered-provider', name: 'Registered' }],
      listModels: async () => [{ provider: 'registered-provider', id: 'registered-model', name: 'Registered model' }],
    },
    subagents: {
      async start(provider, request) {
        if (provider !== 'fork') throw new Error(`expected fork provider, got ${provider}`)
        forkStarts.push({ provider, request })
        return {
          id: 'fork-run-1',
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'forked-done' }] }),
          async dispose() {},
        }
      },
      async startContinuable(spec) {
        if (spec.provider !== 'fork') throw new Error(`expected fork provider, got ${spec.provider}`)
        forkContinuing.push(spec)
        return { childId: 'fork-child-1', messageId: 'fork-message-1' }
      },
    },
  }
  createApply(value => value)(ctx, { bindingsDir, provider: 'fork', toolName: 'smart_subagent', maxDepth: 3, ...config })
  return { definition, forkStarts, forkContinuing }
}

const exec = { agent: { options: { provider: 'parent-provider', model: 'parent-model' } }, signal: new AbortController().signal }

test('fork mode: a valid binding routes to the fork provider with the registered provider/model pair', async () => {
  const h = await harness({ editor: '---\nprovider: registered-provider\nmodel: registered-model\n---\n' })
  const result = await h.definition.execute({
    agent_key: 'editor', description: 'edit', prompt: 'review this change', run_in_background: false,
  }, exec)
  assert.deepEqual(result, { kind: 'foreground', runId: 'fork-run-1', output: [{ type: 'text', text: 'forked-done' }] })
  assert.equal(h.forkStarts.length, 1)
  assert.equal(h.forkStarts[0].provider, 'fork')
  assert.deepEqual(h.forkStarts[0].request.agentOptions, {
    provider: 'registered-provider', model: 'registered-model',
  })
  assert.equal(h.forkStarts[0].request.prompt[0].text, 'review this change')
  // The key is a routing selector, never injected into the child prompt.
  assert.equal(JSON.stringify(h.forkStarts[0].request).includes('editor'), false)
})

test('fork mode: a missing binding omits agentOptions and keeps the fork provider', async () => {
  const h = await harness()
  await h.definition.execute({
    agent_key: 'unbound', description: 'work', prompt: 'task', run_in_background: true,
  }, exec)
  assert.equal(Object.hasOwn(h.forkContinuing[0].request, 'agentOptions'), false)
  assert.equal(h.forkContinuing[0].provider, 'fork')
  assert.equal(h.forkContinuing[0].request.prompt[0].text, 'task')
})

test('fork mode: an invalid model fails before any fork provider is called', async () => {
  const h = await harness({ editor: '---\nprovider: registered-provider\nmodel: missing-model\n---\n' })
  await assert.rejects(h.definition.execute({
    agent_key: 'editor', description: 'edit', prompt: 'task', run_in_background: false,
  }, exec), /model "missing-model" is not registered/)
  assert.equal(h.forkStarts.length, 0)
  assert.equal(h.forkContinuing.length, 0)
})

test('fork mode: background run uses startContinuable on the fork provider', async () => {
  const h = await harness({ planner: '---\nprovider: registered-provider\nmodel: registered-model\n---\n' })
  const result = await h.definition.execute({
    agent_key: 'planner', description: 'plan', prompt: 'make a plan', run_in_background: true,
  }, exec)
  assert.deepEqual(result, { kind: 'continuable', subagentId: 'fork-child-1' })
  assert.equal(h.forkStarts.length, 0)
  assert.equal(h.forkContinuing.length, 1)
  assert.equal(h.forkContinuing[0].provider, 'fork')
  assert.deepEqual(h.forkContinuing[0].request.agentOptions, {
    provider: 'registered-provider', model: 'registered-model',
  })
})
