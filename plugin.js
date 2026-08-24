import { fileURLToPath } from 'node:url'
import { constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
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
  legacyProjectEvolutionDir,
  projectEvolutionDir,
  readMainAgentConfig,
  setMainAgentConfig,
} from './evolution.js'
import { resolveSessionScope, detectProjectsIn, findProjectRoot, hasDir } from './scope.js'
import { ensureWorkspaceProvisioned } from './evolution.js'

function loadRuntimeConfig(evolutionDir) {
  try {
    return JSON.parse(readFileSync(join(evolutionDir, 'config.json'), 'utf8')) ?? {}
  } catch {
    return {}
  }
}

function saveRuntimeConfig(evolutionDir, config) {
  try {
    mkdirSync(evolutionDir, { recursive: true })
    writeFileSync(join(evolutionDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
  } catch (error) {
    console.error(`[evo-subagent] failed to persist runtime config: ${error}`)
  }
}

/** Evolution directory for a given project root (project-scoped), falling back
 * to the host default when no project root is supplied. */
async function scopeEvolutionDirs(projectRoot, fallbackDir) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { evolutionDir: fallbackDir, legacyEvolutionDir: undefined }
  }
  const root = await findProjectRoot(projectRoot)
  return {
    evolutionDir: projectEvolutionDir(root),
    legacyEvolutionDir: legacyProjectEvolutionDir(root),
  }
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
function registerEvolutionWeb(webServer, { bindingsDir, templatesDir, evolutionDir, state, scope, runtime, llm }) {
  const error = (error) => ({ error: String(error?.message ?? error) })

  const projectsBaseDir = () => runtime.projectsBaseDir

  const allowedWorkspaceRoots = () => {
    const registry = runtime.workspaceRegistry
    if (registry !== undefined && typeof registry.list === 'function') {
      try {
        const roots = registry.list()
          .map((workspace) => workspace?.path)
          .filter((value) => typeof value === 'string' && value.length > 0)
        if (roots.length > 0) return roots
      } catch {
        // Fall through to the configured directory.
      }
    }
    const manual = projectsBaseDir()
    return typeof manual === 'string' && manual.length > 0 ? [manual] : []
  }

  const pathKey = (value) => {
    const normalized = resolve(value)
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  /** Read provider/model for an agent from its binding (or template) file. */
  const routeInfo = async (dir, agentKey) => {
    const binding = await loadBinding(dir, agentKey)
    if (binding !== undefined) return { provider: binding.provider, model: binding.model, editable: true }
    const template = await loadTemplate(templatesDir, agentKey)
    if (template !== undefined) return { provider: template.provider, model: template.model, editable: false }
    return { provider: undefined, model: undefined, editable: false }
  }

  webServer.register({
    name: 'evo-subagent-agents',
    kind: 'exact',
    path: '/evo-subagent/agents',
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
    name: 'evo-subagent-projects',
    kind: 'exact',
    path: '/evo-subagent/projects',
    handler: async (req, res) => {
      try {
        // Universal scan source: the profile's registered workspaces
        // (ctx.workspaceRegistry - the same list the web GUI groups sessions
        // by). Works on any machine with zero configuration. Strictly the
        // workspace's own `agents/` folder - no recursion into
        // subdirectories. The configured scan dir is only a fallback for
        // profiles with no registered workspaces.
        let baseDirs = []
        let scanSource = 'none'
        let workspaces = []
        const registry = runtime.workspaceRegistry
        if (registry !== undefined && typeof registry.list === 'function') {
          try {
            workspaces = registry.list()
              .map((workspace) => ({ path: workspace?.path, title: workspace?.title }))
              .filter((workspace) => typeof workspace.path === 'string' && workspace.path.length > 0)
          } catch {
            workspaces = []
          }
        }
        if (workspaces.length > 0) {
          baseDirs = workspaces.map((workspace) => workspace.path)
          scanSource = 'workspaces'
        } else {
          const manual = projectsBaseDir()
          if (typeof manual === 'string' && manual.length > 0) {
            baseDirs = [manual]
            scanSource = 'manual'
          }
        }
        const found = scanSource === 'workspaces'
          ? (await Promise.all(workspaces.map(async (workspace) => {
              const projectRoot = resolve(workspace.path)
              if (!(await hasDir(projectRoot))) return undefined
              return {
                projectName: workspace.title || basename(projectRoot),
                projectRoot,
                agentsDir: join(projectRoot, 'agents'),
              }
            }))).filter(Boolean)
          : await detectProjectsIn(baseDirs, { depth: 0 })
        const projects = []
        const modelsByProvider = new Map()
        // Dropdown data: every registered provider and its models, so any
        // provider/model route can be selected, not just the agent's current
        // provider.
        if (llm !== undefined) {
          try {
            for (const entry of llm.listProviders()) {
              try {
                const listed = await llm.listModels(entry.id)
                modelsByProvider.set(entry.id, listed.map((model) => model.id))
              } catch {
                modelsByProvider.set(entry.id, [])
              }
            }
          } catch {
            // provider listing unavailable - dropdowns fall back to the
            // agents' current values only
          }
        }
        for (const project of found) {
          // Out-of-the-box provisioning: when a workspace with bound subagents
          // is first scanned, auto-bind its root AGENTS.md as the main agent
          // and inject the [[EVOLUTION]] reporting instruction into each
          // binding file. Idempotent and best-effort (a settings read never
          // fails because a workspace file could not be written).
          if (state.evolution) {
            try {
              await ensureWorkspaceProvisioned(project.projectRoot, project.agentsDir)
            } catch (error) {
              console.error(`[evo-subagent] workspace provisioning skipped: ${error}`)
            }
          }
          // Only the workspace's own binding agents: built-in templates are
          // maintained as their own separate group, never mixed in here.
          const agents = (await detectAgents(project.agentsDir, templatesDir))
            .filter((agent) => agent.source !== 'template')
          const enriched = []
          for (const agent of agents) {
            const info = await routeInfo(project.agentsDir, agent.agentKey)
            enriched.push({
              agentKey: agent.agentKey,
              source: agent.source,
              provider: info.provider,
              model: info.model,
              editable: info.editable,
            })
          }
          projects.push({
            projectName: project.projectName,
            projectRoot: project.projectRoot,
            agentsDir: project.agentsDir,
            agents: enriched,
            mainAgent: await readMainAgentConfig(project.projectRoot),
          })
        }
        // Built-in templates as their own always-visible group (a non-existent
        // bindings dir makes detectAgents list templates only).
        const templateAgents = await detectAgents(join(templatesDir, '__none__'), templatesDir)
        const builtin = []
        for (const agent of templateAgents) {
          const info = await routeInfo(join(templatesDir, '__none__'), agent.agentKey)
          builtin.push({
            agentKey: agent.agentKey,
            source: 'template',
            provider: info.provider,
            model: info.model,
            editable: false,
          })
        }
        sendJson(res, 200, {
          projects,
          builtin,
          evolution: state.evolution,
          scope: {
            ...scope,
            projectsBaseDir: projectsBaseDir(),
            scanSource,
            workspaces,
          },
          modelsByProvider: Object.fromEntries(modelsByProvider),
        })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-main-agent',
    kind: 'exact',
    path: '/evo-subagent/main-agent',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const requestedRoot = resolve(String(body.projectRoot ?? ''))
        const allowed = allowedWorkspaceRoots().some((root) => pathKey(root) === pathKey(requestedRoot))
        if (!allowed) throw new Error('projectRoot is not a registered workspace')
        const mainAgent = await setMainAgentConfig(requestedRoot, String(body.filename ?? ''))
        sendJson(res, 200, { ok: true, projectRoot: requestedRoot, mainAgent })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-template-add',
    kind: 'exact',
    path: '/evo-subagent/template/add',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const key = assertAgentKey(String(body.agentKey ?? ''))
        const requestedRoot = resolve(String(body.projectRoot ?? ''))
        const allowed = allowedWorkspaceRoots().some((root) => pathKey(root) === pathKey(requestedRoot))
        if (!allowed) throw new Error('projectRoot is not a registered workspace')

        const template = await loadTemplate(templatesDir, key)
        if (template === undefined) throw new Error(`unknown built-in template: ${key}`)
        const targetDir = join(requestedRoot, 'agents')
        const target = join(targetDir, `${key}.md`)
        await mkdir(targetDir, { recursive: true })
        await copyFile(template.filename, target, constants.COPYFILE_EXCL)
        sendJson(res, 200, { ok: true, projectRoot: requestedRoot, agentKey: key, filename: target })
      } catch (cause) {
        const detail = cause?.code === 'EPERM' || cause?.code === 'EACCES'
          ? new Error(`workspace is not writable (${cause.message})`)
          : cause
        sendJson(res, 500, error(detail))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-model',
    kind: 'exact',
    path: '/evo-subagent/model',
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
        const provider = body.provider === undefined || body.provider === null
          ? undefined
          : String(body.provider)
        if (provider !== undefined && provider.length === 0) throw new Error('provider must be non-empty when given')
        const projectRoot = await findProjectRoot(String(body.projectRoot ?? process.cwd()))
        const filename = join(projectRoot, 'agents', `${key}.md`)
        const updated = await setBindingModel(filename, model, provider)
        sendJson(res, 200, { ok: true, provider: updated.provider, model: updated.model })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-evolution-read',
    kind: 'exact',
    path: '/evo-subagent/evolution/read',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const dirs = await scopeEvolutionDirs(body.projectRoot, evolutionDir)
        const files = await readEvolutionFilesRaw(dirs.evolutionDir, String(body.agentKey ?? ''), dirs.legacyEvolutionDir)
        sendJson(res, 200, files)
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-evolution-save',
    kind: 'exact',
    path: '/evo-subagent/evolution/save',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        const key = assertAgentKey(String(body.agentKey ?? ''))
        const dirs = await scopeEvolutionDirs(body.projectRoot, evolutionDir)
        await writeEvolutionFiles(dirs.evolutionDir, key, {
          ...(typeof body.prefercmd === 'string' ? { prefercmd: body.prefercmd } : {}),
          ...(typeof body.memory === 'string' ? { memory: body.memory } : {}),
        }, dirs.legacyEvolutionDir)
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })

  webServer.register({
    name: 'evo-subagent-config',
    kind: 'exact',
    path: '/evo-subagent/config',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, error(new Error('use POST')))
        return
      }
      try {
        const body = await readJsonBody(req)
        if (typeof body.evolution === 'boolean') {
          state.evolution = body.evolution
        }
        if (typeof body.projectsBaseDir === 'string') {
          // An empty string clears the fallback so scanning goes back to
          // pure workspace auto-detection.
          const trimmed = body.projectsBaseDir.trim()
          runtime.projectsBaseDir = trimmed.length > 0 ? resolve(trimmed) : undefined
        }
        saveRuntimeConfig(evolutionDir, {
          evolution: state.evolution,
          ...(runtime.projectsBaseDir === undefined ? {} : { projectsBaseDir: runtime.projectsBaseDir }),
        })
        sendJson(res, 200, {
          evolution: state.evolution,
          projectsBaseDir: runtime.projectsBaseDir ?? '',
        })
      } catch (cause) {
        sendJson(res, 500, error(cause))
      }
    },
  })
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`evo-subagent: ${field} must be a non-empty string`)
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
    throw new Error('evo-subagent: subagent disposal failed', { cause: error })
  }
  if (execution.stopReason !== 'completed') {
    const partial = partialText(execution.output)
    throw new Error(
      `evo-subagent: subagent stopped with ${execution.stopReason}`
      + (partial.length === 0 ? '' : `\nPartial output before the run ended:\n${partial}`),
    )
  }
  return { kind: 'foreground', runId: run.id, output: execution.output }
}

async function loadAndInject(evolutionDir, agentKey, basePrompt, legacyEvolutionDir) {
  const { prefercmd, memory } = await readEvolution(evolutionDir, agentKey, legacyEvolutionDir)
  const block = buildInjection(prefercmd, memory)
  return block ? basePrompt + block : basePrompt
}

async function settleForegroundAndRecord(run, agentKey, { evolution, evolutionDir, legacyEvolutionDir }) {
  const settled = await settleForeground(run)
  if (evolution) {
    const text = partialText(settled.output)
    const updates = parseEvolutionBlock(text)
    if (updates.prefercmd.length > 0 || updates.memory.length > 0) {
      // Best-effort record: never let evolution failures break the main flow.
      await recordEvolution(evolutionDir, agentKey, updates, legacyEvolutionDir).catch(() => {})
    }
  }
  return settled
}

export function createApply(defineTool) {
  return function apply(ctx, config = {}) {
    const bindingsDir = resolve(
      config.bindingsDir ?? process.env.EVO_SUBAGENT_BINDINGS_DIR ?? process.env.DSH_AGENT_BINDINGS_DIR ?? 'agents',
    )
    const templatesDir = resolve(config.templatesDir ?? fileURLToPath(new URL('./templates/', import.meta.url)))
    const provider = config.provider ?? 'spawn'
    const toolName = config.toolName ?? 'evo_subagent'
    const maxDepth = config.maxDepth ?? 3
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
      throw new Error('evo-subagent: maxDepth must be a non-negative safe integer')
    }
    const evolutionDir = config.evolutionDir
      ? resolve(config.evolutionDir)
      : (process.env.EVO_SUBAGENT_EVOLUTION_DIR
        ? resolve(process.env.EVO_SUBAGENT_EVOLUTION_DIR)
        : defaultEvolutionDir())
    // Fallback directory scanned by the settings card when the profile has no
    // registered workspaces. Empty/undefined means pure workspace
    // auto-detection. Precedence: explicit config > env
    // EVO_SUBAGENT_PROJECTS_DIR > persisted <evolutionDir>/config.json.
    const legacyRuntimeConfig = config.evolutionDir || process.env.EVO_SUBAGENT_EVOLUTION_DIR
      ? {}
      : loadRuntimeConfig(legacyProjectEvolutionDir(process.cwd()))
    const persistedConfig = {
      ...legacyRuntimeConfig,
      ...loadRuntimeConfig(evolutionDir),
    }
    const projectsBaseDir = config.projectsBaseDir
      ? resolve(config.projectsBaseDir)
      : (process.env.EVO_SUBAGENT_PROJECTS_DIR
        ? resolve(process.env.EVO_SUBAGENT_PROJECTS_DIR)
        : (typeof persistedConfig.projectsBaseDir === 'string' && persistedConfig.projectsBaseDir.length > 0
          ? resolve(persistedConfig.projectsBaseDir)
          : undefined))
    const runtime = { projectsBaseDir, workspaceRegistry: undefined }
    // The scope shown in the settings card. Runtime routing itself is
    // per-conversation (resolveSessionScope in execute) - this only describes
    // where the card scans for projects.
    const scope = Object.freeze({
      bindingsDir,
      evolutionDir,
      projectsBaseDir: runtime.projectsBaseDir,
    })
    // Runtime state: `evolution` can be flipped by the settings card and
    // persists to <evolutionDir>/config.json. A hard config/env disable still
    // wins over the persisted toggle.
    const hardDisabled = config.evolution === false || process.env.EVO_SUBAGENT_EVOLUTION === 'false'
    const state = {
      evolution: hardDisabled ? false : (typeof persistedConfig.evolution === 'boolean' ? persistedConfig.evolution : true),
    }

    // Browser-half surface. Optional: webServer exists only under the web
    // profile, and settings only when the settings page can dispatch cards.
    // Absent either, the plugin stays a pure host tool (headless profiles).
    if (typeof ctx.inject === 'function') {
      // The web profile's registered workspaces: the universal, per-machine
      // scan source for the settings card. Read lazily at request time, so a
      // registry that appears later (or never, on headless profiles) is
      // handled without ordering assumptions.
      try {
        ctx.inject(['workspaceRegistry'], (service) => {
          try {
            runtime.workspaceRegistry = service?.workspaceRegistry
          } catch (error) {
            console.error(`[evo-subagent] workspace registry read failed: ${error}`)
          }
        })
      } catch (error) {
        console.error(`[evo-subagent] workspace registry hook skipped: ${error}`)
      }
      ctx.inject(['webServer'], (browser) => {
        try {
          registerEvolutionWeb(browser.webServer, {
            bindingsDir,
            templatesDir,
            evolutionDir,
            state,
            scope,
            runtime,
            llm: ctx.llm,
          })
        } catch (error) {
          console.error(`[evo-subagent] settings web routes skipped: ${error}`)
        }
      })
      ctx.inject(['settings'], (service) => {
        try {
          const passThrough = (value) => ({ ...(value ?? {}) })
          passThrough.toJSON = () => ({
            uid: 0,
            refs: { 0: { type: 'object', meta: { default: {} }, dict: {} } },
          })
          service.settings.register('evo-subagent', passThrough, { base: {} })
        } catch (error) {
          console.error(`[evo-subagent] settings namespace skipped: ${error}`)
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
        if (parent === undefined) throw new Error('evo-subagent: an initiating agent is required')
        // Per-conversation scope: detect the conversation's project workspace
        // (session cwd → project root → <root>/agents) so subagent routing and
        // evolution follow the project the conversation is working in, not the
        // process launch directory. Falls back to config / env when the session
        // carries no cwd or the project has no `agents/` folder.
        const sessionScope = await resolveSessionScope(exec)
        const effBindingsDir = sessionScope?.bindingsDir ?? bindingsDir
        const effEvolutionDir = sessionScope?.evolutionDir ?? evolutionDir
        const effLegacyEvolutionDir = sessionScope?.legacyEvolutionDir
        // Out-of-the-box provisioning: the first time a workspace with bound
        // subagents is used, auto-bind the root AGENTS.md as the main agent
        // and inject the [[EVOLUTION]] reporting instruction into every
        // binding file. Idempotent and best-effort; never blocks spawning.
        if (sessionScope !== undefined && state.evolution) {
          try {
            await ensureWorkspaceProvisioned(sessionScope.projectRoot, sessionScope.bindingsDir)
          } catch (error) {
            console.error(`[evo-subagent] workspace provisioning skipped: ${error}`)
          }
        }
        const agentKey = assertAgentKey(args.agent_key)
        const description = nonEmpty(args.description, 'description')
        // Prefer the user's own binding; fall back to the bundled template so
        // the official roles (code-reviewer, researcher, wps-worker, ...) work
        // with zero configuration.
        const binding = await loadBinding(effBindingsDir, agentKey)
        const bundledTemplate = await loadTemplate(templatesDir, agentKey)
        // When a built-in template has been copied into the workspace, keep
        // its workspace-owned role body while routing with that file's front
        // matter. A plain user binding still carries routing metadata only.
        const template = binding === undefined
          ? bundledTemplate
          : (bundledTemplate === undefined ? undefined : await loadTemplate(effBindingsDir, agentKey))
        if (binding === undefined && bundledTemplate === undefined) {
          // No user binding and no built-in template: preserve DSH's native
          // parent-model inheritance (no agentOptions, no error).
          const rawPrompt = nonEmpty(args.prompt ?? '', 'prompt')
          const evolved = state.evolution
            ? await loadAndInject(effEvolutionDir, agentKey, rawPrompt, effLegacyEvolutionDir)
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
          return settleForegroundAndRecord(run, agentKey, { evolution: state.evolution, evolutionDir: effEvolutionDir, legacyEvolutionDir: effLegacyEvolutionDir })
        }
        const route = binding ?? bundledTemplate
        const agentOptions = await assertRegisteredModel(ctx.llm, route)
        // A bundled template or its workspace copy supplies its role prompt,
        // so the caller may omit `prompt`. An explicit prompt still wins.
        const prompt = args.prompt ?? ''
        const basePrompt = (template !== undefined && prompt.trim() === '')
          ? nonEmpty(template.rolePrompt, 'template role prompt')
          : nonEmpty(prompt, 'prompt')
        const effectivePrompt = state.evolution
          ? await loadAndInject(effEvolutionDir, agentKey, basePrompt, effLegacyEvolutionDir)
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
        return settleForegroundAndRecord(run, agentKey, { evolution: state.evolution, evolutionDir: effEvolutionDir, legacyEvolutionDir: effLegacyEvolutionDir })
      },
    }))
  }
}
