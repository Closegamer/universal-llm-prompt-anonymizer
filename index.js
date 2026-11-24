// writtenBy('Closegamer', 2026)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8787;
const CLI = fileURLToPath(new URL("./src/cli.js", import.meta.url));
const ROOT = fileURLToPath(new URL(".", import.meta.url));

const ROUTES = [
  { prefix: "/anthropic", hosts: ["api.anthropic.com"] },
  { prefix: "/openai", hosts: ["api.openai.com"] },
  { prefix: "/deepseek", hosts: ["api.deepseek.com"] },
  { prefix: "/gemini", hosts: ["generativelanguage.googleapis.com"] },
  { prefix: "/openrouter", hosts: ["openrouter.ai"] },
  { prefix: "/groq", hosts: ["api.groq.com"] },
  { prefix: "/mistral", hosts: ["api.mistral.ai"] },
  { prefix: "/xai", hosts: ["api.x.ai"] },
];

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  google: "https://generativelanguage.googleapis.com",
  gemini: "https://generativelanguage.googleapis.com",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isProxy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = await response.json();
    return body?.service === "universal-llm-prompt-anonymizer";
  } catch {
    return false;
  }
}

function proxyPort() {
  try {
    const file = path.join(os.homedir(), ".cache", "prompt-anonymizer", "proxy.json");
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(info?.port)) return info.port;
  } catch {
    // No running proxy or unreadable pid file.
  }
  return DEFAULT_PORT;
}

async function ensureProxy(port) {
  if (await isProxy(port)) return true;

  // The desktop app may still be starting, so give it a moment before spawning a second proxy.
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(250);
    if (await isProxy(port)) return true;
  }

  if (!fs.existsSync(CLI)) return false;

  const args = [CLI, "--port", String(port), "--no-log"];
  if (process.platform === "win32") args.unshift("--use-system-ca");

  let spawnError;
  try {
    const child = spawn("node", args, {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      spawnError = error;
      console.error(`[prompt-anonymizer] could not start node: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(`[prompt-anonymizer] could not start proxy: ${error.message}`);
    return false;
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) return false;
    await sleep(250);
    if (await isProxy(port)) return true;
  }
  console.error("[prompt-anonymizer] proxy did not become healthy on port", port);
  return false;
}

export function proxyBaseURL(provider, port) {
  const original = provider.settings?.baseURL ?? DEFAULT_BASE[provider.id];
  if (!original) return null;

  let url;
  try {
    url = new URL(original);
  } catch {
    return null;
  }

  if (LOCAL_HOSTS.has(url.hostname)) return null;

  const route = ROUTES.find((entry) => entry.hosts.includes(url.hostname));
  if (!route) return null;

  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `http://127.0.0.1:${port}${route.prefix}${suffix}`;
}

function applyRouting(ctx, port, only) {
  return ctx.provider.transform((editor) => {
    for (const record of editor.list()) {
      const provider = record.provider;
      if (only && !only.has(provider.id)) continue;
      const baseURL = proxyBaseURL(provider, port);
      if (!baseURL) continue;
      editor.update(provider.id, (draft) => {
        draft.settings = { ...draft.settings, baseURL };
      });
    }
  });
}

// Routing follows proxy health because the OpenCode server outlives the proxy process.
export async function watchProxy(ctx, port, only, intervalMs = 5000) {
  let registration;
  let syncing = false;

  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const healthy = await isProxy(port);
      if (healthy && !registration) {
        registration = await applyRouting(ctx, port, only);
      } else if (!healthy && registration) {
        await registration.dispose();
        registration = undefined;
        console.error("[prompt-anonymizer] proxy is down, providers use direct URLs until it is back");
      }
    } catch (error) {
      console.error(`[prompt-anonymizer] routing check failed: ${error.message}`);
    } finally {
      syncing = false;
    }
  };

  await sync();
  const timer = setInterval(() => void sync(), intervalMs);
  timer.unref();

  return async () => {
    clearInterval(timer);
    if (registration) {
      await registration.dispose();
      registration = undefined;
    }
  };
}

export default {
  id: "universal-llm-prompt-anonymizer",
  async setup(ctx) {
    const port = Number(ctx.options?.port ?? proxyPort());
    const only = Array.isArray(ctx.options?.providers) ? new Set(ctx.options.providers) : null;

    if (!(await ensureProxy(port))) {
      console.error("[prompt-anonymizer] proxy is not running, providers use direct URLs");
    }

    return watchProxy(ctx, port, only);
  },
};
