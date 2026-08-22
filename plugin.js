import { resolve } from 'node:path'
import { assertAgentKey, assertRegisteredModel, loadBinding } from './binding.js'

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

export function createApply(defineTool) {
  return function apply(ctx, config = {}) {
    const bindingsDir = resolve(config.bindingsDir ?? process.env.DSH_AGENT_BINDINGS_DIR ?? 'agents')
    const provider = config.provider ?? 'spawn'
    const toolName = config.toolName ?? 'smart_subagent'
    const maxDepth = config.maxDepth ?? 3
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
      throw new Error('smart-subagent: maxDepth must be a non-negative safe integer')
    }

    ctx.tools.register(defineTool({
      name: toolName,
      description: 'Start a fresh subagent selected by a stable agent_key. The key only chooses a registered provider/model route and is not added to the child prompt.',
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
        const prompt = nonEmpty(args.prompt, 'prompt')
        const binding = await loadBinding(bindingsDir, agentKey)
        const agentOptions = binding === undefined ? undefined : await assertRegisteredModel(ctx.llm, binding)
        const request = {
          label: description,
          prompt: [{ type: 'text', text: prompt }],
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
        return settleForeground(run)
      },
    }))
  }
}
