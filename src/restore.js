import { collectStrings, setAtPath, walkAllStrings } from "./jsonwalk.js";

const TOKEN_RE = /\[\[\s*([A-Za-z]+)[\s_-]+([a-z0-9]{4})[\s_-]+(\d+)\s*\]\]/gi;
const PARTIAL_RE = /(\[\[[A-Za-z_0-9]*|\[)$/;

export function restoreText(text, vault) {
  return text.replace(
    TOKEN_RE,
    (match, type, salt, n) => vault.lookup(type.toUpperCase(), salt.toLowerCase(), Number(n)) ?? match,
  );
}

export function restoreJson(value, vault) {
  return walkAllStrings(value, (text) => restoreText(text, vault));
}

function splitPartial(text, vault) {
  const out = restoreText(text, vault);
  const match = out.match(PARTIAL_RE);
  if (!match) return { out, tail: "" };
  return { out: out.slice(0, match.index), tail: match[1] };
}

function parseSse(raw) {
  const dataLines = [];
  const other = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    } else if (line.trim() !== "") {
      other.push(line);
    }
  }
  return { data: dataLines.join("\n"), other };
}

function pathKey(path, event) {
  const prefix = [event?.type, event?.index, event?.output_index, event?.content_index]
    .filter((value) => value !== undefined)
    .join(":");
  return `${prefix}|${path.join(".")}`;
}

function serialize(event) {
  return `${[...event.other, `data: ${JSON.stringify(event.obj)}`].join("\n")}\n\n`;
}

export class SseRestorer {
  constructor(vault) {
    this.vault = vault;
    this.buffer = "";
    this.held = null;
  }

  push(chunk) {
    this.buffer += chunk;
    this.buffer = this.buffer.replace(/\r\n/g, "\n");

    let out = "";
    let index = this.buffer.indexOf("\n\n");
    while (index !== -1) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      out += this.handleEvent(raw);
      index = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  flush() {
    let out = "";
    if (this.buffer.trim() !== "") {
      out += this.handleEvent(this.buffer);
      this.buffer = "";
    }
    if (this.held) {
      this.appendHeldPending();
      out += serialize(this.held);
      this.held = null;
    }
    return out;
  }

  handleEvent(raw) {
    if (raw.trim() === "") return "";

    const { data, other } = parseSse(raw);
    if (!data) {
      return this.barrier(`${[...other].join("\n")}\n\n`, other);
    }

    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return this.barrier(`${[...other, ...data.split("\n").map((line) => `data: ${line}`)].join("\n")}\n\n`);
    }

    if (!obj || typeof obj !== "object") {
      return this.barrier(`${[...other, `data: ${JSON.stringify(obj)}`].join("\n")}\n\n`);
    }

    const slots = collectStrings(obj, new Set());
    if (slots.length === 0) {
      return this.barrier(`${[...other, `data: ${JSON.stringify(obj)}`].join("\n")}\n\n`);
    }

    const nextPending = new Map();
    for (const slot of slots) {
      const key = pathKey(slot.path, obj);
      const carried = this.held?.pending.get(key);
      let value = slot.value;
      if (carried) {
        value = carried.tail + value;
        this.held.pending.delete(key);
      }
      const { out, tail } = splitPartial(value, this.vault);
      setAtPath(obj, slot.path, out);
      if (tail) nextPending.set(key, { tail, path: slot.path, value: out });
    }

    let output = "";
    if (this.held) {
      this.appendHeldPending();
      output += serialize(this.held);
      this.held = null;
    }

    const current = { obj, other, pending: nextPending };
    if (nextPending.size > 0) {
      this.held = current;
    } else {
      output += serialize(current);
    }
    return output;
  }

  barrier(raw) {
    let output = "";
    if (this.held) {
      this.appendHeldPending();
      output += serialize(this.held);
      this.held = null;
    }
    return output + raw;
  }

  appendHeldPending() {
    if (!this.held) return;
    for (const pending of this.held.pending.values()) {
      setAtPath(this.held.obj, pending.path, pending.value + pending.tail);
    }
    this.held.pending.clear();
  }
}

export function restoreSseStream(vault) {
  const restorer = new SseRestorer(vault);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new TransformStream({
    transform(chunk, controller) {
      const out = restorer.push(decoder.decode(chunk, { stream: true }));
      if (out) controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      const out = restorer.flush(decoder.decode());
      if (out) controller.enqueue(encoder.encode(out));
    },
  });
}
