import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig, LOCAL_MODEL_ID } from "../dist/config/env.js";

test("auto 在没有云端 Key 时回退到本地 OpenJev", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.provider, "local");
  assert.equal(config.model, LOCAL_MODEL_ID);
  assert.equal(config.localDtype, "q4");
});

test("auto 优先使用已配置的云端 Provider", () => {
  const config = loadRuntimeConfig({ TYPESAFE_API_KEY: "test-key" });
  assert.equal(config.provider, "typesafe");
  assert.equal(config.model, "jev-1.13");
});
