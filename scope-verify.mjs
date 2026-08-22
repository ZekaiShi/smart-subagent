import { chdir } from 'node:process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultEvolutionDir, recordEvolution, readEvolution } from 'file:///D:/trae/smart-subagent/evolution.js'

// Simulate launching DSH from a project root: chdir to a temp "project" dir.
const proj = mkdtempSync(join(tmpdir(), 'smart-sub-proj-'))
chdir(proj)
const d = defaultEvolutionDir()
console.log('defaultEvolutionDir =', d)
console.log('is project-scoped  :', d.startsWith(proj))
await recordEvolution(d, 'chapter-writer', { prefercmd: ['pnpm test # proj A'], memory: ['use full-width quotes'] })
const got = await readEvolution(d, 'chapter-writer')
console.log('recorded prefercmd  :', JSON.stringify(got.prefercmd))
console.log('recorded memory     :', JSON.stringify(got.memory))
console.log('PROJECT_ISOLATION_OK')
