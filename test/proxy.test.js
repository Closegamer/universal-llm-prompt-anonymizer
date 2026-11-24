import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Anonymizer } from "../src/anonymizer.js";
import { DEFAULTS } from "../src/config.js";
import { startServer } from "../src/server.js";

function readAll(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function startProxy(upstreamPort) {
  const config = {
    ...DEFAULTS,
    port: 0,
    routes: { "/mock": `http://127.0.0.1:${upstreamPort}` },
    ner: { enabled: false },
    skipUpstreamHosts: [],
    log: false,
  };
  const started = await startServer(config, new Anonymizer({ ner: { enabled: false }, salt: "test" }));
  return {
    ...started,
    port: started.server.address().port,
  };
}

function sseContents(text) {
  const parts = [];
  for (const block of text.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const obj = JSON.parse(data);
      const content = obj?.choices?.[0]?.delta?.content;
      if (typeof content === "string") parts.push(content);
    } catch {
      // ignore
    }
  }
  return parts.join("");
}

test("proxy anonymizes the request and restores a streamed token", async () => {
  let seen;
  const upstream = await listen(async (req, res) => {
    seen = JSON.parse(await readAll(req));
    const userText = seen.messages.at(-1).content;
    const token = userText.match(/\[\[EMAIL_[a-z0-9]{4}_\d+\]\]/)[0];
    res.writeHead(200, { "content-type": "text/event-stream" });
    const events = [
      { choices: [{ delta: { content: `Mail ${token.slice(0, 8)}` } }] },
      { choices: [{ delta: { content: token.slice(8) } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end("data: [DONE]\n\n");
  });

  const proxy = await startProxy(upstream.port);
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "Email john@example.com" }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-prompt-anonymizer"), "active");
    const text = await response.text();
    assert.equal(sseContents(text), "Mail john@example.com");

    assert.ok(!JSON.stringify(seen).includes("john@example.com"));
    assert.match(JSON.stringify(seen), /\[\[EMAIL_test_1\]\]/);
    assert.equal(seen.messages[0].role, "system");
    assert.match(seen.messages[0].content, /opaque tokens/);
    assert.equal(seen.model, "test-model");
  } finally {
    await close(proxy.server);
    await close(upstream.server);
  }
});

test("proxy restores a non-streaming JSON response", async () => {
  const upstream = await listen(async (req, res) => {
    const seen = JSON.parse(await readAll(req));
    const token = seen.messages.at(-1).content.match(/\[\[PHONE_[a-z0-9]{4}_\d+\]\]/)[0];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `Call ${token}` } }] }));
  });

  const proxy = await startProxy(upstream.port);
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "Call +1 415 555 2671" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "Call +1 415 555 2671");
    assert.ok(!JSON.stringify(body).includes("[[PHONE_"));
  } finally {
    await close(proxy.server);
    await close(upstream.server);
  }
});

test("proxy refuses to forward a non-JSON body", async () => {
  let calls = 0;
  const upstream = await listen(async (req, res) => {
    calls++;
    await readAll(req);
    res.end("{}");
  });

  const proxy = await startProxy(upstream.port);
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "Email john@example.com",
    });
    assert.equal(response.status, 415);
    assert.equal(calls, 0);
  } finally {
    await close(proxy.server);
    await close(upstream.server);
  }
});

test("health identifies the product for the OpenCode plugin", async () => {
  const upstream = await listen(async (req, res) => {
    await readAll(req);
    res.end("{}");
  });
  const proxy = await startProxy(upstream.port);
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "universal-llm-prompt-anonymizer");
  } finally {
    await close(proxy.server);
    await close(upstream.server);
  }
});

test("proxy leaves a request without PII untouched", async () => {
  let seen;
  const upstream = await listen(async (req, res) => {
    seen = JSON.parse(await readAll(req));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const proxy = await startProxy(upstream.port);
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "Say hello" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-prompt-anonymizer"), "idle");
    assert.equal(seen.messages.length, 1);
  } finally {
    await close(proxy.server);
    await close(upstream.server);
  }
});
