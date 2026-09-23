import test from "node:test";
import assert from "node:assert/strict";
import { PrimitiveRuntime } from "../dist/runtime/primitive-runtime.js";
import { executeAssessTask } from "../dist/tools/assess-task/execute.js";
import { executeCompletionGate } from "../dist/tools/completion-gate/execute.js";
import { executeRankCandidates } from "../dist/tools/rank-candidates/execute.js";
import { executeScreenContent } from "../dist/tools/screen-content/execute.js";
import { executeSelectCapability } from "../dist/tools/select-capability/execute.js";

class ScriptedProvider {
  constructor(script = {}) {
    this.script = script;
  }

  async evaluate(request) {
    const answers = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const keys = Object.keys(question.criteria);
        const selected = this.script.choices?.[id] ?? keys[0];
        const winnerProbability = this.script.choiceProbability?.[id] ?? 0.9;
        answers[id] = {
          type: "choice",
          choice: selected,
          probabilities: Object.fromEntries(
            keys.map((key) => [
              key,
              key === selected
                ? winnerProbability
                : (1 - winnerProbability) / (keys.length - 1),
            ]),
          ),
          confidence: this.script.confidence?.[id] ?? 0.9,
        };
      } else if (question.type === "noul") {
        answers[id] = { type: "noul", noul: this.script.nouls?.[id] ?? 0 };
      } else {
        answers[id] = {
          type: "score",
          score: this.script.scores?.[id] ?? 0,
          confidence: this.script.confidence?.[id] ?? 0.9,
        };
      }
    }
    return {
      answers,
      usage: { inputTokens: 50, outputTokens: 5 },
      provider: "compatible",
      model: request.model,
    };
  }
}

function runtime(script) {
  return new PrimitiveRuntime(new ScriptedProvider(script), "jev-test");
}

test("rank_candidates 返回完整排序和首选项", async () => {
  const result = await executeRankCandidates(
    runtime({ choices: { ranking: "b" }, choiceProbability: { ranking: 0.8 } }),
    {
      objective: "选择更稳妥的方案",
      candidates: [
        { id: "a", description: "方案 A" },
        { id: "b", description: "方案 B" },
      ],
    },
    { policy: { minimumConfidence: 0.6, minimumMargin: 0.1, profile: "test" } },
  );
  assert.equal(result.decision.action, "continue");
  assert.equal(result.data.selectedId, "b");
  assert.deepEqual(result.data.ranking.map((item) => item.id), ["b", "a"]);
});

test("select_capability 先筛选相关性再选择主能力", async () => {
  const result = await executeSelectCapability(
    runtime({
      nouls: { "relevance.search": 0.9, "relevance.browser": 0.8 },
      choices: { selection: "browser" },
    }),
    {
      task: "打开网页并检查内容",
      capabilities: [
        { id: "search", description: "搜索资料", available: true },
        { id: "browser", description: "操作网页", available: true },
      ],
    },
    {
      policy: {
        minimumRelevance: 0.5,
        minimumConfidence: 0.6,
        minimumMargin: 0.1,
        profile: "test",
      },
    },
  );
  assert.equal(result.decision.action, "continue");
  assert.equal(result.data.selectedId, "browser");
  assert.equal(result.signals.length, 3);
});

test("assess_task 对高歧义任务要求询问用户", async () => {
  const result = await executeAssessTask(
    runtime({ scores: { complexity: 1, risk: 1, ambiguity: 2 } }),
    { task: "把它处理一下", constraints: [] },
    {
      policy: {
        minimumConfidence: 0.6,
        maximumAutoComplexity: 1.5,
        maximumAutoRisk: 1.5,
        maximumAutoAmbiguity: 1,
        profile: "test",
      },
    },
  );
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.decision.action, "ask_user");
});

test("screen_content 命中阻断规则时拒绝", async () => {
  const result = await executeScreenContent(
    runtime({ nouls: { "rule.secret": 0.92 } }),
    {
      content: "包含待检测内容",
      rules: [{ id: "secret", description: "包含敏感凭据", action: "block" }],
    },
    { policy: { reviewProbability: 0.5, blockProbability: 0.8, profile: "test" } },
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.decision.action, "reject");
});

const completionInput = {
  requirements: [{ id: "done", text: "功能已经完成", blocking: true }],
  evidence: [{ id: "diff", type: "diff", text: "实现了功能" }],
  checks: [{ id: "tests", status: "passed", blocking: true }],
};

test("completion_gate 在需求受支持且检查通过时放行", async () => {
  const result = await executeCompletionGate(
    runtime({ choices: { relation_done: "supported" } }),
    completionInput,
    { policy: { minimumConfidence: 0.8, profile: "test" } },
  );
  assert.equal(result.decision.action, "accept");
  assert.equal(result.meta.decisionSpec, "completion_gate@1");
});

test("completion_gate 的阻断检查失败优先于语义验证", async () => {
  const result = await executeCompletionGate(
    runtime({ choices: { relation_done: "supported" } }),
    {
      ...completionInput,
      checks: [{ id: "tests", status: "failed", blocking: true }],
    },
    { policy: { minimumConfidence: 0.8, profile: "test" } },
  );
  assert.equal(result.decision.action, "reject");
  assert.deepEqual(result.decision.reasonCodes, ["BLOCKING_CHECK_FAILED"]);
  assert.equal(result.meta.model, "not-called");
  assert.deepEqual(result.signals, []);
});

test("completion_gate 要求运行尚未执行的阻断检查", async () => {
  const result = await executeCompletionGate(
    runtime({ choices: { relation_done: "supported" } }),
    {
      ...completionInput,
      checks: [{ id: "tests", status: "not_run", blocking: true }],
    },
    { policy: { minimumConfidence: 0.8, profile: "test" } },
  );
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.decision.action, "run_checks");
  assert.equal(result.meta.model, "not-called");
});
