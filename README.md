# smart-subagent

[English](README.md) | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/smart-subagent.svg)](https://www.npmjs.com/package/smart-subagent)
[![license](https://img.shields.io/npm/l/smart-subagent.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

`smart-subagent` is a lightweight plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It maps a stable `agent_key` to an exact provider/model pair already registered in DSH, allowing different subagent roles to use predictable model routes without duplicating credentials or provider configuration.

The plugin is role-agnostic. A binding can represent a code reviewer, test runner, researcher, planner, verifier, data analyst, or any other specialized subagent.

## Features

- Maps each `agent_key` to a same-named Markdown binding file.
- Reads strict `provider` and `model` metadata from a fenced front matter block.
- Validates the exact provider/model pair against the live DSH model registry before spawning.
- Supports foreground one-shot runs and continuable background subagents.
- Preserves DSH's native parent-model inheritance when no binding file exists.
- Stores no API keys, endpoints, credentials, or provider definitions.
- Delegates child creation to the official DSH `spawn` provider.

## Installation

Install the published npm package into a DSH profile:

```sh
dsh plugin add smart-subagent
```

Install directly from GitHub:

```sh
dsh plugin add github:ZekaiShi/smart-subagent
```

For local development:

```sh
dsh plugin add ./smart-subagent
```

Add `--profile <name>` to target a non-default profile.

## Binding files

The filename stem is the `agent_key`. Every binding starts with a strict four-line front matter block. The opening and closing fences must be exactly `---`, with no blank lines inside:

```md
---
provider: deepseek-official
model: deepseek-v4-flash
---

# Code reviewer
Optional notes for people or external tooling may follow this header.
```

For a file named `code-reviewer.md`, call the registered tool with `agent_key: "code-reviewer"`:

```json
{
  "agent_key": "code-reviewer",
  "description": "Review implementation",
  "prompt": "Inspect the supplied change and report correctness, security, and test coverage issues.",
  "run_in_background": true
}
```

Only the fenced front matter is routing metadata. The remaining Markdown content is not automatically appended to the child prompt; the tool call's `prompt` is the authoritative task sent to the subagent.

## Built-in roles

The plugin ships **official role templates** in `templates/` that work with zero
configuration — no binding file needed. When an `agent_key` has no matching file
in your binding directory, the plugin falls back to the bundled template of the
same name, using its `provider`/`model` route and its role instructions.

| agent_key | Role | Notes |
| --- | --- | --- |
| `code-reviewer` | Rigorous code review with severity-ranked findings | structured Markdown report |
| `researcher` | Evidence-backed investigation with cited sources | facts vs. inferences, confidence |
| `wps-worker` | Office-document producer via the Python trio | python-pptx / python-docx / openpyxl; **confirms before writing files** |

Official roles are written with a `name(smart-subagent)` suffix — e.g.
`code-reviewer(smart-subagent)` — to mark them as built-in and distinguish them
from your own custom bindings. You can use the suffix anywhere the official
source matters (docs, prompts, conversation); the plugin matches on the bare
`agent_key` stem.

To use a built-in role, pass an empty `prompt` (the role's own instructions are
injected), or pass your own `prompt` to override them:

```json
{
  "agent_key": "code-reviewer",
  "description": "Review the change",
  "prompt": "",
  "run_in_background": false
}
```

A template's `provider`/`model` must be registered in your DSH profile (the same
validation as user bindings); an unregistered pair fails before any child starts.
Overriding a built-in role works by creating your own `<agent_key>.md` in the binding
directory — your file wins over the template.

## Evolution mode

The plugin continuously refines per-agent `prefercmd` (verified commands) and
`memory` (lessons learned) files to reduce token waste on repeated runs by
shortening the rediscovery loop.

- **Default: on.** Disable with `evolution: false` in the plugin config or the
  `SMART_SUBAGENT_EVOLUTION=false` environment variable.
- **Project-scoped by default.** Evolution files live under the DSH launch
  working directory:
  `<project>/.dsh/smart-subagent/evolution/<agent_key>/prefercmd.md` and
  `memory.md` — the same base the `agents/` bindings directory resolves from,
  so each project/conversation keeps its own evolution state with no
  cross-project contamination. Override per project with
  `SMART_SUBAGENT_EVOLUTION_DIR` (absolute path) or `evolutionDir`. The files
  never appear in your project's `agents/` folder.
- On each foreground run the plugin injects the two files as a bounded context
  block (capped at ~2000 tokens) into the child prompt, so the subagent starts
  from proven commands instead of re-deriving them.
- At the end of a foreground run the plugin scans the final output for an
  `[[EVOLUTION]]` block and merges new entries:

  ```markdown
  [[EVOLUTION]]
  prefercmd:
  - pnpm test  # faster test runner
  memory:
  - don't use --force on CI
  [[/EVOLUTION]]
  ```

- Entries are deduplicated and kept within limits (40 prefercmd, 25 memory);
  the oldest entries are dropped first, so injection cost stays bounded.
- Background runs don't record (no final output is available to the caller).

Use `detectAgents(bindingsDir, templatesDir)` from `smart-subagent/evolution`
to list all available agent keys programmatically.

## Binding directory

Set the binding directory before starting DSH, in the same process environment you
launch DSH from. Relative paths resolve from the DSH launch working directory.

PowerShell:

```powershell
$env:SMART_SUBAGENT_BINDINGS_DIR = 'C:\path\to\agents'
dsh   # or however you normally start DSH (dsh web, desktop app, ...)
```

Bash:

```sh
SMART_SUBAGENT_BINDINGS_DIR=/absolute/path/to/agents dsh
```

`DSH_AGENT_BINDINGS_DIR` remains available as a compatibility fallback.

## Tool interface

The plugin registers `smart_subagent` by default.

| Field | Required | Description |
| --- | --- | --- |
| `agent_key` | Yes | Stable key used to resolve `<agent_key>.md`. |
| `description` | Yes | Short display label for the delegated task. |
| `prompt` | Yes | Complete task sent to the child agent. |
| `run_in_background` | No | Defaults to `true`; set to `false` for a foreground one-shot run. |

## Routing behavior

1. Validate the `agent_key` syntax and resolve its Markdown file safely.
2. Parse the fenced `provider` and `model` values in their fixed order.
3. Confirm that the provider exists in `ctx.llm.listProviders()`.
4. Confirm that the model exists in `ctx.llm.listModels(provider)`.
5. Start a fresh child through the configured DSH subagent provider.

An invalid binding fails before a child is created. A missing binding file is different: the plugin omits `agentOptions`, preserving the official DSH inheritance behavior.

## Spawn vs fork provider

The plugin is provider-agnostic: the same routing, validation, and result handling
apply regardless of which DSH in-process subagent provider is configured.

| Provider | Inherited context | Use for |
| --- | --- | --- |
| `spawn` (default) | none — fresh child, zero parent context | one-shot tasks fully described by `prompt` |
| `fork` | parent's completed turns (balanced prefix up to the last `turn/end`) | tasks that build on the current conversation |

To route via the fork provider, set `provider: fork` in the plugin config (see
[Bundle configuration](#bundle-configuration)). `agentOptions` — the validated
`provider`/`model` pair from a binding file — is passed to the child identically
for both providers; only the inherited conversation seed differs.

Fork inherits conversation history only: the child still gets a fresh scope and
does not inherit the parent's tool restrictions or authority.

## DeepSeek reasoning effort

`smart-subagent` does not override `reasoningEffort`. With `provider: deepseek-official`, the official DeepSeek adapter uses its configured default; the default DSH setting is `high`.

This keeps role files focused on provider/model routing and avoids introducing a second model-capability registry. Other registered providers retain their own adapter-defined reasoning behavior.

## Bundle configuration

The bundled patch installs the following defaults:

```yaml
- id: smart-subagent
  config:
    bindingsDir: /absolute/path/to/agents
    provider: spawn
    toolName: smart_subagent
    maxDepth: 3
```

To use fork-mode routing instead, override `provider` to `fork`:

```yaml
- id: smart-subagent
  config:
    bindingsDir: /absolute/path/to/agents
    provider: fork
    toolName: smart_subagent
    maxDepth: 3
```

DSH patch overrides replace the complete `config` object, so retain every field you still need when overriding this row.

## Security guarantees

- `agent_key` accepts only ASCII letters, digits, hyphens, and underscores.
- Path traversal through `agent_key` is rejected.
- Provider/model matching is exact and case-sensitive.
- Invalid bindings never fall back to another route.
- Binding files contain no credentials.
- Disabling this plugin removes only `smart_subagent`; the official `subagent` tool is unchanged.

## Development

Requires Node.js 22 or newer.

```sh
pnpm install
pnpm test
pnpm run check
npm pack --dry-run
```

The test suite covers strict front matter parsing, path safety, model registration checks, parent-route inheritance, foreground/background child creation, and the same routing guarantees under both the `spawn` and `fork` providers.

## License

[MIT](LICENSE)
