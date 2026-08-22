# smart-subagent

[English](README.md) | 简体中文

`smart-subagent` 是一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量插件。它根据稳定的 `agent_key`，将 subagent 严格路由到 DSH 中已经注册的 provider/model 组合，无需重复保存凭据或维护第二套 provider 配置。

插件不限定代理角色。绑定文件可以代表代码审查、测试执行、资料研究、方案规划、结果验证、数据分析或任何其他专用 subagent。

## 功能特点

- 一个 `agent_key` 对应一个同名 Markdown 绑定文件。
- 严格读取文件前两个物理行中的 `provider` 和 `model`。
- 创建子代理前，根据 DSH 实时模型注册表验证精确的 provider/model 组合。
- 支持前台一次性执行和可持续的后台 subagent。
- 找不到绑定文件时，保留 DSH 官方的父模型继承行为。
- 不保存 API Key、接口地址、凭据或 provider 定义。
- 子代理创建交由 DSH 官方 `spawn` provider 完成。

## 安装

从 npm 安装到 DSH profile：

```sh
dsh plugin --profile web add smart-subagent
```

从 GitHub 安装：

```sh
dsh plugin --profile web add github:ZekaiShi/smart-subagent
```

本地开发安装：

```sh
dsh plugin --profile web add ./smart-subagent
```

## 绑定文件

文件名（不含 `.md` 扩展名）就是 `agent_key`。前两个物理行只能包含已注册的 provider 和 model 标识：

```md
provider: deepseek-official
model: deepseek-v4-flash

# 代码审查代理
这里可以保存供人员或外部工具阅读的补充说明。
```

如果文件名为 `code-reviewer.md`，调用工具时传入 `agent_key: "code-reviewer"`：

```json
{
  "agent_key": "code-reviewer",
  "description": "审查实现",
  "prompt": "检查给定改动，并报告正确性、安全性和测试覆盖问题。",
  "run_in_background": true
}
```

只有前两行属于路由元数据。后续 Markdown 正文不会自动加入子代理提示词；工具调用中的 `prompt` 才是发送给 subagent 的权威任务内容。

## 绑定目录

启动 DSH 前设置绑定文件目录。相对路径从 DSH 启动工作目录解析。

PowerShell：

```powershell
$env:SMART_SUBAGENT_BINDINGS_DIR = 'D:\agents'
dsh --profile web
```

Bash：

```sh
SMART_SUBAGENT_BINDINGS_DIR=/absolute/path/to/agents dsh --profile web
```

插件仍将 `DSH_AGENT_BINDINGS_DIR` 作为兼容回退变量。

## 工具接口

插件默认注册 `smart_subagent`。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `agent_key` | 是 | 用于解析 `<agent_key>.md` 的稳定键。 |
| `description` | 是 | 委派任务的简短显示名称。 |
| `prompt` | 是 | 发送给子代理的完整任务。 |
| `run_in_background` | 否 | 默认为 `true`；设为 `false` 时执行前台一次性任务。 |

## 路由流程

1. 验证 `agent_key` 格式并安全解析 Markdown 文件路径。
2. 解析第一行 `provider` 和第二行 `model`。
3. 确认 provider 存在于 `ctx.llm.listProviders()`。
4. 确认 model 存在于 `ctx.llm.listModels(provider)`。
5. 通过配置的 DSH subagent provider 创建全新子代理。

无效绑定会在创建子代理前报错。缺少绑定文件则采用不同语义：插件不传递 `agentOptions`，保留 DSH 官方继承行为。

## DeepSeek 推理强度

`smart-subagent` 不覆盖 `reasoningEffort`。使用 `provider: deepseek-official` 时，由 DeepSeek 官方适配器采用其配置的默认值；DSH 默认设置为 `high`。

这样可以让绑定文件只负责 provider/model 路由，不引入第二套模型能力注册表。其他已注册 provider 继续使用各自适配器定义的推理行为。

## Bundle 配置

插件默认安装以下配置：

```yaml
- id: smart-subagent
  config:
    bindingsDir: /absolute/path/to/agents
    provider: spawn
    toolName: smart_subagent
    maxDepth: 3
```

DSH patch 覆盖会替换完整 `config`，自行覆盖时请保留仍需使用的字段。

## 安全保证

- `agent_key` 仅允许 ASCII 字母、数字、连字符和下划线。
- 拒绝通过 `agent_key` 进行目录穿越。
- provider/model 严格匹配并区分大小写。
- 无效绑定不会回退到其他模型路由。
- 绑定文件不包含任何凭据。
- 禁用插件只会移除 `smart_subagent`，不会修改官方 `subagent` 工具。

## 开发与验证

要求 Node.js 22 或更高版本。

```sh
pnpm install
pnpm test
pnpm run check
npm pack --dry-run
```

测试覆盖严格头部解析、路径安全、注册模型验证、父模型继承以及前后台子代理创建。

## 许可证

[MIT](LICENSE)
