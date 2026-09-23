import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { CompatibleProvider } from "../dist/providers/compatible.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const transport = { timeoutMs: 2_000, maxAttempts: 1, maxResponseBytes: 1_000 };
const request = {
  model: "jev-test",
  state: { task: "测试" },
  questions: {
    relevant: {
      type: "noul",
      instructions: "是否相关",
      criteria: { true: "相关", false: "不相关" },
    },
  },
};

test("兼容 Provider 规范化 answers 与 usage", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          answers: { relevant: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 12, output_tokens: 3 },
          model: "jev-test",
        }),
      );
    },
    async (url) => {
      const provider = new CompatibleProvider(url, "secret", transport);
      const result = await provider.evaluate(request);
      assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3 });
      assert.equal(result.provider, "compatible");
    },
  );
});

test("Provider 错误信息会隐藏密钥", async () => {
  await withServer(
    (_request, response) => {
      response.statusCode = 401;
      response.end("reflected secret-token");
    },
    async (url) => {
      const provider = new CompatibleProvider(url, "secret-token", transport);
      await assert.rejects(
        provider.evaluate(request),
        (error) => {
          assert.doesNotMatch(error.message, /secret-token/);
          assert.match(error.message, /\[已隐藏\]/);
          return true;
        },
      );
    },
  );
});

test("Provider 缺少 answers 时 fail closed", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ model: "jev-test" }));
    },
    async (url) => {
      const provider = new CompatibleProvider(url, "secret", transport);
      await assert.rejects(provider.evaluate(request), /响应缺少 answers 对象/);
    },
  );
});
