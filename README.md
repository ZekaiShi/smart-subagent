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
dsh plugin --profile web add smart-subagent
```

Install directly from GitHub:

```sh
dsh plugin --profile web add github:ZekaiShi/smart-subagent
```

For local development:

```sh
dsh plugin --profile web add ./smart-subagent
```

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

## Binding directory

Set the binding directory before starting DSH. Relative paths resolve from the DSH launch working directory.

PowerShell:

```powershell
$env:SMART_SUBAGENT_BINDINGS_DIR = 'D:\agents'
dsh --profile web
```

Bash:

```sh
SMART_SUBAGENT_BINDINGS_DIR=/absolute/path/to/agents dsh --profile web
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

The test suite covers strict front matter parsing, path safety, model registration checks, parent-route inheritance, and foreground/background child creation.

## License

[MIT](LICENSE)
