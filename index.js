import { defineTool } from '@deepseek-ai/dsh-tools'
import { createApply } from './plugin.js'

export const name = 'evo-subagent'
export const inject = ['tools', 'subagents', 'llm']
export const apply = createApply(defineTool)
