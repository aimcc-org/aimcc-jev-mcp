import { loadRuntimeConfig } from "./config/env.js";
import { createPlaygroundServer } from "./playground/server.js";
import { loadPolicyConfig } from "./policy/config.js";
import { createProvider } from "./providers/factory.js";
import { PrimitiveRuntime } from "./runtime/primitive-runtime.js";

const config = loadRuntimeConfig();
const policies = loadPolicyConfig();
const runtime = new PrimitiveRuntime(createProvider(config), config.model);
const host = process.env.PLAYGROUND_HOST ?? "127.0.0.1";
const port = Number(process.env.PLAYGROUND_PORT ?? "4317");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYGROUND_PORT 必须是有效端口。");
}

const server = createPlaygroundServer(runtime, policies, {
  provider: config.provider,
  model: config.model,
});

server.listen(port, host, () => {
  console.log(`JEV Playground: http://${host}:${port}`);
  console.log(`Provider: ${config.provider} / ${config.model}`);
});
