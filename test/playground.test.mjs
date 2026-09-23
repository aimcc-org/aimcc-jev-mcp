import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createPlaygroundServer } from "../dist/playground/server.js";
import { loadPolicyConfig } from "../dist/policy/config.js";
import { PrimitiveRuntime } from "../dist/runtime/primitive-runtime.js";

class FailingProvider {
  async evaluate() {
    throw new Error("completion gate should not call the provider");
  }
}

async function withServer(callback) {
  const runtime = new PrimitiveRuntime(new FailingProvider(), "jev-test");
  const server = createPlaygroundServer(runtime, loadPolicyConfig(), {
    provider: "compatible",
    model: "jev-test",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("Playground 提供页面和脱敏后的 Provider 信息", async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Decision Playground/);

    const info = await fetch(`${baseUrl}/api/info`).then((response) => response.json());
    assert.deepEqual(info, { provider: "compatible", model: "jev-test" });
  });
});

test("Playground API 复用 Tool Schema 和确定性策略", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "completion_gate",
        input: {
          requirements: [{ id: "done", text: "功能完成", blocking: true }],
          evidence: [{ id: "diff", type: "diff", text: "实现代码" }],
          checks: [{ id: "tests", status: "failed", blocking: true }],
        },
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.decision.action, "reject");
    assert.equal(result.meta.model, "not-called");

    const invalid = await fetch(`${baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "verify", input: {} }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).status, "invalid_input");
  });
});
