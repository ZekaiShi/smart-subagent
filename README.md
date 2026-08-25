# evo-subagent

![evo-subagent — Route. Remember. Evolve.](assets/Evo-subagent-preview.png)

[English](README.md) | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/evo-subagent.svg)](https://www.npmjs.com/package/evo-subagent)
[![license](https://img.shields.io/npm/l/evo-subagent.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

`evo-subagent` is a DeepSeek Harness plugin for predictable subagent routing and project-scoped evolution.

It maps stable agent roles to registered provider/model pairs, remembers verified commands and lessons for each role, and keeps every project's agent knowledge isolated.

## Features

- Route each `agent_key` through a same-named Markdown binding.
- Validate the exact provider/model pair before creating a child agent.
- Maintain per-agent `prefercmd.md` and `memory.md` knowledge files.
- Isolate bindings and evolution data by project workspace.
- Support fresh `spawn` children and context-aware `fork` children.
- Fall back to DSH's native model inheritance when no binding exists.
- Store no API keys, endpoints, credentials, or provider definitions.

## Installation

```sh
dsh plugin add evo-subagent
```

## Agent bindings

Create an `agents/` directory in the project and add one Markdown file per role. The filename stem becomes the `agent_key`.

```text
project/
├─ agents/
│  ├─ code-reviewer.md
│  └─ researcher.md
└─ .evo_subagent/
   └─ evolution/
```

Each binding begins with a strict front matter block:

```md
---
provider: deepseek-official
model: deepseek-v4-flash
---

# Code reviewer
Optional role notes may follow.
```

The provider and model must already be registered. Matching is exact and case-sensitive.

Call the plugin tool with the corresponding key:

```json
{
  "agent_key": "code-reviewer",
  "description": "Review the implementation",
  "prompt": "Report correctness, security, and test coverage issues.",
  "run_in_background": false
}
```

## Built-in roles

Three templates are included:

| `agent_key` | Role |
| --- | --- |
| `code-reviewer` | Severity-ranked code review |
| `researcher` | Evidence-backed investigation |
| `wps-worker` | Office document production |

A project binding with the same `agent_key` overrides its built-in template.

## Evolution

Each project stores role-specific knowledge under:

```text
.evo_subagent/evolution/<agent_key>/prefercmd.md
.evo_subagent/evolution/<agent_key>/memory.md
```

- `prefercmd.md` records commands that have been verified to work.
- `memory.md` records reusable lessons and failures to avoid.

Foreground subagents receive a bounded knowledge block. They can return new entries with:

```md
[[EVOLUTION]]
prefercmd:
- pnpm test
memory:
- Do not use --force in CI.
[[/EVOLUTION]]
```

Entries are deduplicated and bounded. Prefix an entry with `!` to keep it at highest priority, or `?` to make it compressible when the context budget is tight.

Legacy `.smart_subagent/evolution` data remains a read-only fallback and is copied to the new location on the next save.

## Workspace management

The plugin settings card groups agents by project and lets users:

- view or collapse workspace agent lists;
- edit a custom binding's registered provider/model route;
- add a built-in role to a workspace by copying its template;
- bind one workspace-root `AGENTS.md` as the Main agent;
- inspect and edit each agent's evolution files.

Main-agent evolution is stored under `.evo_subagent/evolution/main/`. Binding and unbinding only changes the plugin-managed instruction block in `AGENTS.md`.

## Tool fields

| Field | Required | Description |
| --- | --- | --- |
| `agent_key` | Yes | Binding filename without `.md`. |
| `description` | Yes | Short task label. |
| `prompt` | Yes | Complete task for the child agent. |
| `run_in_background` | No | Defaults to `true`; use `false` to collect evolution output. |

## Routing behavior

1. Resolve `<agent_key>.md` safely.
2. Parse its fenced `provider` and `model` fields.
3. Verify both values against the live model registry.
4. Start the child through the selected `spawn` or `fork` provider.

Invalid bindings fail before a child is created. Missing bindings preserve native DSH inheritance unless a built-in template matches.

## Development

Requires Node.js 22 or newer.

```sh
npm test
npm run check
npm pack --dry-run
```

## License

[MIT](LICENSE)
