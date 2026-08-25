# evo-subagent

![evo-subagent — Route. Remember. Evolve.](assets/Evo-subagent-preview.png)

[English](README.md) | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/evo-subagent.svg)](https://www.npmjs.com/package/evo-subagent)
[![license](https://img.shields.io/npm/l/evo-subagent.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

`evo-subagent` 是一个面向 DeepSeek Harness 的 Subagent 路由与项目级进化插件。

它把稳定的 Agent 角色映射到已经注册的 provider/model，为每个角色记录已验证命令与经验，并隔离不同项目的 Agent 知识。

## 功能

- 通过同名 Markdown 绑定文件路由每个 `agent_key`。
- 创建子 Agent 前严格验证 provider/model 组合。
- 自动维护每个 Agent 的 `prefercmd.md` 与 `memory.md`。
- 按项目工作区隔离绑定和进化数据。
- 支持全新上下文的 `spawn` 和继承对话上下文的 `fork`。
- 没有绑定文件时保留 DSH 原生模型继承行为。
- 不保存 API Key、端点、凭据或 provider 定义。

## 安装

```sh
dsh plugin add evo-subagent
```

## Agent 绑定

在项目中创建 `agents/` 目录，每个角色对应一个 Markdown 文件。文件名即 `agent_key`。

```text
project/
├─ agents/
│  ├─ code-reviewer.md
│  └─ researcher.md
└─ .evo_subagent/
   └─ evolution/
```

每个绑定文件以严格的 front matter 开头：

```md
---
provider: deepseek-official
model: deepseek-v4-flash
---

# Code reviewer
下方可以添加可选的角色说明。
```

provider 和 model 必须已经注册，匹配区分大小写。

使用对应的 key 调用插件工具：

```json
{
  "agent_key": "code-reviewer",
  "description": "审查实现",
  "prompt": "报告正确性、安全性和测试覆盖问题。",
  "run_in_background": false
}
```

## 内置角色

插件包含三个模板：

| `agent_key` | 角色 |
| --- | --- |
| `code-reviewer` | 按严重程度输出代码审查结果 |
| `researcher` | 基于证据的研究与核查 |
| `wps-worker` | 办公文档制作 |

项目中存在同名绑定时，项目绑定优先于内置模板。

## 进化

每个项目的角色知识保存在：

```text
.evo_subagent/evolution/<agent_key>/prefercmd.md
.evo_subagent/evolution/<agent_key>/memory.md
```

- `prefercmd.md` 记录已经验证可用的命令。
- `memory.md` 记录可复用经验和需要避免的失败。

前台 Subagent 会接收一段有长度限制的知识上下文，并可通过以下格式返回新内容：

```md
[[EVOLUTION]]
prefercmd:
- pnpm test
memory:
- 不要在 CI 中使用 --force。
[[/EVOLUTION]]
```

条目会去重并限制数量。使用 `!` 前缀标记最高优先级，使用 `?` 标记可在上下文紧张时压缩的条目。

旧 `.smart_subagent/evolution` 数据仍可只读回退，并会在下次保存时复制到新目录。

## 工作区管理

插件设置卡片按项目分组 Agent，并支持：

- 展开或折叠工作区 Agent 列表；
- 编辑自定义绑定的已注册 provider/model 路由；
- 将内置角色模板复制到指定工作区；
- 绑定一个工作区根目录的 `AGENTS.md` 作为 Main agent；
- 查看和编辑每个 Agent 的进化文件。

Main agent 的进化数据位于 `.evo_subagent/evolution/main/`。绑定或解绑只会修改 `AGENTS.md` 中由插件管理的指令区块。

## 工具字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `agent_key` | 是 | 不含 `.md` 的绑定文件名。 |
| `description` | 是 | 简短任务名称。 |
| `prompt` | 是 | 发送给子 Agent 的完整任务。 |
| `run_in_background` | 否 | 默认 `true`；设为 `false` 时可收集进化输出。 |

## 路由流程

1. 安全解析 `<agent_key>.md`。
2. 读取 fenced front matter 中的 `provider` 和 `model`。
3. 在实时模型注册表中验证两个值。
4. 通过所选 `spawn` 或 `fork` provider 创建子 Agent。

无效绑定会在创建子 Agent 前失败。绑定缺失且没有同名内置模板时，保留 DSH 原生继承行为。

## 开发

需要 Node.js 22 或更高版本。

```sh
npm test
npm run check
npm pack --dry-run
```

## 许可证

[MIT](LICENSE)
