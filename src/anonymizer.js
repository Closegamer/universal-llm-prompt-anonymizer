import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import { detectNames } from "./ner.js";
import { dedupe, detectRegex, findWordSpans } from "./regex.js";
import { collectStrings, setAtPath } from "./jsonwalk.js";

export const COMMON_USERNAMES = new Set([
  "admin",
  "user",
  "root",
  "test",
  "guest",
  "runner",
  "runneradmin",
  "ubuntu",
  "ec2-user",
]);

function normalizeValue(type, value) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  switch (type) {
    case "EMAIL":
    case "PERSON":
    case "NICKNAME":
    case "DATE":
    case "ADDRESS":
    case "USERNAME":
      return trimmed.toLowerCase();
    case "PHONE":
    case "CARD":
    case "SSN":
    case "ID":
      return trimmed.replace(/\D/g, "");
    case "IBAN":
      return trimmed.replace(/\s+/g, "").toUpperCase();
    default:
      return trimmed;
  }
}

export class Vault {
  constructor(salt = randomBytes(2).toString("hex")) {
    this.salt = salt;
    this.byValue = new Map();
    this.byToken = new Map();
    this.counters = new Map();
  }

  token(type, value) {
    const key = `${type}\0${normalizeValue(type, value)}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;

    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    const token = `[[${type}_${this.salt}_${n}]]`;
    this.byValue.set(key, token);
    this.byToken.set(`${type}_${this.salt}_${n}`, value);
    return token;
  }

  lookup(type, salt, n) {
    if (salt !== this.salt) return undefined;
    return this.byToken.get(`${type}_${salt}_${n}`);
  }

  get size() {
    return this.byValue.size;
  }
}

function skipValue(value) {
  if (value.startsWith("data:")) return true;
  if (value.length > 1024 && !/\s/.test(value) && /^[A-Za-z0-9+/=]+$/.test(value)) return true;
  return false;
}

function hashText(text) {
  return createHash("sha1").update(text).digest("hex");
}

export class Anonymizer {
  constructor(config = {}) {
    this.config = config;
    this.vault = new Vault(config.salt);
    this.textCache = new Map();
    this.cacheMax = 2000;
    this.cacheChars = 0;
    try {
      this.username = os.userInfo().username;
    } catch {
      this.username = "";
    }
  }

  async anonymizeText(text) {
    if (!text) return text;
    const key = hashText(text);
    const cached = this.textCache.get(key);
    if (cached !== undefined) return cached;

    const detectors = this.config.detectors ?? {};
    const regexSpans = detectRegex(text, detectors);
    if (
      detectors.username !== false &&
      this.username &&
      this.username.length >= 3 &&
      !COMMON_USERNAMES.has(this.username.toLowerCase())
    ) {
      regexSpans.push(...findWordSpans(text, [this.username], "USERNAME"));
    }

    let nameSpans = [];
    if (this.config.ner?.enabled !== false && detectors.names !== false) {
      const words = await detectNames(text, this.config.ner ?? {});
      if (words.length) nameSpans = findWordSpans(text, words, "PERSON");
    }

    const spans = dedupe([...regexSpans, ...nameSpans]);
    let result = text;
    if (spans.length) {
      let out = "";
      let last = 0;
      for (const span of spans) {
        out += text.slice(last, span.start);
        out += this.vault.token(span.type, span.value);
        last = span.end;
      }
      result = out + text.slice(last);
    }

    this.textCache.set(key, result);
    this.cacheChars += text.length;
    if (this.textCache.size > this.cacheMax || this.cacheChars > 20_000_000) {
      this.textCache.clear();
      this.cacheChars = 0;
    }
    return result;
  }

  async anonymizeBody(body) {
    const before = this.vault.size;
    const slots = collectStrings(body);
    const memo = new Map();
    let changed = false;

    for (const slot of slots) {
      if (skipValue(slot.value)) continue;
      let next = memo.get(slot.value);
      if (next === undefined) {
        next = await this.anonymizeText(slot.value);
        memo.set(slot.value, next);
      }
      if (next !== slot.value) {
        setAtPath(body, slot.path, next);
        changed = true;
      }
    }

    return { changed, added: this.vault.size - before };
  }
}
