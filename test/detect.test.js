import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { Anonymizer, Vault } from "../src/anonymizer.js";
import { detectRegex } from "../src/regex.js";
import { injectInstruction } from "../src/instructions.js";

function types(text) {
  return detectRegex(text).map((span) => `${span.type}:${span.value}`);
}

test("vault reuses tokens and rejects a foreign salt", () => {
  const vault = new Vault("ab12");
  const a = vault.token("EMAIL", "John@Example.com");
  const b = vault.token("EMAIL", "john@example.com");
  assert.equal(a, "[[EMAIL_ab12_1]]");
  assert.equal(a, b);
  assert.equal(vault.lookup("EMAIL", "ab12", 1), "John@Example.com");
  assert.equal(vault.lookup("EMAIL", "ffff", 1), undefined);
});

test("regex detects structured PII", () => {
  const text = [
    "Mail john.doe@example.com or call +7 (999) 123-45-67.",
    "Card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32.",
    "SSN 123-45-6789, IP 192.168.1.10.",
    "I was born on 12.03.1985. My nickname is \"Ace\".",
    "Account number: 123456789.",
    "File: C:\\Users\\avgrigorev\\project\\notes.txt",
  ].join("\n");

  const found = types(text);
  assert.ok(found.some((x) => x.startsWith("EMAIL:")));
  assert.ok(found.some((x) => x.startsWith("PHONE:")));
  assert.ok(found.some((x) => x.startsWith("CARD:")));
  assert.ok(found.some((x) => x.startsWith("IBAN:")));
  assert.ok(found.some((x) => x.startsWith("SSN:")));
  assert.ok(found.some((x) => x.startsWith("IP:")));
  assert.ok(found.some((x) => x.startsWith("DATE:")));
  assert.ok(found.some((x) => x.startsWith("NICKNAME:")));
  assert.ok(found.some((x) => x.startsWith("ID:")));
  assert.ok(found.some((x) => x === "USERNAME:avgrigorev"));
});

test("date is only tokenized near a birth label", () => {
  assert.deepEqual(types("The release happened on 12.03.1985."), []);
  assert.ok(types("Date of birth: 12.03.1985").some((x) => x.startsWith("DATE:")));
});

test("invalid card numbers are not cards", () => {
  assert.ok(!types("Number 4111 1111 1111 1112").some((x) => x.startsWith("CARD:")));
});

test("detector switches can disable categories", () => {
  const allOff = {
    email: false,
    phone: false,
    address: false,
    card: false,
    iban: false,
    ssn: false,
    id: false,
    number: false,
    ip: false,
    date: false,
    nickname: false,
    username: false,
  };
  assert.deepEqual(
    detectRegex("Email john@example.com. DOB 12.03.1985. C:\\Users\\avgrigorev", allOff),
    [],
  );
  assert.deepEqual(detectRegex("Email john@example.com", { email: false }), []);
  assert.deepEqual(detectRegex("DOB 12.03.1985", { date: false }), []);
  assert.deepEqual(detectRegex("C:\\Users\\avgrigorev", { username: false }), []);
});

test("anonymizer replaces repeated values with one token", async () => {
  const anonymizer = new Anonymizer({ ner: { enabled: false }, salt: "beef" });
  const text = "Write to john@example.com. Again: john@example.com.";
  const once = await anonymizer.anonymizeText(text);
  const twice = await anonymizer.anonymizeText(text);
  assert.equal(once, "Write to [[EMAIL_beef_1]]. Again: [[EMAIL_beef_1]].");
  assert.equal(once, twice);
  assert.equal(anonymizer.vault.size, 1);
});

test("anonymizer replaces the OS username outside paths too", async () => {
  const username = os.userInfo().username;
  if (username.length < 3) return;
  const anonymizer = new Anonymizer({ ner: { enabled: false }, salt: "d00d" });
  const out = await anonymizer.anonymizeText(`Account owner: ${username} wrote this.`);
  assert.equal(out, "Account owner: [[USERNAME_d00d_1]] wrote this.");
});

test("body anonymization walks nested request shapes", async () => {
  const anonymizer = new Anonymizer({ ner: { enabled: false }, salt: "cafe" });
  const body = {
    model: "test-model",
    messages: [
      { role: "user", content: "My phone is +1 415 555 2671." },
      { role: "assistant", content: [{ type: "text", text: "Call +1 415 555 2671." }] },
    ],
  };
  const result = await anonymizer.anonymizeBody(body);
  assert.equal(result.changed, true);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].content, "My phone is [[PHONE_cafe_1]].");
  assert.equal(body.messages[1].content[0].text, "Call [[PHONE_cafe_1]].");
});

test("instruction is injected into each provider shape", () => {
  const openai = { messages: [{ role: "user", content: "hi" }] };
  assert.equal(injectInstruction(openai, "openai"), true);
  assert.equal(openai.messages[0].role, "system");
  assert.match(openai.messages[0].content, /opaque tokens/);

  const anthropic = { messages: [{ role: "user", content: "hi" }] };
  assert.equal(injectInstruction(anthropic, "anthropic"), true);
  assert.match(anthropic.system, /opaque tokens/);
  assert.equal(anthropic.messages[0].role, "user");

  const gemini = { contents: [] };
  assert.equal(injectInstruction(gemini, "gemini"), true);
  assert.match(gemini.systemInstruction.parts[0].text, /opaque tokens/);
});
