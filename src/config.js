import fs from "node:fs";
import path from "node:path";

export const DEFAULT_ROUTES = Object.freeze({
  "/openai": "https://api.openai.com",
  "/anthropic": "https://api.anthropic.com",
  "/deepseek": "https://api.deepseek.com",
  "/gemini": "https://generativelanguage.googleapis.com",
  "/openrouter": "https://openrouter.ai/api",
  "/groq": "https://api.groq.com",
  "/mistral": "https://api.mistral.ai",
  "/xai": "https://api.x.ai",
});

export const DETECTORS = Object.freeze({
  names: true,
  nickname: true,
  date: true,
  username: true,
  email: true,
  phone: true,
  address: true,
  card: true,
  iban: true,
  ssn: true,
  id: true,
  number: true,
  ip: true,
});

export const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  routes: DEFAULT_ROUTES,
  detectors: DETECTORS,
  ner: {
    enabled: true,
    latinThreshold: 0.75,
    cyrillicThreshold: 0.6,
  },
  skipUpstreamHosts: ["localhost", "127.0.0.1", "::1", "[::1]"],
  allowUnscanned: false,
  maxBodyBytes: 100 * 1024 * 1024,
  log: true,
});

export function loadConfig(file) {
  const configPath =
    file ?? process.env.PROMPT_ANONYMIZER_CONFIG ?? path.resolve("anonymizer.config.json");
  let user = {};
  let found = false;
  if (fs.existsSync(configPath)) {
    user = JSON.parse(fs.readFileSync(configPath, "utf8"));
    found = true;
  }

  const routes = { ...DEFAULT_ROUTES, ...(user.routes ?? {}) };
  for (const prefix of Object.keys(routes)) {
    if (!prefix.startsWith("/")) throw new Error(`Route prefix must start with /: ${prefix}`);
    if (!/^https?:\/\//.test(routes[prefix])) {
      throw new Error(`Route must be an http(s) URL: ${prefix} -> ${routes[prefix]}`);
    }
  }

  return {
    path: found ? configPath : null,
    config: {
      ...DEFAULTS,
      ...user,
      routes,
      detectors: { ...DETECTORS, ...(user.detectors ?? {}) },
      ner: { ...DEFAULTS.ner, ...(user.ner ?? {}) },
    },
  };
}

export function routeFor(config, pathname) {
  const prefixes = Object.keys(config.routes).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { prefix, upstream: config.routes[prefix] };
    }
  }
  return null;
}

export function providerKind(prefix) {
  if (prefix === "/anthropic") return "anthropic";
  if (prefix === "/gemini") return "gemini";
  return "openai";
}
