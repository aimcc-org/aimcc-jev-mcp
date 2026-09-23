import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KernelError, errorMessage } from "../core/errors.js";
import type { DecisionEnvelope } from "../core/types.js";
import type { PolicyConfig } from "../policy/config.js";
import { PrimitiveRuntime } from "../runtime/primitive-runtime.js";
import { executeAssessTask } from "../tools/assess-task/execute.js";
import { assessTaskInputSchema } from "../tools/assess-task/schema.js";
import { executeCompletionGate } from "../tools/completion-gate/execute.js";
import { completionGateInputSchema } from "../tools/completion-gate/schema.js";
import { executeRankCandidates } from "../tools/rank-candidates/execute.js";
import { rankCandidatesInputSchema } from "../tools/rank-candidates/schema.js";
import { executeScreenContent } from "../tools/screen-content/execute.js";
import { screenContentInputSchema } from "../tools/screen-content/schema.js";
import { executeSelectCapability } from "../tools/select-capability/execute.js";
import { selectCapabilityInputSchema } from "../tools/select-capability/schema.js";
import { executeVerify } from "../tools/verify/execute.js";
import { verifyInputSchema } from "../tools/verify/schema.js";

const VERSION = "0.1.0";

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerError(
  error: unknown,
  decisionSpec: string,
  policyProfile: string,
): DecisionEnvelope<{ message: string }> {
  const code = error instanceof KernelError ? error.code : "PROVIDER_ERROR";
  return {
    status: "provider_error",
    decision: { action: "escalate", reasonCodes: [code] },
    data: { message: errorMessage(error) },
    signals: [],
    meta: {
      requestId: `req_${randomUUID()}`,
      snapshotId: "unavailable",
      decisionSpec,
      model: "unknown",
      provider: "unknown",
      policyProfile,
      latencyMs: 0,
      cacheHit: false,
      contextTruncated: false,
    },
  };
}

export function createMcpServer(runtime: PrimitiveRuntime, policies: PolicyConfig): McpServer {
  const server = new McpServer({ name: "codex-jev-mcp", version: VERSION });

  server.registerTool(
    "verify",
    {
      title: "验证主张与证据",
      description:
        "只根据给定证据判断每条主张是得到支持、被反驳还是未被处理。返回 typed signals，并由确定性策略决定接受、拒绝、补证据或升级 System-2。",
      inputSchema: verifyInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeVerify(runtime, input, {
            signal: extra.signal,
            policy: policies.verify,
          }),
        );
      } catch (error) {
        return textResult(providerError(error, "verify@1", policies.verify.profile));
      }
    },
  );

  server.registerTool(
    "rank_candidates",
    {
      title: "候选项排序",
      description: "按目标对候选项排序；置信度或领先幅度不足时升级复核。",
      inputSchema: rankCandidatesInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeRankCandidates(runtime, input, {
            signal: extra.signal,
            policy: policies.rankCandidates,
          }),
        );
      } catch (error) {
        return textResult(
          providerError(error, "rank_candidates@1", policies.rankCandidates.profile),
        );
      }
    },
  );

  server.registerTool(
    "select_capability",
    {
      title: "选择执行能力",
      description: "先过滤与任务相关且可用的能力，再选择最合适的主能力。",
      inputSchema: selectCapabilityInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeSelectCapability(runtime, input, {
            signal: extra.signal,
            policy: policies.selectCapability,
          }),
        );
      } catch (error) {
        return textResult(
          providerError(error, "select_capability@1", policies.selectCapability.profile),
        );
      }
    },
  );

  server.registerTool(
    "assess_task",
    {
      title: "评估任务",
      description: "评估任务复杂度、风险和歧义，决定继续、询问用户或升级深度推理。",
      inputSchema: assessTaskInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeAssessTask(runtime, input, {
            signal: extra.signal,
            policy: policies.assessTask,
          }),
        );
      } catch (error) {
        return textResult(providerError(error, "assess_task@1", policies.assessTask.profile));
      }
    },
  );

  server.registerTool(
    "screen_content",
    {
      title: "内容规则筛查",
      description: "根据调用方提供的规则筛查内容，并确定放行、复核或拒绝。",
      inputSchema: screenContentInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeScreenContent(runtime, input, {
            signal: extra.signal,
            policy: policies.screenContent,
          }),
        );
      } catch (error) {
        return textResult(
          providerError(error, "screen_content@1", policies.screenContent.profile),
        );
      }
    },
  );

  server.registerTool(
    "completion_gate",
    {
      title: "任务完成门禁",
      description: "验证需求证据及确定性检查状态，决定任务能否完成、需补证据或需运行检查。",
      inputSchema: completionGateInputSchema,
    },
    async (input, extra) => {
      try {
        return textResult(
          await executeCompletionGate(runtime, input, {
            signal: extra.signal,
            policy: policies.completionGate,
          }),
        );
      } catch (error) {
        return textResult(
          providerError(error, "completion_gate@1", policies.completionGate.profile),
        );
      }
    },
  );

  return server;
}
