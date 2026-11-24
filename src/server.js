import http from "node:http";
import { pipeline, Readable } from "node:stream";
import { Anonymizer } from "./anonymizer.js";
import { providerKind, routeFor } from "./config.js";
import { injectInstruction } from "./instructions.js";
import { restoreJson, restoreSseStream, restoreText } from "./restore.js";

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "accept-encoding",
  "content-encoding",
  "te",
  "trailer",
  "upgrade",
]);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function upstreamUrl(base, prefix, requestUrl) {
  const incoming = new URL(requestUrl, "http://localhost");
  const upstream = new URL(base);
  const suffix = incoming.pathname.slice(prefix.length);
  upstream.pathname = `${upstream.pathname.replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
  upstream.search = incoming.search;
  return upstream;
}

function copyRequestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key) || value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function copyResponseHeaders(upstream) {
  const headers = {};
  for (const [key, value] of upstream.headers) {
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) continue;
    headers[key] = value;
  }
  return headers;
}

function jsonError(res, status, message) {
  const body = JSON.stringify({ error: { type: "prompt_anonymizer_error", message } });
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "x-prompt-anonymizer": "error",
  });
  res.end(body);
}

async function handle(req, res, config, anonymizer) {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const log = config.log ? (...args) => console.error("[prompt-anonymizer]", ...args) : () => {};

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/health") {
    const body = JSON.stringify({
      ok: true,
      service: "universal-llm-prompt-anonymizer",
      ner: config.ner.enabled !== false,
      tokens: anonymizer.vault.size,
    });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (pathname === "/") {
    const body = [
      "Universal LLM Prompt Anonymizer",
      "Local privacy gateway for cloud LLMs",
      "Command: prompt-anonymizer",
      "",
      "Point a client at one of these prefixes:",
      ...Object.entries(config.routes).map(([prefix, upstream]) => `  ${prefix}  ->  ${upstream}`),
      "",
      `Health: http://${config.host}:${config.port}/health`,
    ].join("\n");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  const route = routeFor(config, pathname);
  if (!route) {
    jsonError(res, 404, `No upstream route for ${pathname}. Configure routes in anonymizer.config.json.`);
    return;
  }

  let body;
  try {
    body = await readBody(req, config.maxBodyBytes);
  } catch (error) {
    jsonError(res, error.status ?? 400, error.message);
    return;
  }

  const hasBody = body.length > 0 && req.method !== "GET" && req.method !== "HEAD";
  const contentType = String(req.headers["content-type"] ?? "");
  const looksJson = !contentType && /^\s*[{[]/.test(body.toString("utf8", 0, 16));
  const isJson = contentType.includes("application/json") || contentType.includes("+json") || looksJson;

  const target = upstreamUrl(route.upstream, route.prefix, req.url ?? "/");
  const localUpstream = config.skipUpstreamHosts?.includes(target.hostname);

  let outgoing = body;
  let anonymized = false;
  let added = 0;

  if (hasBody && !localUpstream) {
    if (!isJson) {
      if (!config.allowUnscanned) {
        jsonError(
          res,
          415,
          "prompt-anonymizer refuses to forward a non-JSON body because it cannot scan it. " +
            "Start with --allow-unscanned to override.",
        );
        return;
      }
      log("WARNING non-JSON body forwarded unscanned", req.method, pathname);
    } else {
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        jsonError(res, 400, "prompt-anonymizer could not parse the JSON body.");
        return;
      }

      try {
        const result = await anonymizer.anonymizeBody(parsed);
        added = result.added;
        if (result.changed) {
          injectInstruction(parsed, providerKind(route.prefix));
          outgoing = Buffer.from(JSON.stringify(parsed));
          anonymized = true;
        }
      } catch (error) {
        log("ANONYMIZATION FAILED, request blocked:", error.message);
        jsonError(res, 502, `Anonymization failed, request was not sent: ${error.message}`);
        return;
      }
    }
  }

  const headers = copyRequestHeaders(req);
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? outgoing : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (!res.writableEnded) jsonError(res, 502, `Upstream request failed: ${error.message}`);
    return;
  }

  const outHeaders = copyResponseHeaders(upstream);
  outHeaders["x-prompt-anonymizer"] = localUpstream
    ? "skipped-local"
    : anonymized
      ? "active"
      : hasBody && !isJson
        ? "skipped-non-json"
        : "idle";

  const responseType = upstream.headers.get("content-type") ?? "";

  try {
    if (!upstream.body) {
      res.writeHead(upstream.status, outHeaders);
      res.end();
      return;
    }

    if (!anonymized) {
      res.writeHead(upstream.status, outHeaders);
      pipeline(Readable.fromWeb(upstream.body), res, () => {});
      return;
    }

    if (responseType.includes("text/event-stream")) {
      res.writeHead(upstream.status, outHeaders);
      const restored = upstream.body.pipeThrough(restoreSseStream(anonymizer.vault));
      pipeline(Readable.fromWeb(restored), res, () => {});
      return;
    }

    if (responseType.includes("application/json")) {
      const raw = Buffer.from(await upstream.arrayBuffer());
      let output = raw;
      try {
        const parsed = JSON.parse(raw.toString("utf8"));
        restoreJson(parsed, anonymizer.vault);
        output = Buffer.from(JSON.stringify(parsed));
      } catch {
        // Not JSON after all, pass the original bytes through.
      }
      outHeaders["content-length"] = String(output.length);
      res.writeHead(upstream.status, outHeaders);
      res.end(output);
      return;
    }

    if (responseType.startsWith("text/")) {
      const text = await upstream.text();
      const output = restoreText(text, anonymizer.vault);
      outHeaders["content-length"] = String(Buffer.byteLength(output));
      res.writeHead(upstream.status, outHeaders);
      res.end(output);
      return;
    }

    res.writeHead(upstream.status, outHeaders);
    pipeline(Readable.fromWeb(upstream.body), res, () => {});
  } catch (error) {
    log("response restore failed:", error.message);
    if (!res.headersSent) jsonError(res, 502, `Response restore failed: ${error.message}`);
    else res.destroy();
  } finally {
    log(
      `${req.method} ${pathname} -> ${upstream.status} ${Date.now() - started}ms tokens+${added} ` +
        `mode=${outHeaders["x-prompt-anonymizer"]}`,
    );
  }
}

export function createServer(config, anonymizer = new Anonymizer(config)) {
  return http.createServer((req, res) => {
    handle(req, res, config, anonymizer).catch((error) => {
      console.error("[prompt-anonymizer] unhandled:", error);
      if (!res.headersSent) jsonError(res, 500, "Internal proxy error.");
      else res.destroy();
    });
  });
}

export function startServer(config, anonymizer = new Anonymizer(config)) {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}`);
  }
  const server = createServer(config, anonymizer);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      resolve({
        server,
        anonymizer,
        url: `http://${config.host}:${config.port}`,
      });
    });
  });
}
