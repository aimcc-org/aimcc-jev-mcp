# codex-jev-mcp

面向 Coding Agent 的模型无关决策内核 MCP。它把高层任务编译为小而独立的语义判断，由 Jev 等 System-One 模型生成 typed signals，再由确定性策略决定接受、拒绝、补证据或升级 System-2。

> 核心原则：Jev 是语义传感器，不是最终决策者。

## 当前进度

当前版本已经打通基础设施和六条完整 Tool 链路：

- MCP stdio Server；
- `SystemOneProvider` 抽象；
- TypeSafe、OpenRouter Decisions API、Jev-compatible 三种 Provider；
- 整次请求截止时间、有限重试、响应大小上限和密钥脱敏；
- Choice、Noul、Score 原子问题与 fail-closed 响应校验；
- 约 24k token 的 Evidence 软预算和确定性 Context Reducer；
- `verify`、`rank_candidates`、`select_capability`、`assess_task`、`screen_content`、`completion_gate` MCP Tool；
- 确定性验证策略、Decision Envelope 和 Decision Snapshot 哈希；
- 单元测试、Provider 本地集成测试与 MCP stdio 冒烟测试。

## 运行要求

- Node.js 22（见 `.nvmrc`）
- pnpm 11.17.0
- 可选的 Jev Provider 凭据；未配置时自动使用本地 OpenJev

```bash
nvm use
pnpm install
pnpm run build
cp .env.example .env
```

配置环境变量后启动：

```bash
pnpm start
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "decision-kernel": {
      "command": "node",
      "args": ["/absolute/path/to/codex-jev-mcp/dist/index.js"],
      "env": {
        "JEV_PROVIDER": "typesafe",
        "JEV_MODEL": "jev-1.13",
        "TYPESAFE_API_KEY": "${TYPESAFE_API_KEY}"
      }
    }
  }
}
```

生产环境应固定精确模型版本，并为该模型维护独立阈值配置，不建议使用 `latest`。

## Provider 配置

### TypeSafe

```bash
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=...
JEV_MODEL=jev-1.13
```

### OpenRouter

```bash
JEV_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
JEV_MODEL=jev-1.13
```

### Jev-compatible endpoint

```bash
JEV_PROVIDER=compatible
JEV_API_KEY=...
JEV_API_BASE_URL=https://example.com/v1/decisions
JEV_MODEL=jev-1.13
```

### 本地 OpenJev

```bash
JEV_PROVIDER=local
JEV_LOCAL_MODEL_REPO=onnx-community/open-jev-deberta-v3-large-ONNX
JEV_LOCAL_DTYPE=q4
```

`JEV_PROVIDER=auto` 会按 TypeSafe、OpenRouter、Compatible 的顺序选择第一个已完整配置的 Provider；没有任何 Key 时，自动预加载 [`com-kotobalabs/open-jev-deberta-v3-large`](https://huggingface.co/com-kotobalabs/open-jev-deberta-v3-large) 的 Transformers.js ONNX 转换。默认 `q4` 权重约 0.48 GB，首次启动需要联网下载并写入 Hugging Face 缓存，MCP 握手不会等待下载完成，但第一次 Tool 调用会等待模型就绪。

本地模型只有 512 token 上下文、仅以英文数据训练，并且仓库的验证问题属于模型卡所述的 OOD 场景。它适合作为无 Key 时的可用性兜底，生产使用前应单独评测和校准阈值。可通过 `JEV_PROVIDER=local` 强制启用，也可用 `JEV_LOCAL_DTYPE=q4f16|fp16|fp32` 调整权重格式。

## `verify`

`verify` 只把主张和证据提交给 Jev。任务描述、用户自述和未执行的检查不会自动成为证据。

请求示例：

```json
{
  "claims": [
    {
      "id": "build_passed",
      "text": "项目构建成功",
      "blocking": true
    }
  ],
  "evidence": [
    {
      "id": "build_log",
      "type": "build",
      "text": "Build completed successfully",
      "provenance": {
        "command": "pnpm run build",
        "generatedBy": "tool"
      }
    }
  ]
}
```

最终动作由确定性策略产生：

| 条件 | 动作 |
|---|---|
| 阻断主张全部得到支持 | `accept` |
| 阻断主张被反驳 | `reject` |
| 阻断主张未被证据覆盖 | `collect_evidence` |
| 语义响应非法或置信度不足 | `system_two_review` |
| Evidence 因预算被截断 | `review` |

策略阈值位于 [`config/policies.json`](config/policies.json)，不会散落在 Tool 实现中。

## Tool 一览

| Tool | 用途 | 主要动作 |
|---|---|---|
| `verify` | 判断证据是否支持、反驳或未覆盖主张 | `accept`、`reject`、`collect_evidence` |
| `rank_candidates` | 按目标排序两个及以上候选项 | `continue`、`system_two_review` |
| `select_capability` | 先判断能力相关性，再选择主能力 | `continue`、`ask_user`、`system_two_review` |
| `assess_task` | 评估复杂度、风险和歧义 | `continue`、`ask_user`、`system_two_review` |
| `screen_content` | 用调用方提供的规则筛查内容 | `accept`、`review`、`reject` |
| `completion_gate` | 联合需求证据和检查状态判断能否结束任务 | `accept`、`reject`、`collect_evidence`、`run_checks` |

这些 Tool 都只返回建议动作，不会替调用方执行能力、运行检查或结束任务。例如，代理可以在开始任务前调用 `assess_task` 和 `select_capability`，执行后将真实 diff、测试输出交给 `completion_gate`：

```json
{
  "requirements": [
    { "id": "feature", "text": "新增的 Tool 已通过 MCP 暴露", "blocking": true }
  ],
  "evidence": [
    { "id": "diff", "type": "diff", "text": "server.registerTool(...)" }
  ],
  "checks": [
    { "id": "tests", "status": "passed", "blocking": true, "output": "24 tests passed" }
  ]
}
```

`completion_gate` 对检查状态采用确定性优先级：阻断检查失败会直接 `reject`，阻断检查尚未运行会返回 `run_checks`；只有检查条件满足后，需求证据判断才可能放行。

## Playground 预览

Playground 不经过 Codex、Claude 等 AI 客户端，直接调用与 MCP 相同的 Schema、Runtime、Provider 和 Policy：

### 启动预览

```bash
nvm use
pnpm install
pnpm playground
```

启动成功后访问 [http://127.0.0.1:4317](http://127.0.0.1:4317)。不要直接通过 `file://` 打开 `playground/index.html`，否则页面无法请求本地 API。

`pnpm playground` 会先构建 TypeScript，再启动预览服务。如果已经执行过构建，也可以直接启动产物：

```bash
pnpm run build
node dist/playground.js
```

使用其他端口：

```bash
PLAYGROUND_PORT=4320 pnpm playground
```

页面包含全部六个 Tool 和典型分支预设，可以编辑原始 JSON，并查看完整 `DecisionEnvelope`、signals、Provider、模型与延迟。

如果没有配置云端 Key，页面会和 MCP 一样自动使用本地 OpenJev；首次语义 Tool 请求可能需要等待模型下载。`completion_gate` 的“检查失败”和“检查未运行”预设是纯确定性路径，不调用模型。端口可通过 `PLAYGROUND_PORT` 修改，默认只监听本机 `127.0.0.1`。

## 开发

```bash
pnpm run typecheck
pnpm test
```

当前测试不需要真实 API Key。Provider 测试会启动本地 HTTP Server，验证协议规范化、错误处理和密钥脱敏。

详细边界和模块关系见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 许可证

MIT
