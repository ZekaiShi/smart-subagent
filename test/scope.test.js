import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findProjectRoot, resolveSessionScope, detectProjects, detectProjectsIn } from '../scope.js'
import { setBindingModel } from '../binding.js'

async function tmpTree() {
  const root = await mkdtemp(join(tmpdir(), 'smart-sub-scope-'))
  return root
}

test('findProjectRoot returns startDir when no marker exists', async () => {
  const root = await tmpTree()
  assert.equal(await findProjectRoot(root), root)
})

test('findProjectRoot walks up to the nearest marker (.git / AGENTS.md / .dsh)', async () => {
  const root = await tmpTree()
  await mkdir(join(root, '.git'))
  const nested = join(root, 'a', 'b')
  await mkdir(nested, { recursive: true })
  assert.equal(await findProjectRoot(nested), root)
})

test('findProjectRoot honours explicit markers list', async () => {
  const root = await tmpTree()
  await mkdir(join(root, 'agents'))
  const nested = join(root, 'x')
  await mkdir(nested)
  assert.equal(await findProjectRoot(nested, ['agents']), root)
})

test('resolveSessionScope: undefined without a session cwd', async () => {
  assert.equal(await resolveSessionScope({ agent: { options: {} } }), undefined)
  assert.equal(await resolveSessionScope(undefined), undefined)
  assert.equal(await resolveSessionScope({ agent: { session: { header: {} } } }), undefined)
})

test('resolveSessionScope: project with agents/ dir is detected from conversation cwd', async () => {
  const root = await tmpTree()
  await mkdir(join(root, 'agents'))
  const exec = { agent: { session: { header: { cwd: root } } } }
  const scope = await resolveSessionScope(exec)
  assert.ok(scope, 'scope resolved')
  assert.equal(scope.projectRoot, root)
  assert.equal(scope.bindingsDir, join(root, 'agents'))
  assert.equal(scope.evolutionDir, join(root, '.smart_subagent', 'evolution'))
  assert.equal(scope.legacyEvolutionDir, join(root, '.dsh', 'smart-subagent', 'evolution'))
  assert.ok(scope.projectName.length > 0)
})

test('resolveSessionScope: project without agents/ dir falls back to undefined', async () => {
  const root = await tmpTree()
  const exec = { agent: { session: { header: { cwd: root } } } }
  assert.equal(await resolveSessionScope(exec), undefined)
})

test('resolveSessionScope: walks up from a nested conversation cwd to the project agents/', async () => {
  const root = await tmpTree()
  await mkdir(join(root, 'agents'))
  const nested = join(root, 'chapters', 'chapter_001')
  await mkdir(nested, { recursive: true })
  const exec = { agent: { session: { header: { cwd: nested } } } }
  const scope = await resolveSessionScope(exec)
  assert.ok(scope, 'scope resolved from nested cwd')
  assert.equal(scope.projectRoot, root)
  assert.equal(scope.bindingsDir, join(root, 'agents'))
})

test('detectProjects finds projects with agents/ folders up to depth', async () => {
  const base = await tmpTree()
  // depth-1 project
  await mkdir(join(base, 'proj-a', 'agents'), { recursive: true })
  // depth-2 project
  await mkdir(join(base, 'nest', 'proj-b', 'agents'), { recursive: true })
  // non-project with no agents/ dir must be ignored
  await mkdir(join(base, 'plain'), { recursive: true })
  const projects = await detectProjects(base)
  const names = projects.map((p) => p.projectName).sort()
  assert.deepEqual(names, ['proj-a', 'proj-b'])
})

test('detectProjects stops descending once a project root is found', async () => {
  const base = await tmpTree()
  // proj-c has agents/ so its nested proj-d should NOT be visited as a sibling project
  await mkdir(join(base, 'proj-c', 'agents', 'nested', 'agents'), { recursive: true })
  const projects = await detectProjects(base)
  const names = projects.map((p) => p.projectName)
  assert.deepEqual(names, ['proj-c'])
})

test('detectProjectsIn checks only each base\'s own agents/ folder (no recursion)', async () => {
  const base = await tmpTree()
  // A workspace that IS the project (agents/ directly under it).
  await mkdir(join(base, 'ws-project', 'agents'), { recursive: true })
  // A workspace whose first-level subdir owns agents/ - NOT found at depth 0.
  await mkdir(join(base, 'ws-parent', 'proj-x', 'agents'), { recursive: true })
  const projects = await detectProjectsIn([
    join(base, 'ws-project'),
    join(base, 'ws-parent'),
    // invalid entries are skipped, not fatal
    '',
    undefined,
    join(base, 'does-not-exist'),
  ])
  const names = projects.map((p) => p.projectName).sort()
  assert.deepEqual(names, ['ws-project'])
})

test('detectProjectsIn dedupes the same project reached via two bases', async () => {
  const base = await tmpTree()
  await mkdir(join(base, 'proj-dup', 'agents'), { recursive: true })
  const projects = await detectProjectsIn([join(base, 'proj-dup'), join(base, 'proj-dup')])
  assert.equal(projects.length, 1)
  assert.equal(projects[0].projectRoot, join(base, 'proj-dup'))
})

test('detectProjectsIn recurses when a larger depth is passed explicitly', async () => {
  const base = await tmpTree()
  await mkdir(join(base, 'ws-parent', 'proj-x', 'agents'), { recursive: true })
  const projects = await detectProjectsIn([join(base, 'ws-parent')], { depth: 1 })
  assert.deepEqual(projects.map((p) => p.projectName), ['proj-x'])
})

test('detectProjectsIn with no bases resolves to no projects', async () => {
  assert.deepEqual(await detectProjectsIn([]), [])
  assert.deepEqual(await detectProjectsIn(undefined), [])
})

test('setBindingModel rewrites only the model line and preserves the body', async () => {
  const root = await tmpTree()
  const file = join(root, 'chapter-writer.md')
  const original = `---
provider: arkagentplan
model: glm-5.3
---

# Chapter Writer

你负责写正文。
`
  await writeFile(file, original, 'utf8')
  const updated = await setBindingModel(file, 'deepseek-v4-flash')
  assert.deepEqual(updated, { provider: 'arkagentplan', model: 'deepseek-v4-flash' })
  const after = await readFile(file, 'utf8')
  assert.match(after, /^provider: arkagentplan$/m)
  assert.match(after, /^model: deepseek-v4-flash$/m)
  assert.match(after, /# Chapter Writer/)
  assert.match(after, /你负责写正文。/)
  // front matter order preserved
  assert.match(after, /^---\nprovider: arkagentplan\nmodel: deepseek-v4-flash\n---$/m)
})

test('setBindingModel rejects a malformed front matter', async () => {
  const root = await tmpTree()
  const file = join(root, 'bad.md')
  await writeFile(file, 'no front matter', 'utf8')
  await assert.rejects(() => setBindingModel(file, 'x'), /line 1 must be exactly "---"/)
})

test('setBindingModel rewrites provider and model together when both given', async () => {
  const root = await tmpTree()
  const file = join(root, 'chapter-writer.md')
  const original = `---
provider: arkagentplan
model: glm-5.3
---

# Chapter Writer

你负责写正文。
`
  await writeFile(file, original, 'utf8')
  const updated = await setBindingModel(file, 'deepseek-v4-flash', 'deepseek-official')
  assert.deepEqual(updated, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const after = await readFile(file, 'utf8')
  assert.match(after, /^---\nprovider: deepseek-official\nmodel: deepseek-v4-flash\n---$/m)
  assert.match(after, /你负责写正文。/)
})
