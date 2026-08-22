# dsh-agent-model-binding

Route fresh DeepSeek Harness subagents by a stable `agent_key` to provider/model pairs already registered in DSH. The plugin stores no API keys, endpoints, or provider definitions and delegates child creation to the official `spawn` provider.

## Role files

The filename stem is the key. The first two physical lines are strict, machine-only routing metadata:

```md
provider: deepseek-official
model: deepseek-v4

# Chapter writer
The remaining document is yours. This plugin does not add it to the child prompt.
```

For the example above, call the tool with `agent_key: "chapter-writer"` when the file is named `chapter-writer.md`.

The provider must exist in `ctx.llm.listProviders()` and the model must appear in `ctx.llm.listModels(provider)`. An invalid binding fails loudly. A missing file is not an invalid binding: the plugin omits `agentOptions`, preserving DSH's official parent-model inheritance.

## Install

```sh
dsh plugin --profile web add dsh-agent-model-binding
```

For local development:

```sh
dsh plugin --profile web add ./dsh-agent-model-binding
```

Set the binding directory before starting DSH. Relative paths resolve from the launching working directory:

```sh
DSH_AGENT_BINDINGS_DIR=/absolute/path/to/agents dsh --profile web
```

The bundle registers `agent_subagent` and delegates both foreground and continuable-background starts to the existing `spawn` provider. Background is the default; pass `run_in_background: false` to wait for the one-shot result.

## Bundle configuration

Users may override the inserted row in their profile patch:

```yaml
- id: agent-model-binding
  config:
    bindingsDir: /absolute/path/to/agents
    provider: spawn
    toolName: agent_subagent
    maxDepth: 3
```

DSH patch overrides replace the complete `config`, so keep every field you still need.

## Security and behavior

- `agent_key` accepts only ASCII letters, digits, hyphens, and underscores and cannot traverse directories.
- Route matching is exact and case-sensitive.
- The plugin never falls back from an invalid binding to another model.
- A missing binding inherits the parent's provider/model exactly as official fresh spawn does.
- Role Markdown content is not prompt content; only the caller's `prompt` reaches the child.
- Disabling or removing the bundle removes only `agent_subagent`; the official `subagent` tool remains unchanged.

## Development

```sh
npm test
npm pack --dry-run
```

This repository should use the GitHub topic `dsh-plugin` for official ecosystem discovery.
