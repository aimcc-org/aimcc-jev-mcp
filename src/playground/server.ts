import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
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

const MAX_REQUEST_BYTES = 1_000_000;
const playgroundHtml = readFileSync(
  new URL("../../playground/index.html", import.meta.url),
  "utf8",
);

type ToolName =
  | "verify"
  | "rank_candidates"
  | "select_capability"
  | "assess_task"
  | "screen_content"
  | "completion_gate";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value, null, 2));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("请求体不能超过 1 MB。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function requestShape(value: unknown): { tool: ToolName; input: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("请求体必须是对象。");
  }
  const body = value as Record<string, unknown>;
  const tools = new Set<ToolName>([
    "verify",
    "rank_candidates",
    "select_capability",
    "assess_task",
    "screen_content",
    "completion_gate",
  ]);
  if (typeof body.tool !== "string" || !tools.has(body.tool as ToolName)) {
    throw new Error("未知 Tool。");
  }
  return { tool: body.tool as ToolName, input: body.input };
}

async function executeTool(
  runtime: PrimitiveRuntime,
  policies: PolicyConfig,
  tool: ToolName,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  switch (tool) {
    case "verify":
      return executeVerify(runtime, verifyInputSchema.parse(input), {
        signal,
        policy: policies.verify,
      });
    case "rank_candidates":
      return executeRankCandidates(runtime, rankCandidatesInputSchema.parse(input), {
        signal,
        policy: policies.rankCandidates,
      });
    case "select_capability":
      return executeSelectCapability(runtime, selectCapabilityInputSchema.parse(input), {
        signal,
        policy: policies.selectCapability,
      });
    case "assess_task":
      return executeAssessTask(runtime, assessTaskInputSchema.parse(input), {
        signal,
        policy: policies.assessTask,
      });
    case "screen_content":
      return executeScreenContent(runtime, screenContentInputSchema.parse(input), {
        signal,
        policy: policies.screenContent,
      });
    case "completion_gate":
      return executeCompletionGate(runtime, completionGateInputSchema.parse(input), {
        signal,
        policy: policies.completionGate,
      });
  }
}

export function createPlaygroundServer(
  runtime: PrimitiveRuntime,
  policies: PolicyConfig,
  providerInfo: { provider: string; model: string },
) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(playgroundHtml);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/info") {
      json(response, 200, providerInfo);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/run") {
      const controller = new AbortController();
      request.once("aborted", () => controller.abort());
      try {
        const body = requestShape(await readJson(request));
        json(
          response,
          200,
          await executeTool(runtime, policies, body.tool, body.input, controller.signal),
        );
      } catch (error) {
        const details =
          error instanceof ZodError
            ? error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
            : undefined;
        json(response, 400, {
          status: "invalid_input",
          message: error instanceof Error ? error.message : "请求失败。",
          ...(details ? { details } : {}),
        });
      }
      return;
    }
    json(response, 404, { message: "Not found" });
  });
}
