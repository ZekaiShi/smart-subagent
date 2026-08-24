import { readdir, access, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

/** Markers that identify a directory as a project root. */
export const PROJECT_ROOT_MARKERS = ['.git', 'AGENTS.md']

export async function hasDir(dir) {
  try {
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Walk up from `startDir` until a directory carrying a project-root marker is
 * found; otherwise return `startDir` itself. Used when a concrete project path
 * is already known (settings model edit, per-project evolution dir). The
 * default markers match DSH's own project-root detection (`.git`), plus
 * `AGENTS.md` for git-less projects; `.dsh` is deliberately NOT a marker
 * because `~/.dsh` would otherwise swallow every path under the user home.
 *
 * @param {string} startDir
 * @param {string[]} [markers]
 * @returns {Promise<string>} absolute project root path
 */
export async function findProjectRoot(startDir, markers = PROJECT_ROOT_MARKERS) {
  let dir = resolve(startDir)
  for (;;) {
    for (const marker of markers) {
      try {
        await access(join(dir, marker))
        return dir
      } catch {
        // marker absent, keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return resolve(startDir)
    dir = parent
  }
}

/**
 * Walk up from a conversation working directory to the nearest ancestor that
 * owns an `agents/` folder — the project's subagent bindings directory. This
 * directly implements "auto-detect the workspace's corresponding folder":
 * whatever depth the conversation sits at, its project's `agents/` wins.
 *
 * @param {string} cwd - conversation working directory
 * @param {number} [maxUp] - safety cap on how many ancestors to check
 * @returns {Promise<{projectRoot: string, agentsDir: string} | undefined>}
 */
export async function findAgentsDir(cwd, maxUp = 20) {
  let dir = resolve(cwd)
  for (let i = 0; i < maxUp; i++) {
    const agentsDir = join(dir, 'agents')
    if (await hasDir(agentsDir)) return { projectRoot: dir, agentsDir }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/**
 * Resolve the per-conversation project scope from the tool exec context. The
 * conversation's working directory (`exec.agent.session.header.cwd`, the same
 * field dsh-tool-bash uses to resolve its workdir) is walked up to the nearest
 * `agents/` folder; evolution then lives under `<root>/.evo_subagent/
 * evolution`. Returns undefined when there is no session cwd or no project
 * `agents/` dir, in which case callers fall back to config / env. The former
 * `.smart_subagent/evolution` path is returned read-only for migration.
 *
 * @param {{ agent?: { session?: { header?: { cwd?: string } } } }} exec
 * @returns {Promise<{cwd: string, projectRoot: string, projectName: string, bindingsDir: string, evolutionDir: string, legacyEvolutionDir: string} | undefined>}
 */
export async function resolveSessionScope(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  const found = await findAgentsDir(cwd)
  if (found === undefined) return undefined
  return Object.freeze({
    cwd,
    projectRoot: found.projectRoot,
    projectName: basename(found.projectRoot),
    bindingsDir: found.agentsDir,
    evolutionDir: join(found.projectRoot, '.evo_subagent', 'evolution'),
    legacyEvolutionDir: join(found.projectRoot, '.smart_subagent', 'evolution'),
  })
}

/**
 * Scan a base directory for projects — directories (or their subdirectories,
 * up to `depth` levels) that own an `agents/` folder. Used by the settings
 * card to group subagents by project. Hidden directories are skipped.
 *
 * @param {string} baseDir
 * @param {{ depth?: number, max?: number }} [options]
 * @returns {Promise<Array<{projectRoot: string, projectName: string, agentsDir: string}>>}
 */
export async function detectProjects(baseDir, { depth = 2, max = 50 } = {}) {
  const projects = []
  const seen = new Set()
  const root = resolve(baseDir)

  const visit = async (dir, level) => {
    if (projects.length >= max || seen.has(dir)) return
    seen.add(dir)
    const agentsDir = join(dir, 'agents')
    if (await hasDir(agentsDir)) {
      projects.push({ projectRoot: dir, projectName: basename(dir), agentsDir })
      return // a project root — do not descend into it
    }
    if (level <= 0) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      await visit(join(dir, entry.name), level - 1)
    }
  }

  await visit(root, depth)
  return projects
}

/**
 * Scan several base directories - e.g. every workspace registered in the web
 * profile (`ctx.workspaceRegistry.list()`) - for projects, deduplicating by
 * resolved project root. By default each base is checked strictly at depth 0:
 * only the base directory's own `agents/` folder counts (no recursion into
 * subdirectories), implementing "each workspace owns the agents/ folder right
 * under it". Pass a larger `depth` to recurse. Invalid or empty entries are
 * skipped, so a missing workspace directory degrades to "no projects found",
 * never an error. Read-only: never creates anything on disk.
 *
 * @param {Iterable<string>} baseDirs
 * @param {{ depth?: number, max?: number }} [options]
 * @returns {Promise<Array<{projectRoot: string, projectName: string, agentsDir: string}>>}
 */
export async function detectProjectsIn(baseDirs, { depth = 0, max = 50 } = {}) {
  const projects = []
  const seen = new Set()
  for (const baseDir of baseDirs ?? []) {
    if (typeof baseDir !== 'string' || baseDir.trim().length === 0) continue
    for (const project of await detectProjects(baseDir, { depth, max })) {
      if (seen.has(project.projectRoot)) continue
      seen.add(project.projectRoot)
      projects.push(project)
    }
  }
  return projects
}
