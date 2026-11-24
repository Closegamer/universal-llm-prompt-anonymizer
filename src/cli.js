#!/usr/bin/env node
// writtenBy('Closegamer', 2026)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { installPlugin } from "./install.js";
import { preloadNer } from "./ner.js";
import { clearPid, pidFilePath, readPid, writePid } from "./pidfile.js";
import { startServer } from "./server.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function parseArgs(argv) {
  const flags = { args: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") flags.port = Number(argv[++i]);
    else if (arg === "--host") flags.host = argv[++i];
    else if (arg === "--config") flags.config = argv[++i];
    else if (arg === "--no-ner") flags.noNer = true;
    else if (arg === "--allow-unscanned") flags.allowUnscanned = true;
    else if (arg === "--preload") flags.preload = true;
    else if (arg === "--no-log") flags.noLog = true;
    else if (arg === "--version" || arg === "-v") flags.version = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else flags.args.push(arg);
  }
  return flags;
}

function printHelp() {
  console.log(`Universal LLM Prompt Anonymizer ${pkg.version}
Local privacy gateway for cloud LLMs.
Command: prompt-anonymizer

Usage:
  prompt-anonymizer                      Start the proxy
  prompt-anonymizer serve [options]      Start the proxy
  prompt-anonymizer stop                 Stop a running proxy
  prompt-anonymizer install [options]    Add the plugin to OpenCode
  prompt-anonymizer --version            Print the version

Serve options:
  --port <n>            Listen port (default 8787)
  --host <addr>         Listen address (default 127.0.0.1)
  --config <file>       Proxy config (default ./anonymizer.config.json)
  --no-ner              Disable the local name detector
  --allow-unscanned     Forward non-JSON bodies instead of blocking them
  --preload             Load the NER model during startup
  --no-log              Disable request logging

Install options:
  --config <file>       OpenCode config (default ~/.config/opencode/opencode.json)
`);
}

function maybeReexecWithSystemCa() {
  if (process.platform !== "win32") return false;
  if (process.execArgv.includes("--use-system-ca")) return false;
  if (process.env.PROMPT_ANONYMIZER_NO_SYSTEM_CA === "1") return false;

  const child = spawn(process.execPath, ["--use-system-ca", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, PROMPT_ANONYMIZER_NO_SYSTEM_CA: "1" },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  return true;
}

async function serve(flags) {
  const { config, path } = loadConfig(flags.config);
  if (flags.port) config.port = flags.port;
  if (flags.host) config.host = flags.host;
  if (flags.noNer) config.ner.enabled = false;
  if (flags.allowUnscanned) config.allowUnscanned = true;
  if (flags.noLog) config.log = false;

  const { server, url } = await startServer(config);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  const healthHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  writePid({ pid: process.pid, port, url: `http://${healthHost}:${port}` });

  console.log("");
  console.log("Universal LLM Prompt Anonymizer");
  console.log("Local privacy gateway for cloud LLMs");
  console.log("");
  console.log(`listening on ${url}`);
  console.log(`config: ${path ?? "defaults"}`);
  console.log("routes:");
  for (const [prefix, upstream] of Object.entries(config.routes)) {
    console.log(`  ${prefix} -> ${upstream}`);
  }
  console.log(`NER: ${config.ner.enabled ? "on (loads on first use)" : "off"}`);

  if (flags.preload && config.ner.enabled) {
    console.log("preloading NER model...");
    await preloadNer();
    console.log("NER model ready");
  }

  const shutdown = () => {
    console.log("\nshutting down");
    clearPid(process.pid);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => clearPid(process.pid));
}

async function stop() {
  const info = readPid();
  if (!info?.pid) {
    console.log("No running proxy found.");
    return;
  }

  const url = info.url ?? `http://127.0.0.1:${info.port ?? 8787}`;
  let healthy = false;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
    healthy = (await response.json())?.service === "universal-llm-prompt-anonymizer";
  } catch {
    healthy = false;
  }

  if (!healthy) {
    clearPid(info.pid);
    console.log(`No healthy proxy found. Removed ${pidFilePath}.`);
    return;
  }

  try {
    process.kill(info.pid);
  } catch (error) {
    console.error(`Could not stop PID ${info.pid}: ${error.message}`);
    return;
  }

  let alive = true;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      process.kill(info.pid, 0);
    } catch {
      alive = false;
      break;
    }
  }

  clearPid(info.pid);
  console.log(
    alive
      ? `Stop requested for PID ${info.pid}, but it is still running.`
      : `Stopped proxy on port ${info.port ?? "?"}.`,
  );
}

function install(flags) {
  const result = installPlugin({ configPath: flags.config });
  if (result.added) {
    console.log(`Added ${result.pluginPath}`);
    console.log(`to ${result.configPath}`);
    console.log("OpenCode reloads plugins automatically. Start a new session to use it.");
  } else {
    console.log(`Already installed in ${result.configPath}`);
  }
}

async function main() {
  if (maybeReexecWithSystemCa()) return;

  const flags = parseArgs(process.argv.slice(2));
  if (flags.version) {
    console.log(pkg.version);
    return;
  }
  if (flags.help) {
    printHelp();
    return;
  }

  const command = flags.args[0] ?? "serve";
  if (command === "install") {
    install(flags);
    return;
  }
  if (command === "stop") {
    await stop();
    return;
  }
  if (command === "serve") {
    await serve(flags);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[prompt-anonymizer] fatal:", error.message ?? error);
  process.exit(1);
});
