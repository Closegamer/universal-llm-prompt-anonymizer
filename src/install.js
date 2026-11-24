import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function defaultOpencodeConfig() {
  const base = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
    : path.join(os.homedir(), ".config", "opencode");
  return path.join(base, "opencode.json");
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function installPlugin(options = {}) {
  const target = path.resolve(options.configPath ?? defaultOpencodeConfig());
  const packageRoot = path.resolve(options.packageRoot ?? PACKAGE_ROOT);

  if (!fs.existsSync(path.join(packageRoot, "index.js"))) {
    throw new Error(`Plugin entry not found in ${packageRoot}`);
  }
  if (!fs.existsSync(path.join(packageRoot, "src", "cli.js"))) {
    throw new Error(`Proxy entry not found in ${packageRoot}`);
  }

  const pluginPath = packageRoot.replace(/\\/g, "/");
  let config = { $schema: "https://opencode.ai/config.json" };
  let existed = false;

  if (fs.existsSync(target)) {
    existed = true;
    const raw = fs.readFileSync(target, "utf8");
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(
        `Could not parse ${target}. If it is JSONC, add this to its plugins array manually: ${pluginPath}`,
      );
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${target} does not contain a JSON object`);
    }
  }

  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new Error(`The plugins field in ${target} is not an array`);
  }

  const list = config.plugins ?? [];
  const already = list.some((entry) => {
    const value = typeof entry === "string" ? entry : entry?.package;
    return typeof value === "string" && normalizePath(value) === normalizePath(pluginPath);
  });

  if (already) {
    return { configPath: target, pluginPath, added: false };
  }

  list.push(pluginPath);
  config.plugins = list;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (existed) fs.copyFileSync(target, `${target}.before-prompt-anonymizer.bak`);
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);

  return { configPath: target, pluginPath, added: true };
}
