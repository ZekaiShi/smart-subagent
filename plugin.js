import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { assertAgentKey, assertRegisteredModel, loadBinding, loadTemplate, setBindingModel } from './binding.js'
import {
  readEvolution,
  buildInjection,
  parseEvolutionBlock,
  recordEvolution,
  defaultEvolutionDir,
  detectAgents,
  readEvolutionFilesRaw,
  writeEvolutionFiles,
} from './evolution.js'
import { resolveSessionScope, detectProjects, findProjectRoot } from './scope.js'

function loadRuntimeConfig(evolutionDir, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(join(evolutionDir, 'config.json'), 'utf8'))
    return typeof parsed?.evolution === 'boolean' ? parsed.evolution : fallback
  } catch {
    return fallback
  }
}

function saveRuntimeConfig(evolutionDir, evolution) {
  try {
    writeFileSync(join(evolutionDir, 'config.json'), JSON.stringify({ evolution }, null, 2), 'utf8')
  } catch (error) {
    console.error(`[smart-subagent] failed to persist evolution config: ${error}`)
  }
}

/** Evolution directory for a given project root (project-scoped), falling back
 * to the host default when no project root is supplied. */
async function scopeEvolutionDir(projectRoot, fallbackDir) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return fallbackDir
  const root = await findProjectRoot(projectRoot)
  return join(root, '.dsh', 'smart-subagent', 'evolution')
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

// Loopback HTTP surface for the settings card (browser half). Lives and dies
// with the web profile; headless profiles never call this. Follows modlens:
// the card talks to routes rather than a settings schema, because evolution
// files live on disk and the toggle must be applied at runtime.
function registerEvolutionWeb(webServer, { bindingsDir, templatesDir, evolutionDir, state, scope, projectsBaseDir, llm }) {
  const error = (error) => ({ error: String(error?.message ?? error) })

  webServer.register({
    name: 'smart-subagent-agents',
    kind: 'exact',
    path: '/smart-subagent/agents',
    handler: async (req, res) => {
      try {
        const agents = await detectAgents(bindingsDir, templatesDir)
        sendJson(res, 200, { agents, evolution: state.evolution, scope })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'smart-subagent-projects',
    kind: 'exact',
    path: '/smart-subagent/projects',
    handler: async (req, res) => {
      try {
        const found = await detectProjects(projectsBaseDir)
        const projects = []
        const modelsByProvider = new Map()
        for (const project of found) {
          const agents = await detectAgents(project.agentsDir, templatesDir)
          // Enrich each agent with its routing provider/model and whether the
          // model is editable (only project binding files are editable).
          const enriched = []
          for (const agent of agents) {
            let provider, model
            const binding = await loadBinding(project.agentsDir, agent.agentKey)
            if (binding !== undefined) {
              provider = binding.provider
              model = binding.model
            } else {
              const template = await loadTemplate(templatesDir, agent.agentKey)
              if (template !== undefined) {
                provider = template.provider
                model = template.model
              }
            }
            if (provider !== undefined && !modelsByProvider.has(provider) && llm !== undefined) {
              try {
                const listed = await llm.listModels(provider)
                modelsByProvider.set(provider, listed.map((entry) => entry.id))
              } catch {
                modelsByProvider.set(provider, [])
              }
            }
            enriched.push({
              agentKey: agent.agentKey,
              source: agent.source,
              provider,
              model,
              editable: binding !== undefined,
            })
          }
          projects.push({
            projectName: project.projectName,
            projectRoot: project.projectRoot,
            agentsDir: project.agentsDir,
            agents: enriched,
          })
        }
        sendJson(res, 200, {
          projects,
          evolution: state.evolution,
          scope,
          modelsByProvider: Object.fromEntries(modelsByProvider),
        })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'smart-subagent-model',
    kind: 'exact',
    path: '/smart-subagent/model',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const key = assertAgentKey(String(body.agentKey ?? ''))
        const model = String(body.model ?? '')
        if (model.length === 0) throw new Error('model is required')
        const projectRoot = await findProjectRoot(String(body.projectRoot ?? process.cwd()))
        const filename = join(projectRoot, 'agents', `${key}.md`)
        const updated = await setBindingModel(filename, model)
        sendJson(res, 200, { ok: true, provider: updated.provider, model: updated.model })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'smart-subagent-evolution-read',
    kind: 'exact',
    path: '/smart-subagent/evolution/read',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const evoDir = await scopeEvolutionDir(body.projectRoot, evolutionDir)
        const files = await readEvolutionFilesRaw(evoDir, String(body.agentKey ?? ''))
        sendJson(res, 200, files)
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'smart-subagent-evolution-save',
    kind: 'exact',
    path: '/smart-subagent/evolution/save',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const key = assertAgentKey(String(body.agentKey ?? ''))
        const evoDir = await scopeEvolutionDir(body.projectRoot, evolutionDir)
        await writeEvolutionFiles(evoDir, key, {
          ...(typeof body.prefercmd === 'string' ? { prefercmd: body.prefercmd } : {}),
          ...(typeof body.memory === 'string' ? { memory: body.memory } : {}),
        })
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'smart-subagent-config',
    kind: 'exact',
    path: '/smart-subagent/config',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        if (typeof body.evolution === 'boolean') {
          state.evolution = body.evolution
          saveRuntimeConfig(evolutionDir, body.evolution)
        }
        sendJson(res, 200, { evolution: state.evolution })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })
}

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
    const bindingsDir = resolve(
      config.bindingsDir ?? process.env.SMART_SUBAGENT_BINDINGS_DIR ?? process.env.DSH_AGENT_BINDINGS_DIR ?? 'agents',
    )
    const templatesDir = resolve(config.templatesDir ?? fileURLToPath(new URL('./templates/', import.meta.url)))
    const provider = config.provider ?? 'spawn'
    const toolName = config.toolName ?? 'smart_subagent'
    const maxDepth = config.maxDepth ?? 3
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
      throw new Error('smart-subagent: maxDepth must be a non-negative safe integer')
    }
    const evolutionDir = config.evolutionDir
      ? resolve(config.evolutionDir)
      : (process.env.SMART_SUBAGENT_EVOLUTION_DIR
        ? resolve(process.env.SMART_SUBAGENT_EVOLUTION_DIR)
        : defaultEvolutionDir())
    // Directory scanned by the settings card to group subagents by project.
    // The card (browser) has no conversation context, so this defaults to the
    // profile's working directory and can be pointed at the workspace root that
    // contains the projects (e.g. SMART_SUBAGENT_PROJECTS_DIR=D:\trae).
    const projectsBaseDir = config.projectsBaseDir
      ? resolve(config.projectsBaseDir)
      : (process.env.SMART_SUBAGENT_PROJECTS_DIR
        ? resolve(process.env.SMART_SUBAGENT_PROJECTS_DIR)
        : process.cwd())
    // The scope shown in the settings card: which project/conversation this
    // instance manages, so per-project subagent + evolution management is
    // unambiguous when the same profile serves multiple projects.
    const cwd = process.cwd()
    const scope = Object.freeze({
      cwd,
      projectName: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
      bindingsDir,
      evolutionDir,
      projectsBaseDir,
    })
    // Runtime state: `evolution` can be flipped by the settings card and
    // persists to <evolutionDir>/config.json. A hard config/env disable still
    // wins over the persisted toggle.
    const hardDisabled = config.evolution === false || process.env.SMART_SUBAGENT_EVOLUTION === 'false'
    const state = { evolution: hardDisabled ? false : loadRuntimeConfig(evolutionDir, true) }

    // Browser-half surface. Optional: webServer exists only under the web
    // profile, and settings only when the settings page can dispatch cards.
    // Absent either, the plugin stays a pure host tool (headless profiles).
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (browser) => {
        try {
          registerEvolutionWeb(browser.webServer, {
            bindingsDir,
            templatesDir,
            evolutionDir,
            state,
            scope,
            projectsBaseDir,
            llm: ctx.llm,
          })
        } catch (error) {
          console.error(`[smart-subagent] settings web routes skipped: ${error}`)
        }
      })
      ctx.inject(['settings'], (service) => {
        try {
          const passThrough = (value) => ({ ...(value ?? {}) })
          passThrough.toJSON = () => ({
            uid: 0,
            refs: { 0: { type: 'object', meta: { default: {} }, dict: {} } },
          })
          service.settings.register('smart-subagent', passThrough, { base: {} })
        } catch (error) {
          console.error(`[smart-subagent] settings namespace skipped: ${error}`)
        }
      })
    }

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
        // Per-conversation scope: detect the conversation's project workspace
        // (session cwd → project root → <root>/agents) so subagent routing and
        // evolution follow the project the conversation is working in, not the
        // process launch directory. Falls back to config / env when the session
        // carries no cwd or the project has no `agents/` folder.
        const sessionScope = await resolveSessionScope(exec)
        const effBindingsDir = sessionScope?.bindingsDir ?? bindingsDir
        const effEvolutionDir = sessionScope?.evolutionDir ?? evolutionDir
        const agentKey = assertAgentKey(args.agent_key)
        const description = nonEmpty(args.description, 'description')
        // Prefer the user's own binding; fall back to the bundled template so
        // the official roles (code-reviewer, researcher, wps-worker, ...) work
        // with zero configuration.
        const binding = await loadBinding(effBindingsDir, agentKey)
        const template = binding === undefined ? await loadTemplate(templatesDir, agentKey) : undefined
        if (binding === undefined && template === undefined) {
          // No user binding and no built-in template: preserve DSH's native
          // parent-model inheritance (no agentOptions, no error).
          const rawPrompt = nonEmpty(args.prompt ?? '', 'prompt')
          const evolved = state.evolution
            ? await loadAndInject(effEvolutionDir, agentKey, rawPrompt)
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
          return settleForegroundAndRecord(run, agentKey, { evolution: state.evolution, evolutionDir: effEvolutionDir })
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
        const effectivePrompt = state.evolution
          ? await loadAndInject(effEvolutionDir, agentKey, basePrompt)
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
        return settleForegroundAndRecord(run, agentKey, { evolution: state.evolution, evolutionDir: effEvolutionDir })
      },
    }))
  }
}
