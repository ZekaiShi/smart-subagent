# smart-subagent

[English](README.md) | 简体中文

`smart-subagent` 是一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量插件。它根据稳定的 `agent_key`，将 subagent 严格路由到 DSH 中已经注册的 provider/model 组合，无需重复保存凭据或维护第二套 provider 配置。

插件不限定代理角色。绑定文件可以代表代码审查、测试执行、资料研究、方案规划、结果验证、数据分析或任何其他专用 subagent。

## 功能特点

- 一个 `agent_key` 对应一个同名 Markdown 绑定文件。
- 严格读取由 `---` 包裹的 front matter 中的 `provider` 和 `model`。
- 创建子代理前，根据 DSH 实时模型注册表验证精确的 provider/model 组合。
- 支持前台一次性执行和可持续的后台 subagent。
- 找不到绑定文件时，保留 DSH 官方的父模型继承行为。
- 不保存 API Key、接口地址、凭据或 provider 定义。
- 子代理创建交由 DSH 官方 `spawn` provider 完成。

## 安装

从 npm 安装到 DSH profile：

```sh
dsh plugin add smart-subagent
```

从 GitHub 安装：

```sh
dsh plugin add github:ZekaiShi/smart-subagent
```

本地开发安装：

```sh
dsh plugin add ./smart-subagent
```

如需指定非默认 profile，追加 `--profile <名称>`。

## 绑定文件

文件名（不含 `.md` 扩展名）就是 `agent_key`。每个绑定文件必须以严格的四行 front matter 开头。首尾分隔符必须为 `---`，内部不能插入空行：

```md
---
provider: deepseek-official
model: deepseek-v4-flash
---

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

只有 front matter 属于路由元数据。后续 Markdown 正文不会自动加入子代理提示词；工具调用中的 `prompt` 才是发送给 subagent 的权威任务内容。

## 进化模式（Evolution）

插件会为每个 agent 自动维护 `prefercmd`（已验证命令）和 `memory`（经验教训）两个文件，通过不断积累减少重复试错，降低 token 浪费。

- **默认开启**。可通过配置 `evolution: false` 或环境变量 `SMART_SUBAGENT_EVOLUTION=false` 关闭。
- **按对话工作区隔离，不依赖启动目录**。每次调用 `smart_subagent` 时，插件读取对话的工作目录（`exec.agent.session.header.cwd`，与 DSH 终端工具解析 workdir 的字段一致），向上找到最近的、拥有 `agents/` 目录的文件夹作为项目工作区；该目录即绑定目录，进化文件位于
  `<项目>/.dsh/smart-subagent/evolution/<agent_key>/prefercmd.md` 和
  `memory.md`——不同项目各自独立绑定与进化、互不污染，与 DSH 进程从哪启动无关。
  当对话没有会话 cwd、或其工作区没有 `agents/` 文件夹时，回退到 `bindingsDir` / `SMART_SUBAGENT_EVOLUTION_DIR` / 进程工作目录。
  文件**不会出现在你项目的 `agents/` 文件夹里**。`<项目>/.dsh/` 目录也是**懒创建**的：只有某个 subagent 真正运行并回报了进化内容（或你在设置卡片里手动保存）时才会落盘，工作区扫描/项目检测是纯只读的，绝不会在你硬盘上多出目录。
- 每次前台运行时，插件会把这两个文件作为有界上下文块注入子代理提示词（上限约 2000 token），让 subagent 直接从已验证的命令出发，不用重新摸索。
- 前台运行结束后，插件会在最终输出中查找 `[[EVOLUTION]]` 块并合并新记录：

  ```markdown
  [[EVOLUTION]]
  prefercmd:
  - pnpm test  # 更快的测试运行器
  memory:
  - CI 环境不要用 --force
  [[/EVOLUTION]]
  ```

- 自动去重，条目有上限（prefercmd 40 条、memory 25 条），超限丢最旧——注入 token 成本恒定。
- 后台运行不记录（拿不到最终输出）。

可通过 `smart-subagent/evolution` 的 `detectAgents(bindingsDir, templatesDir)` 程序化列出所有可用 agent key。

## 设置卡片

web profile 下，设置 → 插件会出现一张 **smart-subagent** 卡片：

- **按项目分组展示 subagents**。扫描来源是该 profile 注册的所有**工作区**（`ctx.workspaceRegistry`，即你在 web 界面里看到的那些工作区）：每个工作区检查自身与其**一级子目录**是否含 `agents/` 文件夹，找到即为项目。零配置、跨机器通用--换台电脑、换批工作区，卡片自动跟上；没有则明确显示"未发现"。内置模板始终单独成组展示。
  仅当 profile 没有注册任何工作区时，才退回 `SMART_SUBAGENT_PROJECTS_DIR` / 卡片里填写的备用目录。
- **显示每个 agent 当前路由模型**（front matter 的 provider · model），项目绑定可用**下拉切换模型**——改动直接改写该 agent `.md` 文件的 `model:` 行（与手改同一文件）。
  内置模板 agent 只读显示。
- 编辑每个 agent 的隐藏 `prefercmd.md` / `memory.md`（按项目的进化文件），并切换全局进化开关。

## 绑定目录

在启动 DSH 的同一进程环境中设置绑定文件目录。相对路径从 DSH 启动工作目录解析。

PowerShell：

```powershell
$env:SMART_SUBAGENT_BINDINGS_DIR = 'C:\path\to\agents'
dsh   # 或你平常启动 DSH 的方式（dsh web、桌面客户端等）
```

Bash：

```sh
SMART_SUBAGENT_BINDINGS_DIR=/absolute/path/to/agents dsh
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
2. 按固定顺序解析 front matter 中的 `provider` 和 `model`。
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

测试覆盖严格 front matter 解析、路径安全、注册模型验证、父模型继承以及前后台子代理创建。

## 许可证

[MIT](LICENSE)
