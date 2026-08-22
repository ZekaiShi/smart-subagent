import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { assertAgentKey, assertRegisteredModel, loadBinding, loadTemplate } from './binding.js'
import { readEvolution, buildInjection, parseEvolutionBlock, recordEvolution, defaultEvolutionDir } from './evolution.js'

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`smart-subagent: ${field} must be a non-empty string`)
  }
  return value
}

function renderOutput(output) {
  return output.length === 0 ? [{ type: 'text', text: '(subagent returned no output)' }] : output
}

function partialText(output) {
  return output
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

async function settleForeground(run) {
  let execution
  let disposal
  try {
    execution = await run.result
  } catch (error) {
    disposal = await Promise.resolve(run.dispose()).then(() => undefined, disposeError => disposeError)
    if (disposal !== undefined) throw new AggregateError([error, disposal], 'subagent result and disposal both failed')
    throw error
  }
  try {
    await run.dispose()
  } catch (error) {
    throw new Error('smart-subagent: subagent disposal failed', { cause: error })
  }
  if (execution.stopReason !== 'completed') {
    const partial = partialText(execution.output)
    throw new Error(
      `smart-subagent: subagent stopped with ${execution.stopReason}`
      + (partial.length === 0 ? '' : `\nPartial output before the run ended:\n${partial}`),
    )
  }
  return { kind: 'foreground', runId: run.id, output: execution.output }
}

async function loadAndInject(evolutionDir, agentKey, basePrompt) {
  const { prefercmd, memory } = await readEvolution(evolutionDir, agentKey)
  const block = buildInjection(prefercmd, memory)
  return block ? basePrompt + block : basePrompt
}

async function settleForegroundAndRecord(run, agentKey, { evolution, evolutionDir }) {
  const settled = await settleForeground(run)
  if (evolution) {
    const text = partialText(settled.output)
    const updates = parseEvolutionBlock(text)
    if (updates.prefercmd.length > 0 || updates.memory.length > 0) {
      // Best-effort record: never let evolution failures break the main flow.
      await recordEvolution(evolutionDir, agentKey, updates).catch(() => {})
    }
  }
  return settled
}

export function createApply(defineTool) {
  return function apply(ctx, config = {}) {
    const bindingsDir = resolve(config.bindingsDir ?? process.env.DSH_AGENT_BINDINGS_DIR ?? 'agents')
    const templatesDir = resolve(config.templatesDir ?? fileURLToPath(new URL('./templates/', import.meta.url)))
    const provider = config.provider ?? 'spawn'
    const toolName = config.toolName ?? 'smart_subagent'
    const maxDepth = config.maxDepth ?? 3
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
      throw new Error('smart-subagent: maxDepth must be a non-negative safe integer')
    }
    const evolution = config.evolution !== false && process.env.SMART_SUBAGENT_EVOLUTION !== 'false'
    const evolutionDir = config.evolutionDir ? resolve(config.evolutionDir) : defaultEvolutionDir()

    ctx.tools.register(defineTool({
      name: toolName,
      description: 'Start a fresh subagent selected by a stable agent_key. The key chooses a registered provider/model route and, for the built-in official roles (code-reviewer, researcher, wps-worker), its role prompt — pass an explicit `prompt` to override the built-in role instructions. Evolution mode (default on) maintains prefercmd/memory files per agent to reduce token waste on repeated runs. The key is not added to the child prompt.',
      parameters: {
        agent_key: {
          type: 'string',
          required: true,
          description: 'Stable machine routing key matching an <agent_key>.md file.',
        },
        description: {
          type: 'string',
          required: true,
          description: 'Short display label for the delegated task.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: 'Self-contained task delivered to the fresh subagent.',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Run as a continuable background subagent (default true). Set false to wait for its result.',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'continuable' },
                subagentId: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                runId: { type: 'string', required: true },
                output: { type: 'array', required: true, items: { type: 'json' } },
              },
            },
          ],
        },
        render: (_args, value) => value.kind === 'continuable'
          ? [{ type: 'text', text: `started subagent ${value.subagentId}` }]
          : renderOutput(value.output),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        if (parent === undefined) throw new Error('smart-subagent: an initiating agent is required')
        const agentKey = assertAgentKey(args.agent_key)
        const description = nonEmpty(args.description, 'description')
        // Prefer the user's own binding; fall back to the bundled template so
        // the official roles (code-reviewer, researcher, wps-worker, ...) work
        // with zero configuration.
        const binding = await loadBinding(bindingsDir, agentKey)
        const template = binding === undefined ? await loadTemplate(templatesDir, agentKey) : undefined
        if (binding === undefined && template === undefined) {
          // No user binding and no built-in template: preserve DSH's native
          // parent-model inheritance (no agentOptions, no error).
          const rawPrompt = nonEmpty(args.prompt ?? '', 'prompt')
          const evolved = evolution
            ? await loadAndInject(evolutionDir, agentKey, rawPrompt)
            : rawPrompt
          const request = {
            label: description,
            prompt: [{ type: 'text', text: evolved }],
            parent,
            maxDepth,
          }
          if (args.run_in_background !== false) {
            const started = await ctx.subagents.startContinuable({
              provider,
              label: description,
              request,
              signal: exec.signal,
            })
            return { kind: 'continuable', subagentId: started.childId }
          }
          const run = await ctx.subagents.start(provider, { ...request, signal: exec.signal })
          return settleForegroundAndRecord(run, agentKey, { evolution, evolutionDir })
        }
        const route = binding ?? template
        const agentOptions = await assertRegisteredModel(ctx.llm, route)
        // A template supplies its own role prompt, so the caller may omit
        // `prompt` for official roles. For a user binding the prompt is still
        // required — the binding carries routing metadata only.
        const prompt = args.prompt ?? ''
        const basePrompt = (template !== undefined && prompt.trim() === '')
          ? template.rolePrompt
          : nonEmpty(prompt, 'prompt')
        const effectivePrompt = evolution
          ? await loadAndInject(evolutionDir, agentKey, basePrompt)
          : basePrompt
        const request = {
          label: description,
          prompt: [{ type: 'text', text: effectivePrompt }],
          parent,
          maxDepth,
          ...(agentOptions === undefined ? {} : { agentOptions }),
        }

        if (args.run_in_background !== false) {
          const started = await ctx.subagents.startContinuable({
            provider,
            label: description,
            request,
            signal: exec.signal,
          })
          return { kind: 'continuable', subagentId: started.childId }
        }

        const run = await ctx.subagents.start(provider, { ...request, signal: exec.signal })
        return settleForegroundAndRecord(run, agentKey, { evolution, evolutionDir })
      },
    }))
  }
}
