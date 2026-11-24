import assert from "node:assert/strict";
import test from "node:test";
import { Vault } from "../src/anonymizer.js";
import { restoreJson, restoreText, SseRestorer } from "../src/restore.js";

function openAiContents(output) {
  const parts = [];
  for (const block of output.split("\n\n")) {
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
      const args = obj?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments;
      if (typeof args === "string") parts.push(args);
    } catch {
      // ignore
    }
  }
  return parts.join("");
}

function anthopicContents(output) {
  const parts = [];
  for (const block of output.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      const obj = JSON.parse(data);
      if (typeof obj?.delta?.text === "string") parts.push(obj.delta.text);
    } catch {
      // ignore
    }
  }
  return parts.join("");
}

test("restoreText replaces known tokens and leaves unknown ones", () => {
  const vault = new Vault("ab12");
  const token = vault.token("EMAIL", "john@example.com");
  assert.equal(restoreText(`Mail ${token}`, vault), "Mail john@example.com");
  assert.equal(restoreText("Mail [[EMAIL_ffff_9]]", vault), "Mail [[EMAIL_ffff_9]]");
  assert.equal(restoreText("Mail [[ email _ AB12 _ 1 ]]", vault), "Mail john@example.com");
});

test("restoreJson restores nested strings", () => {
  const vault = new Vault("ab12");
  const token = vault.token("PHONE", "+1 415 555 2671");
  const body = { messages: [{ content: `Call ${token}` }], model: "x" };
  restoreJson(body, vault);
  assert.equal(body.messages[0].content, "Call +1 415 555 2671");
});

test("SSE restorer handles a token split across events and chunks", () => {
  const vault = new Vault("ab12");
  const token = vault.token("EMAIL", "john@example.com");
  const stream =
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello [[EMA" } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: "IL_ab12_1]] and welcome" } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n";

  for (const chunkSize of [1, 2, 7, 13, stream.length]) {
    const restorer = new SseRestorer(vault);
    let output = "";
    for (let i = 0; i < stream.length; i += chunkSize) {
      output += restorer.push(stream.slice(i, i + chunkSize));
    }
    output += restorer.flush();
    assert.equal(openAiContents(output), "Hello john@example.com and welcome", `chunk ${chunkSize}`);
    assert.ok(!output.includes(token));
  }
});

test("SSE restorer tolerates a token split across three events", () => {
  const vault = new Vault("ab12");
  const token = vault.token("PERSON", "Sarah Connor");
  const events = ["Hel", "lo [[PER", "SON_ab12_1]]!"];
  const stream = events
    .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    .join("");
  const restorer = new SseRestorer(vault);
  const output = restorer.push(stream) + restorer.flush();
  assert.equal(openAiContents(output), "Hello Sarah Connor!");
  assert.ok(!output.includes(token));
});

test("SSE restorer restores tool arguments", () => {
  const vault = new Vault("ab12");
  const token = vault.token("EMAIL", "john@example.com");
  const first = token.slice(0, 8);
  const rest = token.slice(8);
  const stream =
    `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `{"to":"${first}` } }] } }],
    })}\n\n` +
    `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `${rest}"}` } }] } }],
    })}\n\n`;
  const restorer = new SseRestorer(vault);
  const output = restorer.push(stream) + restorer.flush();
  assert.match(openAiContents(output), /john@example\.com/);
  assert.ok(!output.includes(token));
});

test("SSE restorer keeps an incomplete token when the stream ends", () => {
  const vault = new Vault("ab12");
  const stream = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello [[EMA" } }] })}\n\n`;
  const restorer = new SseRestorer(vault);
  const output = restorer.push(stream) + restorer.flush();
  assert.equal(openAiContents(output), "Hello [[EMA");
});

test("SSE restorer handles Anthropic content blocks", () => {
  const vault = new Vault("ab12");
  const token = vault.token("PERSON", "Sarah Connor");
  const stream =
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi [[PER" },
    })}\n\n` +
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "SON_ab12_1]]" },
    })}\n\n` +
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  const restorer = new SseRestorer(vault);
  const output = restorer.push(stream) + restorer.flush();
  assert.equal(anthopicContents(output), "Hi Sarah Connor");
});
