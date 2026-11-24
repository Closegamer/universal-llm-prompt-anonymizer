export const SKIP_KEYS = new Set([
  "model",
  "id",
  "role",
  "type",
  "object",
  "created",
  "index",
  "finish_reason",
  "finishReason",
  "tool_call_id",
  "tool_callId",
  "tool_use_id",
  "toolUseId",
  "sha256",
  "hash",
  "mime_type",
  "mimeType",
  "media_type",
  "mediaType",
  "encoding",
  "format",
  "messageId",
  "messageID",
  "sessionId",
  "sessionID",
]);

export function collectStrings(root, skipKeys = SKIP_KEYS) {
  const out = [];
  function walk(value, path) {
    if (typeof value === "string") {
      out.push({ path, value });
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], [...path, i]);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (skipKeys.has(key)) continue;
        walk(child, [...path, key]);
      }
    }
  }
  walk(root, []);
  return out;
}

export function setAtPath(root, path, value) {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
}

export function walkAllStrings(root, fn) {
  function walk(value, path) {
    if (typeof value === "string") {
      const next = fn(value, path);
      return next === undefined ? value : next;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) value[i] = walk(value[i], [...path, i]);
      return value;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        value[key] = walk(child, [...path, key]);
      }
      return value;
    }
    return value;
  }
  return walk(root, []);
}
