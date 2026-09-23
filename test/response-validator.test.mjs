import test from "node:test";
import assert from "node:assert/strict";
import { choice, noul, score } from "../dist/primitives/questions.js";
import { validateAnswer } from "../dist/runtime/response-validator.js";

test("Choice 校验有效答案并计算 margin", () => {
  const question = choice("选择更匹配的候选", { a: "候选 A", b: "候选 B" });
  const signal = validateAnswer("pick", question, {
    type: "choice",
    choice: "a",
    probabilities: { a: 0.8, b: 0.2 },
    confidence: 0.9,
  });
  assert.equal(signal.status, "valid");
  assert.equal(signal.selected, "a");
  assert.equal(signal.margin, 0.6000000000000001);
});

test("Choice winner 与概率分布不一致时 fail closed", () => {
  const question = choice("选择更匹配的候选", { a: null, b: null });
  const signal = validateAnswer("pick", question, {
    type: "choice",
    choice: "b",
    probabilities: { a: 0.8, b: 0.2 },
    confidence: 0.9,
  });
  assert.equal(signal.status, "invalid_response");
  assert.equal(signal.errorCode, "CHOICE_WINNER_MISMATCH");
});

test("Noul 概率必须在 0 到 1 之间", () => {
  const question = noul("是否相关", { true: "相关", false: "不相关" });
  const signal = validateAnswer("relevant", question, { type: "noul", noul: 1.2 });
  assert.equal(signal.status, "invalid_response");
  assert.equal(signal.errorCode, "NOUL_VALUE_INVALID");
});

test("Score 分数必须与概率分布的期望一致", () => {
  const question = score("复杂度", ["低", "中", "高"]);
  const signal = validateAnswer("complexity", question, {
    type: "score",
    score: 0.2,
    probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 },
    confidence: 0.9,
  });
  assert.equal(signal.status, "invalid_response");
  assert.equal(signal.errorCode, "SCORE_MEAN_MISMATCH");
});
