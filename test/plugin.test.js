import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import plugin, { proxyBaseURL, watchProxy } from "../index.js";

function listenHealth(port = 0) {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ service: "universal-llm-prompt-anonymizer" }));
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("plugin is a plain V2 plugin object", () => {
  assert.equal(plugin.id, "universal-llm-prompt-anonymizer");
  assert.equal(typeof plugin.setup, "function");
});

test("routing follows proxy health", async () => {
  const calls = { registered: 0, disposed: 0 };
  const ctx = {
    provider: {
      async transform() {
        calls.registered += 1;
        return {
          async dispose() {
            calls.disposed += 1;
          },
        };
      },
    },
  };

  const first = await listenHealth();
  const stop = await watchProxy(ctx, first.port, null, 10);
  await waitFor(() => calls.registered === 1, "routing to the running proxy");

  await close(first.server);
  await waitFor(() => calls.disposed === 1, "fallback after the proxy stops");

  const second = await listenHealth(first.port);
  await waitFor(() => calls.registered === 2, "routing again after the proxy restarts");

  await stop();
  assert.equal(calls.disposed, 2);
  await close(second.server);
});

test("plugin maps known providers to proxy routes", () => {
  assert.equal(proxyBaseURL({ id: "openai", settings: {} }, 8787), "http://127.0.0.1:8787/openai/v1");
  assert.equal(
    proxyBaseURL({ id: "anthropic", settings: {} }, 8787),
    "http://127.0.0.1:8787/anthropic",
  );
  assert.equal(
    proxyBaseURL({ id: "deepseek", settings: { baseURL: "https://api.deepseek.com" } }, 8787),
    "http://127.0.0.1:8787/deepseek",
  );
  assert.equal(
    proxyBaseURL({ id: "groq", settings: {} }, 8787),
    "http://127.0.0.1:8787/groq/openai/v1",
  );
  assert.equal(
    proxyBaseURL({ id: "google", settings: {} }, 8787),
    "http://127.0.0.1:8787/gemini",
  );
});

test("plugin leaves local and unknown providers alone", () => {
  assert.equal(
    proxyBaseURL({ id: "ollama", settings: { baseURL: "http://127.0.0.1:11434/v1" } }, 8787),
    null,
  );
  assert.equal(
    proxyBaseURL({ id: "custom", settings: { baseURL: "https://llm.example.com/v1" } }, 8787),
    null,
  );
  assert.equal(proxyBaseURL({ id: "unknown", settings: {} }, 8787), null);
});
