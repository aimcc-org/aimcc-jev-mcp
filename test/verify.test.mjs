import test from "node:test";
import assert from "node:assert/strict";
import { PrimitiveRuntime } from "../dist/runtime/primitive-runtime.js";
import { executeVerify } from "../dist/tools/verify/execute.js";

class FakeProvider {
  constructor(relation, confidence = 0.9) {
    this.relation = relation;
    this.confidence = confidence;
  }

  async evaluate(request) {
    const answers = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (id.startsWith("relation_")) {
        const probabilities = {
          supported: this.relation === "supported" ? 0.9 : 0.05,
          contradicted: this.relation === "contradicted" ? 0.9 : 0.05,
          not_addressed: this.relation === "not_addressed" ? 0.9 : 0.05,
        };
        answers[id] = {
          type: "choice",
          choice: this.relation,
          probabilities,
          confidence: this.confidence,
        };
      } else {
        const keys = Object.keys(question.criteria);
        const selected = keys[0];
        answers[id] = {
          type: "choice",
          choice: selected,
          probabilities: Object.fromEntries(
            keys.map((key) => [key, key === selected ? 0.9 : 0.1 / (keys.length - 1)]),
          ),
          confidence: 0.9,
        };
      }
    }
    return {
      answers,
      usage: { inputTokens: 100, outputTokens: 10 },
      provider: "compatible",
      model: request.model,
    };
  }
}

const input = {
  claims: [{ id: "claim_a", text: "构建成功", blocking: true }],
  evidence: [{ id: "build_log", type: "build", text: "Build completed successfully" }],
};
const options = { policy: { minimumConfidence: 0.8, profile: "verify-test@1" } };

test("verify 在阻断主张得到支持时返回 accept", async () => {
  const runtime = new PrimitiveRuntime(new FakeProvider("supported"), "jev-test");
  const result = await executeVerify(runtime, input, options);
  assert.equal(result.status, "resolved");
  assert.equal(result.decision.action, "accept");
  assert.equal(result.data.results[0].verdict, "supported");
  assert.deepEqual(result.data.results[0].evidenceIds, ["build_log"]);
});

test("verify 在阻断主张被反驳时返回 reject", async () => {
  const runtime = new PrimitiveRuntime(new FakeProvider("contradicted"), "jev-test");
  const result = await executeVerify(runtime, input, options);
  assert.equal(result.status, "resolved");
  assert.equal(result.decision.action, "reject");
  assert.deepEqual(result.decision.reasonCodes, ["BLOCKING_CLAIM_CONTRADICTED"]);
});

test("verify 在证据未覆盖阻断主张时要求补充证据", async () => {
  const runtime = new PrimitiveRuntime(new FakeProvider("not_addressed"), "jev-test");
  const result = await executeVerify(runtime, input, options);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.decision.action, "collect_evidence");
});

test("verify 的低置信度阈值由策略配置决定", async () => {
  const runtime = new PrimitiveRuntime(new FakeProvider("supported", 0.7), "jev-test");
  const result = await executeVerify(runtime, input, options);
  assert.equal(result.status, "review_required");
  assert.equal(result.decision.action, "system_two_review");
  assert.deepEqual(result.decision.reasonCodes, ["SEMANTIC_CONFIDENCE_LOW"]);
});
