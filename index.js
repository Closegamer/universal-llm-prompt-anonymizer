// writtenBy('Closegamer', 2026)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Plugin } from "@opencode/plugin";

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
    return body?.service === "prompt-anonymizer";
  } catch {
    return false;
  }
}

async function ensureProxy(port) {
  if (await isProxy(port)) return true;

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

export default Plugin.define({
  id: "prompt-anonymizer",
  async setup(ctx) {
    const port = Number(ctx.options?.port ?? DEFAULT_PORT);
    const only = Array.isArray(ctx.options?.providers) ? new Set(ctx.options.providers) : null;

    if (!(await ensureProxy(port))) {
      console.error("[prompt-anonymizer] providers left unchanged");
      return;
    }

    await ctx.provider.transform((editor) => {
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
  },
});
