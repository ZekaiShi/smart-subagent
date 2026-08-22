import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const AGENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const FRONT_MATTER_DELIMITER = '---'
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
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/, 5)
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    throw new Error(`${filename}: line 1 must be exactly "---"`)
  }
  const provider = PROVIDER_LINE.exec(lines[1] ?? '')?.[1]
  const model = MODEL_LINE.exec(lines[2] ?? '')?.[1]
  if (provider === undefined) {
    throw new Error(`${filename}: line 2 must be exactly "provider: <registered-provider-id>"`)
  }
  if (model === undefined) {
    throw new Error(`${filename}: line 3 must be exactly "model: <registered-model-id>"`)
  }
  if (lines[3] !== FRONT_MATTER_DELIMITER) {
    throw new Error(`${filename}: line 4 must be exactly "---"`)
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

/**
 * Rewrite the `model:` line in a binding file's 4-line front matter and return
 * the new header. Preserves everything after the front matter untouched, so the
 * settings card can switch an agent's routing model by editing the same file a
 * developer would edit by hand.
 *
 * @param {string} filename - absolute path to the binding `.md` file
 * @param {string} model - new model id
 * @returns {Promise<{provider: string, model: string}>}
 */
export async function setBindingModel(filename, model) {
  if (typeof model !== 'string' || model.length === 0) {
    throw new TypeError('smart-subagent: model must be a non-empty string')
  }
  const text = await readFile(filename, 'utf8')
  const body = text.replace(/^\uFEFF/, '')
  const lines = body.split(/\r?\n/)
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    throw new Error(`${filename}: line 1 must be exactly "---"`)
  }
  if (!MODEL_LINE.exec(lines[2] ?? '')) {
    throw new Error(`${filename}: line 3 must be exactly "model: <registered-model-id>"`)
  }
  lines[2] = `model: ${model}`
  const updated = lines.join('\n')
  await writeFile(filename, updated, 'utf8')
  return parseBindingHeader(updated, filename)
}

/**
 * Resolve an agent key to a built-in template. Mirrors loadBinding but reads
 * from the plugin's own templates directory and also returns the role prompt
 * (the body after the front matter) so the plugin can inject it into the
 * child's task when the caller did not supply one.
 *
 * @param {string} templatesDir - absolute path to the bundled templates dir.
 * @param {string} agentKey - validated routing key.
 * @returns {Promise<{provider: string, model: string, filename: string, rolePrompt: string} | undefined>}
 */
export async function loadTemplate(templatesDir, agentKey) {
  const key = assertAgentKey(agentKey)
  const filename = resolve(templatesDir, `${key}.md`)
  let text
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`smart-subagent: failed to read built-in template ${filename}`, { cause: error })
  }
  const header = parseBindingHeader(text, filename)
  // Body = everything after the 4-line front matter (--- / provider / model / ---).
  const rolePrompt = text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(4).join('\n').trim()
  return { ...header, filename, rolePrompt }
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
