#!/usr/bin/env node

import { errorMessage } from "./core/errors.js";
import { startStdioServer } from "./mcp/stdio.js";

startStdioServer().catch((error: unknown) => {
  console.error(`codex-jev-mcp 启动失败：${errorMessage(error)}`);
  process.exitCode = 1;
});
