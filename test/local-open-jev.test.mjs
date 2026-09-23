import test from "node:test";
import assert from "node:assert/strict";
import { LocalOpenJevProvider } from "../dist/providers/local-open-jev.js";

class FakeTensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

const markerIds = new Map([
  ["[CLS]", 1],
  ["[SEP]", 2],
  ["[STATE]", 3],
  ["[Q]", 4],
  ["[OPT]", 5],
]);

const runtime = Promise.resolve({
  tokenizer(text) {
    const marker = markerIds.get(text);
    const values = marker ? [marker] : text.split(/\s+/).filter(Boolean).map((_, index) => 10 + index);
    return { input_ids: { data: Int32Array.from(values) } };
  },
  async model(inputs) {
    const count = inputs.pair_opt.dims[1];
    return {
      logits: {
        to() {
          return { data: Float32Array.from({ length: count }, (_, index) => index) };
        },
      },
    };
  },
  Tensor: FakeTensor,
});

test("本地 OpenJev 将 choice、noul 和 score 转成标准 Provider answers", async () => {
  const provider = new LocalOpenJevProvider(
    { modelId: "open-jev-test", repo: "unused", dtype: "q4" },
    { runtime, logger() {} },
  );
  const result = await provider.evaluate({
    model: "open-jev-test",
    state: { evidence: "build passed" },
    questions: {
      relation: {
        type: "choice",
        instructions: "Choose relation",
        criteria: { supported: "supported", contradicted: "contradicted" },
      },
      relevant: {
        type: "noul",
        instructions: "Is it relevant?",
        criteria: { true: "relevant", false: "irrelevant" },
      },
      quality: {
        type: "score",
        instructions: "Score quality",
        criteria: ["low", "medium", "high"],
      },
    },
  });

  assert.equal(result.provider, "local");
  assert.equal(result.answers.relation.choice, "contradicted");
  assert.ok(result.answers.relevant.noul > 0.5);
  assert.ok(result.answers.quality.score > 1);
  assert.deepEqual(Object.keys(result.answers.quality.probabilities), ["0", "1", "2"]);
});
