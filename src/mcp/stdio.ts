import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadRuntimeConfig } from "../config/env.js";
import { createProvider } from "../providers/factory.js";
import { loadPolicyConfig } from "../policy/config.js";
import { PrimitiveRuntime } from "../runtime/primitive-runtime.js";
import { createMcpServer } from "./server.js";

export async function startStdioServer(): Promise<void> {
  const config = loadRuntimeConfig();
  const policies = loadPolicyConfig();
  const runtime = new PrimitiveRuntime(createProvider(config), config.model);
  const server = createMcpServer(runtime, policies);
  await server.connect(new StdioServerTransport());
}
