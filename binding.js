import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const AGENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const PROVIDER_LINE = /^provider:[ \t]*([^\s]+)[ \t]*$/
const MODEL_LINE = /^model:[ \t]*([^\s]+)[ \t]*$/

export function assertAgentKey(agentKey) {
  if (typeof agentKey !== 'string' || !AGENT_KEY.test(agentKey)) {
    throw new Error('smart-subagent: agent_key must match [A-Za-z0-9][A-Za-z0-9_-]*')
  }
  return agentKey
}

export function parseBindingHeader(text, filename = '<binding>') {
  if (typeof text !== 'string') throw new TypeError('smart-subagent: binding content must be text')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/, 3)
  const provider = PROVIDER_LINE.exec(lines[0] ?? '')?.[1]
  const model = MODEL_LINE.exec(lines[1] ?? '')?.[1]
  if (provider === undefined) {
    throw new Error(`${filename}: line 1 must be exactly "provider: <registered-provider-id>"`)
  }
  if (model === undefined) {
    throw new Error(`${filename}: line 2 must be exactly "model: <registered-model-id>"`)
  }
  return Object.freeze({ provider, model })
}

export async function loadBinding(bindingsDir, agentKey) {
  const key = assertAgentKey(agentKey)
  const filename = resolve(bindingsDir, `${key}.md`)
  let text
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`smart-subagent: failed to read ${filename}`, { cause: error })
  }
  return { ...parseBindingHeader(text, filename), filename }
}

export async function assertRegisteredModel(llm, binding) {
  const providers = llm.listProviders()
  if (!providers.some(entry => entry.id === binding.provider)) {
    throw new Error(
      `smart-subagent: provider ${JSON.stringify(binding.provider)} from ${binding.filename} is not registered`,
    )
  }
  const models = await llm.listModels(binding.provider)
  if (!models.some(entry => entry.id === binding.model)) {
    throw new Error(
      `smart-subagent: model ${JSON.stringify(binding.model)} is not registered under provider `
      + `${JSON.stringify(binding.provider)} in ${binding.filename}`,
    )
  }
  return Object.freeze({ provider: binding.provider, model: binding.model })
}
