import test from "node:test";
import assert from "node:assert/strict";
import { reduceEvidence } from "../dist/context/reducer.js";

const evidence = (id, text) => ({ id, type: "text", text });

test("Evidence reducer 规范换行并保持输入顺序", () => {
  const result = reduceEvidence([
    evidence("a", " 第一行\r\n第二行 "),
    evidence("b", "第三行"),
  ]);
  assert.deepEqual(result.evidence.map((item) => item.id), ["a", "b"]);
  assert.equal(result.evidence[0].text, "第一行\n第二行");
  assert.equal(result.truncated, false);
});

test("Evidence reducer 超出预算时显式标记截断", () => {
  const result = reduceEvidence(
    [evidence("a", "a".repeat(30)), evidence("b", "b".repeat(30))],
    { maxTotalChars: 20, maxItemChars: 20 },
  );
  assert.equal(result.truncated, true);
  assert.equal(result.evidence.length, 1);
  assert.match(result.evidence[0].text, /内容已截断/);
});
