import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP stdio 可以发现全部工具并调用 verify", async () => {
  const mockProvider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const questionId = Object.keys(payload.questions)[0];
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: payload.model,
        answers: {
          [questionId]: {
            type: "choice",
            choice: "supported",
            probabilities: {
              supported: 0.9,
              contradicted: 0.05,
              not_addressed: 0.05,
            },
            confidence: 0.9,
          },
        },
        usage: { input_tokens: 30, output_tokens: 5 },
      }),
    );
  });
  mockProvider.listen(0, "127.0.0.1");
  await once(mockProvider, "listening");
  const address = mockProvider.address();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: {
      ...process.env,
      JEV_PROVIDER: "compatible",
      JEV_API_KEY: "test-key",
      JEV_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      JEV_MODEL: "jev-test",
    },
  });
  const client = new Client({ name: "smoke-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "assess_task",
        "completion_gate",
        "rank_candidates",
        "screen_content",
        "select_capability",
        "verify",
      ],
    );

    const response = await client.callTool({
      name: "verify",
      arguments: {
        claims: [{ id: "claim_a", text: "构建成功", blocking: true }],
        evidence: [{ id: "build", type: "build", text: "构建成功" }],
      },
    });
    const text = response.content.find((item) => item.type === "text")?.text;
    const envelope = JSON.parse(text);
    assert.equal(envelope.status, "resolved");
    assert.equal(envelope.decision.action, "accept");
  } finally {
    await client.close();
    mockProvider.close();
    await once(mockProvider, "close");
  }
});
