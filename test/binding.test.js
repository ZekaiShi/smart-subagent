import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertAgentKey, assertRegisteredModel, loadBinding, parseBindingHeader } from '../binding.js'

test('parses strict fenced front matter', () => {
  assert.deepEqual(
    parseBindingHeader('---\r\nprovider: deepseek-official\r\nmodel: deepseek-v4\r\n---\r\n# Reviewer', 'reviewer.md'),
    { provider: 'deepseek-official', model: 'deepseek-v4' },
  )
})

test('accepts a UTF-8 BOM only before the opening fence', () => {
  assert.deepEqual(parseBindingHeader('\uFEFF---\nprovider: openai\nmodel: gpt-5\n---\n'), {
    provider: 'openai',
    model: 'gpt-5',
  })
})

test('rejects reordered, blank, or malformed headers', () => {
  assert.throws(() => parseBindingHeader('provider: p\nmodel: m\n', 'unfenced.md'), /unfenced\.md: line 1/)
  assert.throws(() => parseBindingHeader('---\nmodel: m\nprovider: p\n---\n', 'bad.md'), /bad\.md: line 2/)
  assert.throws(() => parseBindingHeader('---\n\nmodel: m\n---\n', 'blank.md'), /blank\.md: line 2/)
  assert.throws(() => parseBindingHeader('---\nprovider: p extra\nmodel: m\n---\n', 'space.md'), /space\.md: line 2/)
  assert.throws(() => parseBindingHeader('---\nprovider: p\nmodel: m\n', 'open.md'), /open\.md: line 4/)
})

test('rejects path traversal and unstable agent keys', () => {
  for (const key of ['', '../writer', 'writer.md', 'writer role', '_writer']) {
    assert.throws(() => assertAgentKey(key), /agent_key/)
  }
  assert.equal(assertAgentKey('chapter-writer_2'), 'chapter-writer_2')
})

test('missing binding means inherit parent; an existing file resolves exactly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evo-subagent-'))
  assert.equal(await loadBinding(dir, 'missing'), undefined)
  await writeFile(join(dir, 'chapter-writer.md'), '---\nprovider: p\nmodel: m\n---\nrole text', 'utf8')
  const binding = await loadBinding(dir, 'chapter-writer')
  assert.equal(binding.provider, 'p')
  assert.equal(binding.model, 'm')
  assert.equal(binding.filename, join(dir, 'chapter-writer.md'))
})

test('strictly matches the provider/model pair', async () => {
  const llm = {
    listProviders: () => [{ id: 'p', name: 'Provider' }],
    listModels: async provider => provider === 'p' ? [{ provider: 'p', id: 'm', name: 'Model' }] : [],
  }
  assert.deepEqual(await assertRegisteredModel(llm, { provider: 'p', model: 'm', filename: 'a.md' }), {
    provider: 'p', model: 'm',
  })
  await assert.rejects(
    assertRegisteredModel(llm, { provider: 'missing', model: 'm', filename: 'a.md' }),
    /provider "missing".*not registered/,
  )
  await assert.rejects(
    assertRegisteredModel(llm, { provider: 'p', model: 'missing', filename: 'a.md' }),
    /model "missing".*not registered under provider "p"/,
  )
})
