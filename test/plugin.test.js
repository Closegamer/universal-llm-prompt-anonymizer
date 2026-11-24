import assert from "node:assert/strict";
import test from "node:test";
import { proxyBaseURL } from "../index.js";

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
