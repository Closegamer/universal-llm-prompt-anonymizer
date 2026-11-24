export const INSTRUCTION =
  "Security placeholders: some values in this conversation are replaced with opaque tokens like [[PERSON_0000_999]]. " +
  "Treat every such token as a real value. Reproduce each token exactly as written, character for character. " +
  "Never translate, shorten, reformat, split, explain, or invent tokens. If you refer to the same entity again, reuse its exact token.";

function appendToContent(message, text) {
  if (typeof message.content === "string") {
    message.content = `${message.content}\n\n${text}`;
    return true;
  }
  if (Array.isArray(message.content)) {
    message.content.push({ type: "text", text });
    return true;
  }
  if (message.content == null) {
    message.content = text;
    return true;
  }
  return false;
}

function ensureSystemText(system, text) {
  if (typeof system === "string") return `${system}\n\n${text}`;
  if (Array.isArray(system)) return [...system, { type: "text", text }];
  if (system && typeof system === "object") {
    if (Array.isArray(system.parts)) return { ...system, parts: [...system.parts, { text }] };
  }
  return text;
}

export function injectInstruction(body, provider = "unknown", text = INSTRUCTION) {
  if (provider === "anthropic") {
    body.system = ensureSystemText(body.system, text);
    return true;
  }

  if (provider === "gemini") {
    const key = body.system_instruction !== undefined ? "system_instruction" : "systemInstruction";
    const current = body[key];
    body[key] =
      typeof current === "string"
        ? { parts: [{ text: current }, { text }] }
        : ensureSystemText(current ?? { parts: [] }, text);
    return true;
  }

  if (typeof body.instructions === "string") {
    body.instructions = `${body.instructions}\n\n${text}`;
    return true;
  }

  if (body.input !== undefined && body.instructions === undefined && Array.isArray(body.input)) {
    body.instructions = text;
    return true;
  }

  if (Array.isArray(body.messages)) {
    const system = body.messages.find((m) => m && (m.role === "system" || m.role === "developer"));
    if (system && appendToContent(system, text)) return true;
    body.messages.unshift({ role: "system", content: text });
    return true;
  }

  if (typeof body.prompt === "string") {
    body.prompt = `${text}\n\n${body.prompt}`;
    return true;
  }

  if (typeof body.input === "string") {
    body.input = `${text}\n\n${body.input}`;
    return true;
  }

  if (Array.isArray(body.input)) {
    const first = body.input.find((item) => item && typeof item.content === "string");
    if (first) {
      first.content = `${text}\n\n${first.content}`;
      return true;
    }
  }

  if (body.system !== undefined) {
    body.system = ensureSystemText(body.system, text);
    return true;
  }

  return false;
}
