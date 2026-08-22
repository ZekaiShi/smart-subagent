# dsh-agent-model-binding

一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量插件：根据稳定的 `agent_key`，将新建 subagent 严格路由到 DSH 中已经注册的 `provider/model` 组合。

本插件主要面向 DeepSeek 官方模型。它不保存 API Key、接口地址或 provider 定义，只读取角色 Markdown 文件前两行的路由信息，并将子代理创建交给 DSH 官方 `spawn` provider。

## 功能特点

- 一个 `agent_key` 对应一个同名 Markdown 文件。
- 严格读取文件的前两个物理行：`provider` 和 `model`。
- 启动前检查 provider 及其所属 model 是否已经在 DSH 注册。
- 无效配置立即报错，不会静默切换到其他模型。
- 找不到对应文件时，不传递 `agentOptions`，保持 DSH 官方的父代理模型继承行为。
- 同时支持前台一次性 subagent 和可持续的后台 subagent。

## DeepSeek 推理强度

第一版不单独配置 `reasoningEffort`。当使用 `provider: deepseek-official` 时，由 DeepSeek 官方适配器采用默认的 `high` 推理强度。

因此角色文件只需要指定 provider 和 model，不需要增加第三行推理强度配置。

## 安装

从 GitHub 安装到 DSH 的 web profile：

```sh
dsh plugin --profile web add github:ZekaiShi/dsh-agent-model-binding
```

本地开发安装：

```sh
dsh plugin --profile web add ./dsh-agent-model-binding
```

## 角色文件

文件名（不含 `.md` 扩展名）就是 `agent_key`。前两行必须严格采用以下格式，中间不能插入空行：

```md
provider: deepseek-official
model: deepseek-v4-flash

# 章节撰写代理
这里可以保存供其他系统或用户阅读的角色说明。
```

如果文件名为 `chapter-writer.md`，调用工具时传入：

```json
{
  "agent_key": "chapter-writer",
  "description": "撰写章节",
  "prompt": "请根据给定提纲撰写本章。"
}
```

Markdown 中第一、二行之后的正文不会自动加入 subagent prompt；真正发送给子代理的内容以工具调用中的 `prompt` 为准。

## 配置绑定目录

启动 DSH 前设置角色文件目录。相对路径从 DSH 的启动工作目录解析。

PowerShell：

```powershell
$env:DSH_AGENT_BINDINGS_DIR = 'D:\agents'
dsh --profile web
```

Bash：

```sh
DSH_AGENT_BINDINGS_DIR=/absolute/path/to/agents dsh --profile web
```

插件默认注册工具名 `agent_subagent`。后台运行是默认行为；传入 `run_in_background: false` 可等待一次性执行结果。

## Bundle 配置

插件安装的默认配置如下：

```yaml
- id: agent-model-binding
  config:
    bindingsDir: /absolute/path/to/agents
    provider: spawn
    toolName: agent_subagent
    maxDepth: 3
```

DSH patch 覆盖会替换完整的 `config`，自行覆盖时请保留仍然需要的字段。

## 安全与行为约束

- `agent_key` 仅允许 ASCII 字母、数字、连字符和下划线，不能用于目录穿越。
- provider/model 匹配区分大小写。
- provider 必须存在于 `ctx.llm.listProviders()`。
- model 必须存在于对应 provider 的 `ctx.llm.listModels(provider)`。
- 无效绑定不会回退到其他 provider 或 model。
- 缺少绑定文件时，子代理沿用 DSH 官方继承语义。
- 禁用或卸载本插件只会移除 `agent_subagent`，不会修改官方 `subagent` 工具。

## 开发与验证

要求 Node.js 22 或更高版本。

```sh
pnpm install
pnpm test
pnpm run check
npm pack --dry-run
```

当前测试覆盖严格头部解析、路径安全、注册模型验证、父模型继承以及前后台创建路径。

## 许可证

[MIT](LICENSE)
