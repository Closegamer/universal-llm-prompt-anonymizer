// writtenBy('Closegamer', 2026)
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESKTOP, "..");
const BUILD = path.join(DESKTOP, "build");
const RUNTIME = path.join(BUILD, "proxy-runtime");
const NODE_DIR = path.join(BUILD, "node");
const ASSETS = path.join(DESKTOP, "assets");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const desktopPkgPath = path.join(DESKTOP, "package.json");
const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, "utf8"));
desktopPkg.version = pkg.version;
fs.writeFileSync(desktopPkgPath, `${JSON.stringify(desktopPkg, null, 2)}\n`);

fs.rmSync(ASSETS, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "assets"), ASSETS, { recursive: true });

fs.rmSync(RUNTIME, { recursive: true, force: true });
fs.mkdirSync(RUNTIME, { recursive: true });
fs.cpSync(path.join(ROOT, "src"), path.join(RUNTIME, "src"), { recursive: true });
fs.writeFileSync(
  path.join(RUNTIME, "package.json"),
  `${JSON.stringify(
    {
      name: "universal-llm-prompt-anonymizer-proxy",
      version: pkg.version,
      private: true,
      type: "module",
      dependencies: {
        "@huggingface/transformers": pkg.dependencies["@huggingface/transformers"],
      },
    },
    null,
    2,
  )}\n`,
);

console.log("installing proxy runtime dependencies...");
execSync("npm install --omit=dev --no-audit --no-fund", {
  cwd: RUNTIME,
  stdio: "inherit",
  shell: true,
});

const runtimeModules = path.join(RUNTIME, "node_modules");
const onnxBin = path.join(runtimeModules, "onnxruntime-node", "bin");
if (fs.existsSync(onnxBin)) {
  for (const api of fs.readdirSync(onnxBin)) {
    const apiDir = path.join(onnxBin, api);
    if (!fs.statSync(apiDir).isDirectory()) continue;
    for (const platform of fs.readdirSync(apiDir)) {
      const platformDir = path.join(apiDir, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;
      for (const arch of fs.readdirSync(platformDir)) {
        if (platform === process.platform && arch === process.arch) continue;
        fs.rmSync(path.join(platformDir, arch), { recursive: true, force: true });
      }
      if (fs.readdirSync(platformDir).length === 0) {
        fs.rmSync(platformDir, { recursive: true, force: true });
      }
    }
  }
}
fs.rmSync(path.join(runtimeModules, "onnxruntime-web"), { recursive: true, force: true });
fs.rmSync(path.join(runtimeModules, "@img", "sharp-wasm32"), { recursive: true, force: true });

fs.rmSync(NODE_DIR, { recursive: true, force: true });
fs.mkdirSync(NODE_DIR, { recursive: true });
const source = process.env.PROMPT_ANONYMIZER_NODE
  ? path.resolve(process.env.PROMPT_ANONYMIZER_NODE)
  : fs.realpathSync(process.execPath);
const destination = path.join(NODE_DIR, process.platform === "win32" ? "node.exe" : "node");
fs.copyFileSync(source, destination);
if (process.platform !== "win32") fs.chmodSync(destination, 0o755);

const version = execFileSync(destination, ["--version"]).toString().trim();
const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
if (major < 22 || (major === 22 && minor < 15)) {
  throw new Error(`Bundled Node.js is ${version}. Node.js 22.15 or newer is required.`);
}

console.log(`proxy runtime: ${RUNTIME}`);
console.log(`node binary: ${destination} (${version})`);
